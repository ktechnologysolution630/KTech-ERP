import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  closeShortRequests,
  payables,
  pos,
  projects,
  pvs,
  vendors,
  type SessionUser,
} from '@/db/schema';
import { D, sum } from '@/domain/money';
import { bangkokDateString, toBangkok } from '@/domain/thai';
import { assertCan } from '@/server/policy';
import { getPoSummary } from './invoice';

function addDaysToIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m! ?? 1) - 1, d! ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
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

  const paidNotReceived: {
    poId: string;
    number: string;
    vendor: string;
    amount: string;
  }[] = [];

  for (const r of activePos) {
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
