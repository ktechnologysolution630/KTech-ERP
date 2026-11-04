import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  arInvoices,
  arReceipts,
  boqLines,
  boqs,
  customers,
  payables,
  poLines,
  pos,
  projectTasks,
  projects,
  pvLines,
  pvs,
  vendors,
  type PayableSourceType,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import {
  computeEvm,
  groupBoqBudget,
  lastMonthKeys,
  monthEnd,
  monthRange,
  type EvmResult,
} from '@/domain/project-finance';
import { computeProjectProgress, plannedProgressAt, type ScheduleTask } from '@/domain/schedule';
import { bangkokDateString } from '@/domain/thai';
import { assertCan, can } from '@/server/policy';

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/** Expense groups shown on the cashflow donut, by how the payable arose. */
export const EXPENSE_GROUP: Record<PayableSourceType, string> = {
  CREDIT_INVOICE: 'ค่าวัสดุ/สั่งซื้อ (PO)',
  PREPAID_REQUEST: 'ค่าวัสดุ/สั่งซื้อ (PO)',
  INSTALLMENT: 'ค่าวัสดุ/สั่งซื้อ (PO)',
  CONTRACTOR_CLAIM: 'ค่าผู้รับเหมาช่วง',
  LABOR: 'ค่าแรง',
  EXPENSE: 'ค่าใช้จ่ายโครงการอื่นๆ',
};

const COMMITTED_PO = ['APPROVED', 'ORDERED', 'COMPLETED'] as const;

export interface CashflowEntry {
  key: string;
  date: string;
  docNo: string;
  kind: 'INCOME' | 'EXPENSE';
  party: string;
  amount: number;
  status: 'DONE' | 'PENDING';
  label: string;
  href: string;
}

export interface ProjectCashflow {
  canCreateIncome: boolean;
  canCreateExpense: boolean;
  contractValue: number;
  billed: number;
  received: number;
  receivable: number;
  retentionHeld: number;
  paid: number;
  payableOpen: number;
  poCommitted: number;
  net: number;
  thisMonth: { income: number; expense: number };
  monthly: { month: string; income: number; expense: number; cumulative: number }[];
  expenseGroups: { label: string; amount: number }[];
  entries: CashflowEntry[];
}

async function loadProject(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  return project;
}

/** Money in (customer receipts) and out (paid vouchers) for one project, plus what is still open. */
export async function getProjectCashflow(db: Db, actor: SessionUser, projectId: string): Promise<ProjectCashflow> {
  assertCan(actor, 'project.finance', { projectId });
  const project = await loadProject(db, projectId);
  const today = bangkokDateString();

  const [invoiceRows, receiptRows, paidRows, openRows, poRows] = await Promise.all([
    db
      .select({
        id: arInvoices.id,
        number: arInvoices.number,
        docDate: arInvoices.docDate,
        status: arInvoices.status,
        gross: arInvoices.gross,
        retention: arInvoices.retentionAmount,
        customer: customers.name,
      })
      .from(arInvoices)
      .innerJoin(customers, eq(customers.id, arInvoices.customerId))
      .where(and(eq(arInvoices.projectId, projectId), inArray(arInvoices.status, ['ISSUED', 'PARTIAL', 'PAID']))),
    db
      .select({
        id: arReceipts.id,
        number: arReceipts.number,
        date: arReceipts.receiptDate,
        received: arReceipts.amountReceived,
        wht: arReceipts.whtAmount,
        invoiceId: arReceipts.invoiceId,
        customer: customers.name,
      })
      .from(arReceipts)
      .innerJoin(arInvoices, eq(arInvoices.id, arReceipts.invoiceId))
      .innerJoin(customers, eq(customers.id, arInvoices.customerId))
      .where(and(eq(arInvoices.projectId, projectId), eq(arReceipts.voided, false))),
    db
      .select({
        pvId: pvs.id,
        number: pvs.number,
        paidAt: pvs.paidAt,
        vendor: vendors.name,
        sourceType: payables.sourceType,
        gross: pvLines.gross,
      })
      .from(pvLines)
      .innerJoin(pvs, eq(pvs.id, pvLines.pvId))
      .innerJoin(payables, eq(payables.id, pvLines.payableId))
      .innerJoin(vendors, eq(vendors.id, pvs.vendorId))
      .where(and(eq(payables.projectId, projectId), eq(pvs.status, 'PAID'))),
    db
      .select({
        id: payables.id,
        dueDate: payables.dueDate,
        gross: payables.gross,
        note: payables.note,
        vendor: vendors.name,
      })
      .from(payables)
      .innerJoin(vendors, eq(vendors.id, payables.vendorId))
      .where(and(eq(payables.projectId, projectId), inArray(payables.status, ['OPEN', 'IN_PV']))),
    db
      .select({ gross: sql<string>`coalesce(sum(${pos.gross}), 0)` })
      .from(pos)
      .where(and(eq(pos.projectId, projectId), inArray(pos.status, [...COMMITTED_PO]))),
  ]);

  // One voucher may pay several payables of this project: show it once
  const paidByPv = new Map<string, { number: string; date: string; vendor: string; amount: number }>();
  const groups = new Map<string, number>();
  for (const r of paidRows) {
    const g = num(r.gross);
    const entry = paidByPv.get(r.pvId) ?? { number: r.number, date: r.paidAt ?? today, vendor: r.vendor, amount: 0 };
    entry.amount += g;
    paidByPv.set(r.pvId, entry);
    const label = EXPENSE_GROUP[r.sourceType];
    groups.set(label, (groups.get(label) ?? 0) + g);
  }

  const months = lastMonthKeys(today, 12);
  const byMonth = new Map(months.map((m) => [m, { income: 0, expense: 0 }]));
  const incomeOf = (r: (typeof receiptRows)[number]) => num(r.received) + num(r.wht);
  for (const r of receiptRows) {
    const b = byMonth.get(r.date.slice(0, 7));
    if (b) b.income += incomeOf(r);
  }
  for (const p of paidByPv.values()) {
    const b = byMonth.get(p.date.slice(0, 7));
    if (b) b.expense += p.amount;
  }
  // Cumulative balance starts from everything before the 12-month window
  const windowStart = months[0];
  let running =
    receiptRows.filter((r) => r.date.slice(0, 7) < windowStart).reduce((a, r) => a + incomeOf(r), 0) -
    [...paidByPv.values()].filter((p) => p.date.slice(0, 7) < windowStart).reduce((a, p) => a + p.amount, 0);
  const monthly = months.map((m) => {
    const b = byMonth.get(m)!;
    running += b.income - b.expense;
    return { month: m, income: round(b.income), expense: round(b.expense), cumulative: round(running) };
  });

  const received = receiptRows.reduce((a, r) => a + incomeOf(r), 0);
  const billed = invoiceRows.reduce((a, r) => a + num(r.gross), 0);
  const paid = [...paidByPv.values()].reduce((a, p) => a + p.amount, 0);

  const entries: CashflowEntry[] = [
    ...receiptRows.map((r) => ({
      key: `rc-${r.id}`,
      date: r.date,
      docNo: r.number,
      kind: 'INCOME' as const,
      party: r.customer,
      amount: round(incomeOf(r)),
      status: 'DONE' as const,
      label: 'รับชำระจากลูกค้า',
      href: `/ar/invoices/${r.invoiceId}`,
    })),
    ...invoiceRows
      .filter((r) => r.status !== 'PAID')
      .map((r) => ({
        key: `inv-${r.id}`,
        date: r.docDate,
        docNo: r.number ?? '-',
        kind: 'INCOME' as const,
        party: r.customer,
        amount: round(num(r.gross)),
        status: 'PENDING' as const,
        label: 'วางบิลแล้ว รอรับเงิน',
        href: `/ar/invoices/${r.id}`,
      })),
    ...[...paidByPv.entries()].map(([id, p]) => ({
      key: `pv-${id}`,
      date: p.date,
      docNo: p.number,
      kind: 'EXPENSE' as const,
      party: p.vendor,
      amount: round(p.amount),
      status: 'DONE' as const,
      label: 'จ่ายเงินแล้ว',
      href: `/pv/${id}`,
    })),
    ...openRows.map((r) => ({
      key: `ap-${r.id}`,
      date: r.dueDate,
      docNo: r.note.split(' ')[0] || 'ตั้งหนี้',
      kind: 'EXPENSE' as const,
      party: r.vendor,
      amount: round(num(r.gross)),
      status: 'PENDING' as const,
      label: 'ตั้งหนี้แล้ว รอจ่าย',
      href: '/payables',
    })),
  ].sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : b.date.localeCompare(a.date)));

  const thisMonth = byMonth.get(today.slice(0, 7))!;
  return {
    canCreateIncome: can(actor, 'ar.manage'),
    canCreateExpense: can(actor, 'prv.create', { projectId }),
    contractValue: num(project.budget),
    billed: round(billed),
    received: round(received),
    receivable: round(Math.max(0, billed - received)),
    retentionHeld: round(invoiceRows.reduce((a, r) => a + num(r.retention), 0)),
    paid: round(paid),
    payableOpen: round(openRows.reduce((a, r) => a + num(r.gross), 0)),
    poCommitted: round(num(poRows[0]?.gross)),
    net: round(received - paid),
    thisMonth: { income: round(thisMonth.income), expense: round(thisMonth.expense) },
    monthly,
    expenseGroups: [...groups.entries()].map(([label, amount]) => ({ label, amount: round(amount) })).sort((a, b) => b.amount - a.amount),
    entries: entries.slice(0, 100),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ───────────────────────────── Cost performance (EVM) ─────────────────────────────

export interface CostCategoryRow {
  key: string;
  name: string;
  budget: number;
  committed: number;
  remaining: number;
  usedPercent: number;
}

export interface ProjectCostPerformance {
  asOf: string;
  budgetSource: 'BOQ' | 'PROJECT' | 'NONE';
  plannedPercent: number;
  actualPercent: number;
  hasSchedule: boolean;
  evm: EvmResult;
  categories: CostCategoryRow[];
  unlinkedCommitted: number;
  curve: { month: string; planned: number; actualCost: number | null }[];
}

export async function getProjectCostPerformance(db: Db, actor: SessionUser, projectId: string): Promise<ProjectCostPerformance> {
  assertCan(actor, 'project.finance', { projectId });
  const project = await loadProject(db, projectId);
  const today = bangkokDateString();

  const [mainBoq] = await db
    .select({ id: boqs.id })
    .from(boqs)
    .where(and(eq(boqs.projectId, projectId), eq(boqs.kind, 'MAIN')))
    .limit(1);

  const [lines, tasks, costRows, poLineRows] = await Promise.all([
    mainBoq
      ? db
          .select({
            id: boqLines.id,
            isCategory: boqLines.isCategory,
            no: boqLines.no,
            description: boqLines.description,
            qty: boqLines.qty,
            materialRate: boqLines.materialRate,
            laborRate: boqLines.laborRate,
          })
          .from(boqLines)
          .where(eq(boqLines.boqId, mainBoq.id))
          .orderBy(asc(boqLines.sort))
      : Promise.resolve([]),
    db
      .select({
        id: projectTasks.id,
        parentId: projectTasks.parentId,
        startDate: projectTasks.startDate,
        dueDate: projectTasks.dueDate,
        progress: projectTasks.progress,
        value: projectTasks.value,
        status: projectTasks.status,
      })
      .from(projectTasks)
      .where(eq(projectTasks.projectId, projectId)),
    // Actual cost = every non-cancelled payable of the project, before VAT, by the month it was booked
    db
      .select({
        month: sql<string>`to_char(${payables.createdAt} at time zone 'Asia/Bangkok', 'YYYY-MM')`,
        amount: sql<string>`coalesce(sum(${payables.beforeVat}), 0)`,
      })
      .from(payables)
      .where(and(eq(payables.projectId, projectId), ne(payables.status, 'CANCELLED')))
      .groupBy(sql`1`),
    db
      .select({ boqLineId: poLines.boqLineId, amount: poLines.allocatedBeforeVat })
      .from(poLines)
      .innerJoin(pos, eq(pos.id, poLines.poId))
      .where(and(eq(pos.projectId, projectId), inArray(pos.status, [...COMMITTED_PO]))),
  ]);

  const groups = groupBoqBudget(lines);
  const boqBudget = groups.reduce((a, g) => a + g.budget, 0);
  const budgetSource: ProjectCostPerformance['budgetSource'] = boqBudget > 0 ? 'BOQ' : num(project.budget) > 0 ? 'PROJECT' : 'NONE';
  const bac = budgetSource === 'BOQ' ? boqBudget : num(project.budget);

  const scheduleTasks: ScheduleTask[] = tasks.map((t) => ({ ...t, value: num(t.value) }));
  const hasSchedule = scheduleTasks.some((t) => t.startDate && t.dueDate);
  const plannedPercent = hasSchedule ? plannedProgressAt(scheduleTasks, today) : 0;
  const actualPercent = computeProjectProgress(scheduleTasks);
  const ac = costRows.reduce((a, r) => a + num(r.amount), 0);
  const evm = computeEvm({ bac, plannedPercent, actualPercent, ac });

  const lineToGroup = new Map<string, string>();
  for (const g of groups) for (const id of g.lineIds) lineToGroup.set(id, g.key);
  const committedByGroup = new Map<string, number>();
  let unlinkedCommitted = 0;
  for (const r of poLineRows) {
    const key = r.boqLineId ? lineToGroup.get(r.boqLineId) : undefined;
    if (key) committedByGroup.set(key, (committedByGroup.get(key) ?? 0) + num(r.amount));
    else unlinkedCommitted += num(r.amount);
  }
  const categories: CostCategoryRow[] = groups.map((g) => {
    const committed = round(committedByGroup.get(g.key) ?? 0);
    return {
      key: g.key,
      name: g.name,
      budget: g.budget,
      committed,
      remaining: round(g.budget - committed),
      usedPercent: g.budget > 0 ? Math.round((committed / g.budget) * 1000) / 10 : 0,
    };
  });

  // S-curve from the earliest known date (project/task start, first cost) to the latest end date
  const dated = scheduleTasks.filter((t) => t.startDate && t.dueDate);
  const costMonths = costRows.map((r) => r.month).sort();
  const starts = [project.startDate, ...dated.map((t) => t.startDate as string), costMonths[0] && `${costMonths[0]}-01`].filter(
    (d): d is string => Boolean(d),
  );
  const ends = [project.endDate, ...dated.map((t) => t.dueDate as string), today].filter((d): d is string => Boolean(d));
  const curve: ProjectCostPerformance['curve'] = [];
  if (starts.length > 0 && bac > 0) {
    const costByMonth = new Map(costRows.map((r) => [r.month, num(r.amount)]));
    let cumulative = 0;
    for (const m of monthRange(starts.sort()[0], ends.sort().at(-1)!)) {
      cumulative += costByMonth.get(m) ?? 0;
      curve.push({
        month: m,
        planned: hasSchedule ? plannedProgressAt(scheduleTasks, monthEnd(m)) : 0,
        actualCost: m <= today.slice(0, 7) ? Math.round((cumulative / bac) * 1000) / 10 : null,
      });
    }
  }

  return {
    asOf: today,
    budgetSource,
    plannedPercent,
    actualPercent,
    hasSchedule,
    evm,
    categories,
    unlinkedCommitted: round(unlinkedCommitted),
    curve,
  };
}
