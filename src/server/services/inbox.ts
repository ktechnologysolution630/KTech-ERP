import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  closeShortRequests,
  payables,
  pos,
  prLines,
  projects,
  prs,
  pvs,
  vendors,
  type SessionUser,
} from '@/db/schema';
import { computeDocTotals, D, type Decimal } from '@/domain/money';
import { formatThaiDate } from '@/domain/thai';
import { can } from '@/server/policy';
import { type SerializedPoRevisionPayload } from './po';
import { orderedQtyByPrLine } from './pr';
import { listReceivablePos } from './receipt';
import { getSettings } from './settings';

export type InboxKey =
  | 'PR_TO_APPROVE'
  | 'PR_TO_ORDER'
  | 'PO_TO_APPROVE'
  | 'PO_TO_ORDER'
  | 'PO_TO_RECEIVE'
  | 'PAYABLES_OPEN'
  | 'PV_TO_APPROVE'
  | 'PV_TO_PAY'
  | 'MY_REJECTED'
  | 'CLOSE_SHORT_TO_APPROVE';

export interface InboxItem {
  id: string;
  number: string;
  title: string;
  href: string;
  amount?: string;
  date: string;
}

export interface InboxGroup {
  key: InboxKey;
  label: string;
  count: number;
  items: InboxItem[];
}

/** The amount awaiting approval on a PO (a new PO or a submitted revision), or null when nothing is awaiting. */
export function poPendingGross(po: typeof pos.$inferSelect): Decimal | null {
  const pendingRev = po.pendingRevision as SerializedPoRevisionPayload | null;
  if (po.status !== 'PENDING_APPROVAL' && !pendingRev?.submittedForApproval) return null;
  return pendingRev
    ? computeDocTotals({
        vatMode: pendingRev.vatMode,
        billDiscount: D(pendingRev.billDiscount || 0),
        shipping: D(pendingRev.shipping || 0),
        lines: pendingRev.lines.map((l) => ({
          qty: D(l.qty),
          unitPrice: D(l.unitPrice),
          discount: D(l.discount),
        })),
      }).gross
    : D(po.gross);
}

export async function getInbox(db: Db, actor: SessionUser): Promise<InboxGroup[]> {
  const groups: InboxGroup[] = [];
  const settings = await getSettings(db);
  const poLimit = D(settings.poApprovalLimit);
  const allProjects = await db.select().from(projects);
  const projMap = new Map(allProjects.map((p) => [p.id, p]));
  const allVendors = await db.select().from(vendors);
  const vendorMap = new Map(allVendors.map((v) => [v.id, v]));

  // 1. PR_TO_APPROVE
  const pendingPrs = await db
    .select()
    .from(prs)
    .where(eq(prs.status, 'SUBMITTED'))
    .orderBy(desc(prs.createdAt));

  const prToApprove = pendingPrs.filter((pr) =>
    can(actor, 'pr.approve', { projectId: pr.projectId }),
  );
  if (prToApprove.length > 0) {
    groups.push({
      key: 'PR_TO_APPROVE',
      label: 'ใบขอซื้อรออนุมัติ (PR)',
      count: prToApprove.length,
      items: prToApprove.map((pr) => ({
        id: pr.id,
        number: pr.number,
        title: `โครงการ ${projMap.get(pr.projectId)?.name ?? ''}`,
        href: `/pr/${pr.id}`,
        date: formatThaiDate(pr.createdAt),
      })),
    });
  }

  // 2. PR_TO_ORDER (for PURCHASING / PURCHASING_HEAD)
  if (can(actor, 'po.manage')) {
    const approvedPrs = await db
      .select()
      .from(prs)
      .where(eq(prs.status, 'APPROVED'))
      .orderBy(desc(prs.createdAt));

    if (approvedPrs.length > 0) {
      const prIds = approvedPrs.map((pr) => pr.id);
      const lines = await db
        .select()
        .from(prLines)
        .where(inArray(prLines.prId, prIds));
      const lineIds = lines.map((l) => l.id);
      const ordMap =
        lineIds.length > 0
          ? await orderedQtyByPrLine(db, lineIds)
          : new Map();

      const prsWithRemaining = approvedPrs.filter((pr) => {
        const myLines = lines.filter((l) => l.prId === pr.id);
        return myLines.some((l) => D(l.qty).gt(ordMap.get(l.id) ?? D(0)));
      });

      if (prsWithRemaining.length > 0) {
        groups.push({
          key: 'PR_TO_ORDER',
          label: 'ใบขอซื้ออนุมัติแล้ว รอเปิด PO',
          count: prsWithRemaining.length,
          items: prsWithRemaining.map((pr) => ({
            id: pr.id,
            number: pr.number,
            title: `โครงการ ${projMap.get(pr.projectId)?.name ?? ''}`,
            href: `/po/new?prId=${pr.id}`,
            date: formatThaiDate(pr.createdAt),
          })),
        });
      }
    }
  }

  // 3. PO_TO_APPROVE
  const allPos = await db
    .select()
    .from(pos)
    .orderBy(desc(pos.createdAt));

  const poToApprove = allPos.filter((po) => {
    const gross = poPendingGross(po);
    if (!gross) return false;

    return can(actor, 'po.approve', {
      gross,
      poApprovalLimit: poLimit,
      createdBy: po.createdBy,
    });
  });

  if (poToApprove.length > 0) {
    groups.push({
      key: 'PO_TO_APPROVE',
      label: 'ใบสั่งซื้อรออนุมัติ (PO)',
      count: poToApprove.length,
      items: poToApprove.map((po) => ({
        id: po.id,
        number: po.number,
        title: vendorMap.get(po.vendorId)?.name ?? '',
        href: `/po/${po.id}`,
        amount: po.gross,
        date: formatThaiDate(po.createdAt),
      })),
    });
  }

  // 4. PO_TO_ORDER
  if (can(actor, 'po.manage')) {
    const poToOrder = allPos.filter((po) => po.status === 'APPROVED');
    if (poToOrder.length > 0) {
      groups.push({
        key: 'PO_TO_ORDER',
        label: 'ใบสั่งซื้ออนุมัติแล้ว รอสั่งของกับร้าน',
        count: poToOrder.length,
        items: poToOrder.map((po) => ({
          id: po.id,
          number: po.number,
          title: vendorMap.get(po.vendorId)?.name ?? '',
          href: `/po/${po.id}`,
          amount: po.gross,
          date: formatThaiDate(po.createdAt),
        })),
      });
    }
  }

  // 5. PO_TO_RECEIVE
  const receivablePos = await listReceivablePos(db, actor);
  if (receivablePos.length > 0) {
    groups.push({
      key: 'PO_TO_RECEIVE',
      label: 'ใบสั่งซื้อรอรับของเข้าหน้างาน',
      count: receivablePos.length,
      items: receivablePos.map((r) => ({
        id: r.id,
        number: r.number,
        title: `${r.vendorName}${r.projectName ? ` (${r.projectName})` : ''}`,
        href: `/receive/${r.id}`,
        date: r.deliveryDate ?? '',
      })),
    });
  }

  // 6. PAYABLES_OPEN
  if (can(actor, 'pv.manage')) {
    const openPayables = await db
      .select()
      .from(payables)
      .where(eq(payables.status, 'OPEN'))
      .orderBy(asc(payables.dueDate));

    if (openPayables.length > 0) {
      groups.push({
        key: 'PAYABLES_OPEN',
        label: 'รายการตั้งหนี้รอทำใบสำคัญจ่าย (PV)',
        count: openPayables.length,
        items: openPayables.map((p) => ({
          id: p.id,
          number: p.sourceType,
          title: `${vendorMap.get(p.vendorId)?.name ?? ''} · ${p.note}`,
          href: `/pv/new?vendorId=${p.vendorId}`,
          amount: p.gross,
          date: p.dueDate,
        })),
      });
    }
  }

  // 7. PV_TO_APPROVE & 8. PV_TO_PAY
  const allPvs = await db
    .select()
    .from(pvs)
    .orderBy(desc(pvs.createdAt));

  if (can(actor, 'pv.approve')) {
    const pvToApprove = allPvs.filter((pv) => pv.status === 'PENDING_APPROVAL');
    if (pvToApprove.length > 0) {
      groups.push({
        key: 'PV_TO_APPROVE',
        label: 'ใบสำคัญจ่ายรออนุมัติ (PV)',
        count: pvToApprove.length,
        items: pvToApprove.map((pv) => ({
          id: pv.id,
          number: pv.number,
          title: vendorMap.get(pv.vendorId)?.name ?? '',
          href: `/pv/${pv.id}`,
          amount: pv.net,
          date: formatThaiDate(pv.createdAt),
        })),
      });
    }
  }

  if (can(actor, 'pv.pay')) {
    const pvToPay = allPvs.filter((pv) => pv.status === 'APPROVED');
    if (pvToPay.length > 0) {
      groups.push({
        key: 'PV_TO_PAY',
        label: 'ใบสำคัญจ่ายอนุมัติแล้ว รอโอนจ่าย',
        count: pvToPay.length,
        items: pvToPay.map((pv) => ({
          id: pv.id,
          number: pv.number,
          title: vendorMap.get(pv.vendorId)?.name ?? '',
          href: `/pv/${pv.id}`,
          amount: pv.net,
          date: formatThaiDate(pv.createdAt),
        })),
      });
    }
  }

  // 9. MY_REJECTED
  const myRejectedPrs = await db
    .select()
    .from(prs)
    .where(and(eq(prs.requestedBy, actor.id), eq(prs.status, 'REJECTED')));
  const myRejectedPos = allPos.filter(
    (po) => po.createdBy === actor.id && po.status === 'REJECTED',
  );
  const myRejectedPvs = allPvs.filter(
    (pv) => pv.createdBy === actor.id && pv.status === 'REJECTED',
  );

  const rejectedItems: InboxItem[] = [
    ...myRejectedPrs.map((p) => ({
      id: p.id,
      number: p.number,
      title: `PR ถูกตีกลับ: ${p.rejectReason ?? ''}`,
      href: `/pr/${p.id}`,
      date: formatThaiDate(p.createdAt),
    })),
    ...myRejectedPos.map((po) => ({
      id: po.id,
      number: po.number,
      title: `PO ถูกตีกลับ: ${po.rejectReason ?? ''}`,
      href: `/po/${po.id}`,
      amount: po.gross,
      date: formatThaiDate(po.createdAt),
    })),
    ...myRejectedPvs.map((pv) => ({
      id: pv.id,
      number: pv.number,
      title: `PV ถูกตีกลับ: ${pv.rejectReason ?? ''}`,
      href: `/pv/${pv.id}`,
      amount: pv.net,
      date: formatThaiDate(pv.createdAt),
    })),
  ];

  if (rejectedItems.length > 0) {
    groups.push({
      key: 'MY_REJECTED',
      label: 'เอกสารของฉันที่ถูกตีกลับ',
      count: rejectedItems.length,
      items: rejectedItems,
    });
  }

  // 10. CLOSE_SHORT_TO_APPROVE
  if (can(actor, 'closeShort.approve')) {
    const pendingCs = await db
      .select()
      .from(closeShortRequests)
      .where(eq(closeShortRequests.status, 'PENDING'))
      .orderBy(desc(closeShortRequests.createdAt));

    const poMap = new Map(allPos.map((p) => [p.id, p]));
    if (pendingCs.length > 0) {
      groups.push({
        key: 'CLOSE_SHORT_TO_APPROVE',
        label: 'คำขอปิดยอดค้างรับรออนุมัติ',
        count: pendingCs.length,
        items: pendingCs.map((r) => ({
          id: r.id,
          number: poMap.get(r.poId)?.number ?? '',
          title: r.reason,
          href: `/po/${r.poId}`,
          date: formatThaiDate(r.createdAt),
        })),
      });
    }
  }

  return groups;
}
