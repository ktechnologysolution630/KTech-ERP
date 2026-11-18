import { desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  advances,
  boqOverrunRequests,
  closeShortRequests,
  payables,
  pos,
  prs,
  projects,
  prvs,
  pvLines,
  pvs,
  receiptSubstitutes,
  stockAdjustRequests,
  stockItems,
  users,
  variationOrders,
  vendors,
  type Role,
  type SessionUser,
} from '@/db/schema';
import { APPROVAL_TYPES, NO_PROJECT_NAME, type ApprovalItem, type ApprovalType } from '@/domain/approvals';
import { DomainError } from '@/domain/errors';
import { D } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import { can } from '@/server/policy';
import { decideAdvance, decideReceiptSubstitute } from './advances';
import { decideBoqOverrun } from './boq-overrun';
import { approveCloseShort, rejectCloseShort } from './close-short';
import { poPendingGross } from './inbox';
import { approvePo, rejectPo, reviewPo } from './po';
import { approvePr, projectIdsWithPm, rejectPr } from './pr';
import { transitionPrv } from './prv';
import { approvePv, rejectPv } from './pv';
import { getSettings } from './settings';
import { decideStockAdjust } from './stock';
import { decideVo } from './variation-orders';

const APPROVER_ROLES: Role[] = ['OWNER', 'GENERAL_MANAGER', 'ADMIN', 'PM', 'PURCHASING_HEAD', 'FINANCE'];

/** Whether the approval centre is worth showing; each document is still checked against its own rule. */
export const isApprover = (actor: SessionUser): boolean => actor.roles.some((r) => APPROVER_ROLES.includes(r));

const money = (value: string): number => Number(value);

/**
 * Every document waiting on this user's decision, across the separate approval workflows.
 * Each list applies the same rule as that workflow's decision, so what is shown can be decided.
 */
export async function listPendingApprovals(db: Db, actor: SessionUser): Promise<ApprovalItem[]> {
  // Every workflow's waiting documents in one round of queries run side by side, reading only what is
  // waiting; names follow in a second round, for the documents found. A remote database answers each
  // round trip with a delay, so this runs as two waits rather than one per workflow.
  const none = Promise.resolve([] as never[]);
  const [settings, prRows, poRows, pvRows, pvProjects, closeShortRows, overrunRows, voRows, advanceRows, substituteRows, adjustRows, prvRows] =
    await Promise.all([
      getSettings(db),
      db.select().from(prs).where(inArray(prs.status, ['SUBMITTED', 'OWNER_REVIEW'])),
      // A new PO waiting for the purchasing head or for approval, or an approved one with a revision waiting
      db
        .select()
        .from(pos)
        .where(or(eq(pos.status, 'PENDING_REVIEW'), eq(pos.status, 'PENDING_APPROVAL'), isNotNull(pos.pendingRevision)))
        .orderBy(desc(pos.createdAt)),
      can(actor, 'pv.approve') ? db.select().from(pvs).where(eq(pvs.status, 'PENDING_APPROVAL')) : none,
      can(actor, 'pv.approve')
        ? db
            .select({ pvId: pvLines.pvId, projectId: payables.projectId })
            .from(pvLines)
            .innerJoin(payables, eq(payables.id, pvLines.payableId))
            .innerJoin(pvs, eq(pvs.id, pvLines.pvId))
            .where(eq(pvs.status, 'PENDING_APPROVAL'))
        : none,
      can(actor, 'closeShort.approve')
        ? db
            .select({ r: closeShortRequests, poNumber: pos.number, poProjectId: pos.projectId })
            .from(closeShortRequests)
            .leftJoin(pos, eq(pos.id, closeShortRequests.poId))
            .where(eq(closeShortRequests.status, 'PENDING'))
        : none,
      can(actor, 'boqOverrun.approve') ? db.select().from(boqOverrunRequests).where(eq(boqOverrunRequests.status, 'PENDING')) : none,
      db.select().from(variationOrders).where(eq(variationOrders.status, 'PENDING')),
      can(actor, 'advance.approve') ? db.select().from(advances).where(eq(advances.status, 'PENDING')) : none,
      can(actor, 'advance.pay') ? db.select().from(receiptSubstitutes).where(eq(receiptSubstitutes.status, 'PENDING')) : none,
      can(actor, 'stock.approveAdjust')
        ? db
            .select({ r: stockAdjustRequests, itemName: stockItems.name })
            .from(stockAdjustRequests)
            .innerJoin(stockItems, eq(stockItems.id, stockAdjustRequests.stockItemId))
            .where(eq(stockAdjustRequests.status, 'PENDING'))
        : none,
      db.select().from(prvs).where(or(eq(prvs.status, 'SUBMITTED'), eq(prvs.status, 'PM_VERIFIED'))),
    ]);
  const poLimit = D(settings.poApprovalLimit);

  // Names for the documents found, and which of their projects have a PM
  const projectIds = new Set<string>();
  const userIds = new Set<string>();
  const vendorIds = new Set<string>();
  const note = (projectId: string | null | undefined, userId: string | null | undefined, vendorId?: string | null) => {
    if (projectId) projectIds.add(projectId);
    if (userId) userIds.add(userId);
    if (vendorId) vendorIds.add(vendorId);
  };
  prRows.forEach((r) => note(r.projectId, r.requestedBy));
  poRows.forEach((r) => note(r.projectId, r.createdBy, r.vendorId));
  pvRows.forEach((r) => note(null, r.createdBy, r.vendorId));
  pvProjects.forEach((r) => note(r.projectId, null));
  closeShortRows.forEach(({ r, poProjectId }) => note(poProjectId, r.requestedBy));
  overrunRows.forEach((r) => note(r.projectId, r.requestedBy));
  voRows.forEach((r) => note(r.projectId, r.requestedBy));
  advanceRows.forEach((r) => note(r.projectId, r.payeeId));
  substituteRows.forEach((r) => note(r.projectId, r.payerId));
  adjustRows.forEach(({ r }) => note(r.projectId, r.requestedBy));
  prvRows.forEach((r) => note(r.projectId, r.requestedBy));

  const [withPm, projectRows, userRows, vendorRows] = await Promise.all([
    projectIdsWithPm(db, [...new Set(prRows.map((p) => p.projectId))]),
    projectIds.size ? db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, [...projectIds])) : none,
    userIds.size ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds])) : none,
    vendorIds.size ? db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, [...vendorIds])) : none,
  ]);
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  const userName = new Map(userRows.map((u) => [u.id, u.name]));
  const vendorName = new Map(vendorRows.map((v) => [v.id, v.name]));

  const item = (
    fields: Pick<ApprovalItem, 'type' | 'id' | 'number' | 'title' | 'amount' | 'href'> & { projectId: string | null; createdAt: Date; requesterId: string },
  ): ApprovalItem => ({
    type: fields.type,
    id: fields.id,
    number: fields.number,
    title: fields.title,
    amount: fields.amount,
    href: fields.href,
    projectId: fields.projectId,
    projectName: (fields.projectId && projectName.get(fields.projectId)) || NO_PROJECT_NAME,
    date: bangkokDateString(fields.createdAt),
    requesterName: userName.get(fields.requesterId) ?? '-',
  });

  const result: ApprovalItem[] = [];

  // The PM decides submitted PRs; PRs over the BOQ then wait on the owner, who sees a submitted PR only on a project without a PM
  for (const pr of prRows) {
    const atOwner = pr.status === 'OWNER_REVIEW';
    if (!can(actor, atOwner ? 'pr.approveOverBoq' : 'pr.approve', { projectId: pr.projectId, projectHasPm: withPm.has(pr.projectId) })) continue;
    const title = atOwner ? 'ขออนุมัติซื้อเกิน BOQ (PM อนุมัติแล้ว)' : 'ขออนุมัติซื้อวัสดุ';
    result.push(item({ type: 'PR', id: pr.id, number: pr.number, title, amount: null, href: `/pr/${pr.id}`, projectId: pr.projectId, createdAt: pr.createdAt, requesterId: pr.requestedBy }));
  }

  for (const po of poRows) {
    // The purchasing head decides first; the approver sees the PO once the head has passed it on
    const reviewing = po.status === 'PENDING_REVIEW';
    const waitsOnMe = reviewing
      ? can(actor, 'po.review', { createdBy: po.createdBy })
      : (() => {
          const gross = poPendingGross(po);
          return Boolean(gross) && can(actor, 'po.approve', { gross: gross!, poApprovalLimit: poLimit, createdBy: po.createdBy });
        })();
    if (!waitsOnMe) continue;
    const gross = poPendingGross(po) ?? D(po.gross);
    result.push(item({ type: reviewing ? 'PO_REVIEW' : 'PO', id: po.id, number: po.number, title: vendorName.get(po.vendorId) ?? '', amount: gross.toNumber(), href: `/po/${po.id}`, projectId: po.projectId, createdAt: po.createdAt, requesterId: po.createdBy }));
  }

  for (const pv of pvRows) {
    const ids = new Set(pvProjects.filter((l) => l.pvId === pv.id).map((l) => l.projectId));
    const projectId = ids.size === 1 ? [...ids][0]! : null;
    result.push(item({ type: 'PV', id: pv.id, number: pv.number, title: vendorName.get(pv.vendorId) ?? '', amount: money(pv.net), href: `/pv/${pv.id}`, projectId, createdAt: pv.createdAt, requesterId: pv.createdBy }));
  }

  for (const { r, poNumber, poProjectId } of closeShortRows) {
    result.push(item({ type: 'CLOSE_SHORT', id: r.id, number: poNumber ?? '-', title: r.reason, amount: null, href: `/po/${r.poId}`, projectId: poProjectId ?? null, createdAt: r.createdAt, requesterId: r.requestedBy }));
  }

  for (const r of overrunRows) {
    result.push(item({ type: 'BOQ_OVERRUN', id: r.id, number: r.number, title: r.reason, amount: money(r.overAmount), href: `/po/${r.poId}`, projectId: r.projectId, createdAt: r.createdAt, requesterId: r.requestedBy }));
  }

  for (const vo of voRows) {
    if (!can(actor, 'vo.approve', { projectId: vo.projectId })) continue;
    result.push(item({ type: 'VO', id: vo.id, number: vo.number, title: vo.title, amount: D(vo.addAmount).minus(vo.deductAmount).toNumber(), href: `/projects/${vo.projectId}?tab=vo`, projectId: vo.projectId, createdAt: vo.createdAt, requesterId: vo.requestedBy }));
  }

  for (const a of advanceRows) {
    // Nobody decides their own advance
    if (a.payeeId === actor.id) continue;
    result.push(item({ type: 'ADVANCE', id: a.id, number: a.number, title: a.purpose, amount: money(a.amount), href: `/advances/${a.id}`, projectId: a.projectId, createdAt: a.createdAt, requesterId: a.payeeId }));
  }

  for (const rs of substituteRows) {
    if (rs.payerId === actor.id) continue;
    result.push(item({ type: 'RECEIPT_SUBSTITUTE', id: rs.id, number: rs.number ?? '-', title: 'ค่าใช้จ่ายที่ไม่มีใบเสร็จ', amount: money(rs.total), href: `/receipt-substitutes/${rs.id}`, projectId: rs.projectId, createdAt: rs.createdAt, requesterId: rs.payerId }));
  }

  for (const { r, itemName } of adjustRows) {
    if (r.requestedBy === actor.id) continue;
    result.push(item({ type: 'STOCK_ADJUST', id: r.id, number: r.requestNumber, title: `${itemName}: ${r.reason}`, amount: null, href: '/stock?tab=stock-adjust', projectId: r.projectId, createdAt: r.createdAt, requesterId: r.requestedBy }));
  }

  for (const prv of prvRows) {
    if (prv.requestedBy === actor.id) continue;
    const verifying = prv.status === 'SUBMITTED';
    if (!can(actor, verifying ? 'prv.verify' : 'prv.approve', { projectId: prv.projectId })) continue;
    result.push(item({ type: verifying ? 'PRV_VERIFY' : 'PRV_APPROVE', id: prv.id, number: prv.prvNumber, title: prv.payeeName, amount: money(prv.netAmount), href: `/prv/${prv.id}`, projectId: prv.projectId, createdAt: prv.createdAt, requesterId: prv.requestedBy }));
  }

  return result.sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number));
}

/** How many documents wait on this user: the number on the K Tec Approve menu */
export async function countPendingApprovals(db: Db, actor: SessionUser): Promise<number> {
  return (await listPendingApprovals(db, actor)).length;
}

const decisionSchema = z.object({
  type: z.enum(APPROVAL_TYPES),
  id: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().max(1000).default(''),
});

/**
 * Applies a decision through the document's own workflow, which checks permission and state and sends
 * notifications. The two PRV types, and the PO's review and approval, are separate so a stale screen can
 * never approve past the step it showed.
 */
export async function decideApproval(
  db: Db,
  actor: SessionUser,
  input: { type: ApprovalType; id: string; approve: boolean; note?: string },
): Promise<void> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_INPUT', 'ข้อมูลการอนุมัติไม่ถูกต้อง');
  const { type, id, approve, note } = parsed.data;

  switch (type) {
    case 'PR':
      return approve ? approvePr(db, actor, id) : rejectPr(db, actor, id, note);
    case 'PO':
      return approve ? approvePo(db, actor, id) : rejectPo(db, actor, id, note);
    // The purchasing head's check; approving passes the PO on to the owner, never past them
    case 'PO_REVIEW':
      return approve ? reviewPo(db, actor, id) : rejectPo(db, actor, id, note);
    case 'PV':
      await (approve ? approvePv(db, actor, id, note) : rejectPv(db, actor, id, note));
      return;
    case 'CLOSE_SHORT':
      await (approve ? approveCloseShort(db, actor, id) : rejectCloseShort(db, actor, id, note));
      return;
    case 'BOQ_OVERRUN':
      return decideBoqOverrun(db, actor, id, approve, note);
    case 'VO':
      return decideVo(db, actor, id, approve, note);
    case 'ADVANCE':
      return decideAdvance(db, actor, id, approve, note);
    case 'RECEIPT_SUBSTITUTE':
      return decideReceiptSubstitute(db, actor, id, approve, note);
    case 'STOCK_ADJUST':
      await decideStockAdjust(db, actor, id, approve);
      return;
    case 'PRV_VERIFY':
      await transitionPrv(db, actor, id, approve ? 'verify' : 'reject', note);
      return;
    case 'PRV_APPROVE':
      await transitionPrv(db, actor, id, approve ? 'approve' : 'reject', note);
      return;
  }
}
