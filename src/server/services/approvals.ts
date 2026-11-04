import { desc, eq, inArray, or } from 'drizzle-orm';
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
import { approvePo, rejectPo } from './po';
import { approvePr, rejectPr } from './pr';
import { transitionPrv } from './prv';
import { approvePv, rejectPv } from './pv';
import { getSettings } from './settings';
import { decideStockAdjust } from './stock';
import { decideVo } from './variation-orders';

const APPROVER_ROLES: Role[] = ['OWNER', 'ADMIN', 'PM', 'PURCHASING_HEAD', 'FINANCE'];

/** Whether the approval centre is worth showing; each document is still checked against its own rule. */
export const isApprover = (actor: SessionUser): boolean => actor.roles.some((r) => APPROVER_ROLES.includes(r));

const money = (value: string): number => Number(value);

/**
 * Every document waiting on this user's decision, across the separate approval workflows.
 * Each list applies the same rule as that workflow's decision, so what is shown can be decided.
 */
export async function listPendingApprovals(db: Db, actor: SessionUser): Promise<ApprovalItem[]> {
  const [projectRows, userRows, vendorRows, settings] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects),
    db.select({ id: users.id, name: users.name }).from(users),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors),
    getSettings(db),
  ]);
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  const userName = new Map(userRows.map((u) => [u.id, u.name]));
  const vendorName = new Map(vendorRows.map((v) => [v.id, v.name]));
  const poLimit = D(settings.poApprovalLimit);

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

  const prRows = await db.select().from(prs).where(eq(prs.status, 'SUBMITTED'));
  for (const pr of prRows) {
    if (!can(actor, 'pr.approve', { projectId: pr.projectId })) continue;
    result.push(item({ type: 'PR', id: pr.id, number: pr.number, title: 'ขออนุมัติซื้อวัสดุ', amount: null, href: `/pr/${pr.id}`, projectId: pr.projectId, createdAt: pr.createdAt, requesterId: pr.requestedBy }));
  }

  const poRows = await db.select().from(pos).orderBy(desc(pos.createdAt));
  const poById = new Map(poRows.map((p) => [p.id, p]));
  for (const po of poRows) {
    const gross = poPendingGross(po);
    if (!gross || !can(actor, 'po.approve', { gross, poApprovalLimit: poLimit, createdBy: po.createdBy })) continue;
    result.push(item({ type: 'PO', id: po.id, number: po.number, title: vendorName.get(po.vendorId) ?? '', amount: gross.toNumber(), href: `/po/${po.id}`, projectId: po.projectId, createdAt: po.createdAt, requesterId: po.createdBy }));
  }

  if (can(actor, 'pv.approve')) {
    const pvRows = await db.select().from(pvs).where(eq(pvs.status, 'PENDING_APPROVAL'));
    const pvProjects = pvRows.length
      ? await db
          .select({ pvId: pvLines.pvId, projectId: payables.projectId })
          .from(pvLines)
          .innerJoin(payables, eq(payables.id, pvLines.payableId))
          .where(inArray(pvLines.pvId, pvRows.map((p) => p.id)))
      : [];
    for (const pv of pvRows) {
      const ids = new Set(pvProjects.filter((l) => l.pvId === pv.id).map((l) => l.projectId));
      const projectId = ids.size === 1 ? [...ids][0]! : null;
      result.push(item({ type: 'PV', id: pv.id, number: pv.number, title: vendorName.get(pv.vendorId) ?? '', amount: money(pv.net), href: `/pv/${pv.id}`, projectId, createdAt: pv.createdAt, requesterId: pv.createdBy }));
    }
  }

  if (can(actor, 'closeShort.approve')) {
    const rows = await db.select().from(closeShortRequests).where(eq(closeShortRequests.status, 'PENDING'));
    for (const r of rows) {
      const po = poById.get(r.poId);
      result.push(item({ type: 'CLOSE_SHORT', id: r.id, number: po?.number ?? '-', title: r.reason, amount: null, href: `/po/${r.poId}`, projectId: po?.projectId ?? null, createdAt: r.createdAt, requesterId: r.requestedBy }));
    }
  }

  if (can(actor, 'boqOverrun.approve')) {
    const rows = await db.select().from(boqOverrunRequests).where(eq(boqOverrunRequests.status, 'PENDING'));
    for (const r of rows) {
      result.push(item({ type: 'BOQ_OVERRUN', id: r.id, number: r.number, title: r.reason, amount: money(r.overAmount), href: `/po/${r.poId}`, projectId: r.projectId, createdAt: r.createdAt, requesterId: r.requestedBy }));
    }
  }

  const voRows = await db.select().from(variationOrders).where(eq(variationOrders.status, 'PENDING'));
  for (const vo of voRows) {
    if (!can(actor, 'vo.approve', { projectId: vo.projectId })) continue;
    result.push(item({ type: 'VO', id: vo.id, number: vo.number, title: vo.title, amount: D(vo.addAmount).minus(vo.deductAmount).toNumber(), href: `/projects/${vo.projectId}?tab=vo`, projectId: vo.projectId, createdAt: vo.createdAt, requesterId: vo.requestedBy }));
  }

  if (can(actor, 'advance.approve')) {
    const rows = await db.select().from(advances).where(eq(advances.status, 'PENDING'));
    for (const a of rows) {
      // Nobody decides their own advance
      if (a.payeeId === actor.id) continue;
      result.push(item({ type: 'ADVANCE', id: a.id, number: a.number, title: a.purpose, amount: money(a.amount), href: `/advances/${a.id}`, projectId: a.projectId, createdAt: a.createdAt, requesterId: a.payeeId }));
    }
  }

  if (can(actor, 'advance.pay')) {
    const rows = await db.select().from(receiptSubstitutes).where(eq(receiptSubstitutes.status, 'PENDING'));
    for (const rs of rows) {
      if (rs.payerId === actor.id) continue;
      result.push(item({ type: 'RECEIPT_SUBSTITUTE', id: rs.id, number: rs.number ?? '-', title: 'ค่าใช้จ่ายที่ไม่มีใบเสร็จ', amount: money(rs.total), href: `/receipt-substitutes/${rs.id}`, projectId: rs.projectId, createdAt: rs.createdAt, requesterId: rs.payerId }));
    }
  }

  if (can(actor, 'stock.approveAdjust')) {
    const rows = await db
      .select({ r: stockAdjustRequests, itemName: stockItems.name })
      .from(stockAdjustRequests)
      .innerJoin(stockItems, eq(stockItems.id, stockAdjustRequests.stockItemId))
      .where(eq(stockAdjustRequests.status, 'PENDING'));
    for (const { r, itemName } of rows) {
      if (r.requestedBy === actor.id) continue;
      result.push(item({ type: 'STOCK_ADJUST', id: r.id, number: r.requestNumber, title: `${itemName}: ${r.reason}`, amount: null, href: '/stock?tab=document-history', projectId: r.projectId, createdAt: r.createdAt, requesterId: r.requestedBy }));
    }
  }

  const prvRows = await db.select().from(prvs).where(or(eq(prvs.status, 'SUBMITTED'), eq(prvs.status, 'PM_VERIFIED')));
  for (const prv of prvRows) {
    if (prv.requestedBy === actor.id) continue;
    const verifying = prv.status === 'SUBMITTED';
    if (!can(actor, verifying ? 'prv.verify' : 'prv.approve', { projectId: prv.projectId })) continue;
    result.push(item({ type: verifying ? 'PRV_VERIFY' : 'PRV_APPROVE', id: prv.id, number: prv.prvNumber, title: prv.payeeName, amount: money(prv.netAmount), href: `/prv/${prv.id}`, projectId: prv.projectId, createdAt: prv.createdAt, requesterId: prv.requestedBy }));
  }

  return result.sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number));
}

const decisionSchema = z.object({
  type: z.enum(APPROVAL_TYPES),
  id: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().max(1000).default(''),
});

/**
 * Applies a decision through the document's own workflow, which checks permission and state and sends
 * notifications. The two PRV types are separate so a stale screen can never approve past the step it showed.
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
