import { and, asc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  arCreditNotes,
  arInvoices,
  arReceipts,
  closeShortRequests,
  payables,
  pos,
  projectTasks,
  projects,
  pvLines,
  pvs,
  vendors,
  type SessionUser,
} from '@/db/schema';
import { AGING_LABELS, agingBucket, invoiceBalance, type AgingBucket } from '@/domain/ar';
import { D, sum } from '@/domain/money';
import { isProjectClosed, type ProjectStatus } from '@/domain/project';
import { lastMonthKeys } from '@/domain/project-finance';
import { computeProjectProgress, plannedProgressAt, type ScheduleTask } from '@/domain/schedule';
import { bangkokDateString, toBangkok } from '@/domain/thai';
import { assertCan } from '@/server/policy';
import { getPoSummary } from './invoice';
import { EXPENSE_GROUP } from './project-finance';

function addDaysToIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m! ?? 1) - 1, d! ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Behind plan by more than this many percentage points counts as late on the dashboard */
const BEHIND_PLAN_POINTS = 5;

export interface DashboardProjectRow {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  budget: number;
  progress: number;
  plannedProgress: number;
  cost: number;
  received: number;
  behindPlan: boolean;
  overBudget: boolean;
}

export interface DashboardOverview {
  year: number;
  cashInYtd: number;
  cashOutYtd: number;
  netYtd: number;
  thisMonth: { cashIn: number; cashOut: number };
  receivable: { total: number; overdue: number; invoices: number };
  payable: { total: number; overdue: number; items: number };
  monthly: { month: string; cashIn: number; cashOut: number }[];
  aging: { bucket: AgingBucket; label: string; receivable: number; payable: number }[];
  expenseMix: { label: string; amount: number }[];
  projects: DashboardProjectRow[];
  projectCounts: { open: number; behindPlan: number; overBudget: number };
}

const toNumber = (v: string | number | null | undefined) => Number(v ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Company-wide money and project health for the owner/finance dashboard. Cash in counts customer
 * receipts plus the tax they withheld; cash out counts the gross of paid vouchers (tax withheld
 * from vendors is still money the company pays), matching the project cashflow tab.
 */
export async function getDashboardOverview(
  db: Db,
  actor: SessionUser,
  opts: { today?: Date } = {},
): Promise<DashboardOverview> {
  assertCan(actor, 'export.view');

  const today = bangkokDateString(opts.today ?? new Date());
  const months = lastMonthKeys(today, 12);
  const windowStart = `${months[0]}-01`;
  const yearKey = today.slice(0, 4);

  const [receiptMonths, paidMonths, expenseRows, openInvoices, openPayables, projectRows] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${arReceipts.receiptDate}, 'YYYY-MM')`,
        amount: sql<string>`coalesce(sum(${arReceipts.amountReceived} + ${arReceipts.whtAmount}), 0)`,
      })
      .from(arReceipts)
      .where(and(eq(arReceipts.voided, false), gte(arReceipts.receiptDate, windowStart)))
      .groupBy(sql`1`),
    db
      .select({
        month: sql<string>`to_char(${pvs.paidAt}, 'YYYY-MM')`,
        amount: sql<string>`coalesce(sum(${pvs.gross}), 0)`,
      })
      .from(pvs)
      .where(and(eq(pvs.status, 'PAID'), gte(pvs.paidAt, windowStart)))
      .groupBy(sql`1`),
    db
      .select({ sourceType: payables.sourceType, amount: sql<string>`coalesce(sum(${pvLines.gross}), 0)` })
      .from(pvLines)
      .innerJoin(pvs, eq(pvs.id, pvLines.pvId))
      .innerJoin(payables, eq(payables.id, pvLines.payableId))
      .where(and(eq(pvs.status, 'PAID'), gte(pvs.paidAt, `${yearKey}-01-01`)))
      .groupBy(payables.sourceType),
    db
      .select({ id: arInvoices.id, gross: arInvoices.gross, dueDate: arInvoices.dueDate })
      .from(arInvoices)
      .where(inArray(arInvoices.status, ['ISSUED', 'PARTIAL'])),
    db
      .select({ dueDate: payables.dueDate, gross: payables.gross })
      .from(payables)
      .where(inArray(payables.status, ['OPEN', 'IN_PV'])),
    db
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        status: projects.status,
        budget: projects.budget,
      })
      .from(projects)
      .orderBy(asc(projects.code)),
  ]);

  // Cash per month
  const inByMonth = new Map(receiptMonths.map((r) => [r.month, toNumber(r.amount)]));
  const outByMonth = new Map(paidMonths.map((r) => [r.month, toNumber(r.amount)]));
  const monthly = months.map((month) => ({
    month,
    cashIn: round2(inByMonth.get(month) ?? 0),
    cashOut: round2(outByMonth.get(month) ?? 0),
  }));
  const ytd = monthly.filter((m) => m.month.startsWith(yearKey));
  const cashInYtd = round2(ytd.reduce((a, m) => a + m.cashIn, 0));
  const cashOutYtd = round2(ytd.reduce((a, m) => a + m.cashOut, 0));
  const current = monthly.at(-1)!;

  // Receivables: open invoices less what was received or credited against them
  const invoiceIds = openInvoices.map((i) => i.id);
  const [settledRows, creditedRows] = invoiceIds.length
    ? await Promise.all([
        db
          .select({
            invoiceId: arReceipts.invoiceId,
            amount: sql<string>`coalesce(sum(${arReceipts.amountReceived} + ${arReceipts.whtAmount}), 0)`,
          })
          .from(arReceipts)
          .where(and(eq(arReceipts.voided, false), inArray(arReceipts.invoiceId, invoiceIds)))
          .groupBy(arReceipts.invoiceId),
        db
          .select({ invoiceId: arCreditNotes.invoiceId, amount: sql<string>`coalesce(sum(${arCreditNotes.gross}), 0)` })
          .from(arCreditNotes)
          .where(and(eq(arCreditNotes.voided, false), inArray(arCreditNotes.invoiceId, invoiceIds)))
          .groupBy(arCreditNotes.invoiceId),
      ])
    : [[], []];
  const settled = new Map(settledRows.map((r) => [r.invoiceId, r.amount]));
  const credited = new Map(creditedRows.map((r) => [r.invoiceId, r.amount]));

  const buckets = Object.keys(AGING_LABELS) as AgingBucket[];
  const agingAr = new Map(buckets.map((b) => [b, 0]));
  const agingAp = new Map(buckets.map((b) => [b, 0]));
  let receivableInvoices = 0;
  for (const inv of openInvoices) {
    const balance = invoiceBalance({
      gross: inv.gross,
      settled: settled.get(inv.id) ?? 0,
      credited: credited.get(inv.id) ?? 0,
    }).toNumber();
    if (balance <= 0) continue;
    receivableInvoices += 1;
    const { bucket } = agingBucket(inv.dueDate, today);
    agingAr.set(bucket, agingAr.get(bucket)! + balance);
  }
  for (const p of openPayables) {
    const { bucket } = agingBucket(p.dueDate, today);
    agingAp.set(bucket, agingAp.get(bucket)! + toNumber(p.gross));
  }
  const totalOf = (m: Map<AgingBucket, number>) => [...m.values()].reduce((a, n) => a + n, 0);

  // Open projects: progress from tasks, cost from booked payables, income from receipts
  const openProjects = projectRows.filter((p) => !isProjectClosed(p.status));
  const openIds = openProjects.map((p) => p.id);
  const [taskRows, costRows, receivedRows] = openIds.length
    ? await Promise.all([
        db
          .select({
            id: projectTasks.id,
            projectId: projectTasks.projectId,
            parentId: projectTasks.parentId,
            startDate: projectTasks.startDate,
            dueDate: projectTasks.dueDate,
            progress: projectTasks.progress,
            value: projectTasks.value,
            status: projectTasks.status,
          })
          .from(projectTasks)
          .where(inArray(projectTasks.projectId, openIds)),
        db
          .select({ projectId: payables.projectId, amount: sql<string>`coalesce(sum(${payables.beforeVat}), 0)` })
          .from(payables)
          .where(and(inArray(payables.projectId, openIds), ne(payables.status, 'CANCELLED')))
          .groupBy(payables.projectId),
        db
          .select({
            projectId: arInvoices.projectId,
            amount: sql<string>`coalesce(sum(${arReceipts.amountReceived} + ${arReceipts.whtAmount}), 0)`,
          })
          .from(arReceipts)
          .innerJoin(arInvoices, eq(arInvoices.id, arReceipts.invoiceId))
          .where(and(eq(arReceipts.voided, false), inArray(arInvoices.projectId, openIds)))
          .groupBy(arInvoices.projectId),
      ])
    : [[], [], []];
  const tasksBy = new Map<string, ScheduleTask[]>();
  for (const t of taskRows) {
    const list = tasksBy.get(t.projectId) ?? [];
    list.push({ ...t, value: toNumber(t.value) });
    tasksBy.set(t.projectId, list);
  }
  const costBy = new Map(costRows.map((r) => [r.projectId, toNumber(r.amount)]));
  const receivedBy = new Map(receivedRows.map((r) => [r.projectId, toNumber(r.amount)]));

  const projectList: DashboardProjectRow[] = openProjects.map((p) => {
    const tasks = tasksBy.get(p.id) ?? [];
    const progress = computeProjectProgress(tasks);
    const plannedProgress = plannedProgressAt(tasks, today);
    const budget = toNumber(p.budget);
    const cost = round2(costBy.get(p.id) ?? 0);
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      budget,
      progress,
      plannedProgress,
      cost,
      received: round2(receivedBy.get(p.id) ?? 0),
      behindPlan: plannedProgress - progress > BEHIND_PLAN_POINTS,
      overBudget: budget > 0 && cost > budget,
    };
  });

  // The same group label can come from several payable types (all PO kinds)
  const mix = new Map<string, number>();
  for (const r of expenseRows) {
    const label = EXPENSE_GROUP[r.sourceType];
    mix.set(label, (mix.get(label) ?? 0) + toNumber(r.amount));
  }

  return {
    year: Number(yearKey),
    cashInYtd,
    cashOutYtd,
    netYtd: round2(cashInYtd - cashOutYtd),
    thisMonth: { cashIn: current.cashIn, cashOut: current.cashOut },
    receivable: {
      total: round2(totalOf(agingAr)),
      overdue: round2(totalOf(agingAr) - agingAr.get('NOT_DUE')!),
      invoices: receivableInvoices,
    },
    payable: {
      total: round2(totalOf(agingAp)),
      overdue: round2(totalOf(agingAp) - agingAp.get('NOT_DUE')!),
      items: openPayables.length,
    },
    monthly,
    aging: buckets.map((bucket) => ({
      bucket,
      label: AGING_LABELS[bucket],
      receivable: round2(agingAr.get(bucket)!),
      payable: round2(agingAp.get(bucket)!),
    })),
    expenseMix: [...mix.entries()].map(([label, amount]) => ({ label, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
    projects: projectList,
    projectCounts: {
      open: projectList.length,
      behindPlan: projectList.filter((p) => p.behindPlan).length,
      overBudget: projectList.filter((p) => p.overBudget).length,
    },
  };
}

export async function getOwnerDashboard(
  db: Db,
  actor: SessionUser,
  opts: { today?: Date } = {},
) {
  assertCan(actor, 'export.view');

  const todayDate = opts.today ?? new Date();
  const todayIso = bangkokDateString(todayDate);
  const in7DaysIso = addDaysToIso(todayIso, 7);

  // 1. Outstanding payables (OPEN + IN_PV)
  const unpaidPayables = await db
    .select({
      payable: payables,
      vendorName: vendors.name,
      poNumber: pos.number,
    })
    .from(payables)
    .innerJoin(vendors, eq(vendors.id, payables.vendorId))
    .leftJoin(pos, eq(pos.id, payables.poId))
    .where(inArray(payables.status, ['OPEN', 'IN_PV']))
    .orderBy(asc(payables.dueDate));

  const vendorMap = new Map<string, { vendorId: string; name: string; gross: ReturnType<typeof D> }>();
  for (const r of unpaidPayables) {
    const prev = vendorMap.get(r.payable.vendorId) ?? {
      vendorId: r.payable.vendorId,
      name: r.vendorName,
      gross: D(0),
    };
    prev.gross = prev.gross.plus(D(r.payable.gross));
    vendorMap.set(r.payable.vendorId, prev);
  }

  const outstandingByVendor = Array.from(vendorMap.values()).map((v) => ({
    vendorId: v.vendorId,
    name: v.name,
    gross: v.gross.toFixed(2),
  }));

  const overdue = unpaidPayables
    .filter((r) => r.payable.dueDate < todayIso)
    .map((r) => ({
      id: r.payable.id,
      vendorName: r.vendorName,
      poNumber: r.poNumber ?? '-',
      dueDate: r.payable.dueDate,
      gross: r.payable.gross,
      note: r.payable.note,
    }));

  const dueSoon = unpaidPayables
    .filter((r) => r.payable.dueDate >= todayIso && r.payable.dueDate <= in7DaysIso)
    .map((r) => ({
      id: r.payable.id,
      vendorName: r.vendorName,
      poNumber: r.poNumber ?? '-',
      dueDate: r.payable.dueDate,
      gross: r.payable.gross,
      note: r.payable.note,
    }));

  // 2. Paid not received POs
  const activePos = await db
    .select({
      po: pos,
      vendorName: vendors.name,
      projectName: projects.name,
    })
    .from(pos)
    .innerJoin(vendors, eq(vendors.id, pos.vendorId))
    .leftJoin(projects, eq(projects.id, pos.projectId))
    .where(and(ne(pos.status, 'CANCELLED'), ne(pos.status, 'DRAFT')));

  // paidNotReceived ต้องมี paidGross > 0 เสมอ จึงโหลด PO ที่มี PV สถานะ PAID ครั้งเดียว
  // แล้วเรียก getPoSummary เฉพาะ PO เหล่านั้น แทนการเรียกทุก PO
  const paidPoRows = await db
    .selectDistinct({ poId: payables.poId })
    .from(pvLines)
    .innerJoin(payables, eq(payables.id, pvLines.payableId))
    .innerJoin(pvs, and(eq(pvs.id, pvLines.pvId), eq(pvs.status, 'PAID')));
  const paidPoIds = new Set(paidPoRows.map((row) => row.poId));

  const paidNotReceived: {
    poId: string;
    number: string;
    vendor: string;
    amount: string;
  }[] = [];

  for (const r of activePos) {
    if (!paidPoIds.has(r.po.id)) continue;
    const summary = await getPoSummary(db, r.po.id);
    if (summary.paidNotReceived) {
      paidNotReceived.push({
        poId: r.po.id,
        number: r.po.number,
        vendor: r.vendorName,
        amount: summary.paidNotReceivedAmount.toFixed(2),
      });
    }
  }

  // 3. Pending approvals count
  const pendingPoCount = activePos.filter(
    (r) => r.po.status === 'PENDING_APPROVAL' || Boolean(r.po.pendingRevision),
  ).length;
  const pendingPvs = await db
    .select({ id: pvs.id })
    .from(pvs)
    .where(eq(pvs.status, 'PENDING_APPROVAL'));
  const pendingCs = await db
    .select({ id: closeShortRequests.id })
    .from(closeShortRequests)
    .where(eq(closeShortRequests.status, 'PENDING'));

  // 4. Purchases by project (approved/ordered/completed POs)
  const approvedPos = activePos.filter((r) =>
    ['APPROVED', 'ORDERED', 'COMPLETED'].includes(r.po.status),
  );
  const bkkToday = toBangkok(todayDate);
  const curYear = bkkToday.getUTCFullYear();
  const curMonth = bkkToday.getUTCMonth();

  const projMap = new Map<
    string,
    {
      projectId: string | null;
      name: string;
      monthGross: ReturnType<typeof D>;
      ytdGross: ReturnType<typeof D>;
      gross: ReturnType<typeof D>;
    }
  >();

  for (const r of approvedPos) {
    const key = r.po.projectId ?? '__OFFICE__';
    const prev = projMap.get(key) ?? {
      projectId: r.po.projectId,
      name: r.projectName ?? 'สำนักงาน / ส่วนกลาง',
      monthGross: D(0),
      ytdGross: D(0),
      gross: D(0),
    };
    const g = D(r.po.gross);
    prev.gross = prev.gross.plus(g);

    const poBkk = toBangkok(r.po.createdAt);
    if (poBkk.getUTCFullYear() === curYear) {
      prev.ytdGross = prev.ytdGross.plus(g);
      if (poBkk.getUTCMonth() === curMonth) {
        prev.monthGross = prev.monthGross.plus(g);
      }
    }
    projMap.set(key, prev);
  }

  const purchasesByProject = Array.from(projMap.values()).map((p) => ({
    projectId: p.projectId,
    name: p.name,
    gross: p.gross.toFixed(2),
    monthGross: p.monthGross.toFixed(2),
    ytdGross: p.ytdGross.toFixed(2),
  }));

  return {
    outstandingByVendor,
    dueSoon,
    overdue,
    paidNotReceived,
    pendingApprovals: {
      po: pendingPoCount,
      pv: pendingPvs.length,
      closeShort: pendingCs.length,
    },
    purchasesByProject,
  };
}
