import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { attachments, comments, closeShortRequests, invoices, notifications, payables, pos, prvs, pvLines, pvs, receipts, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { removeStoredFile } from './attachments';
import { lockPo } from './po';
import { type VendorDocument } from './vendor-delete';

export interface PoDeletionPreview {
  /** What must be dealt with first; empty when the PO can go */
  holders: VendorDocument[];
  /** What goes with the PO; rows with nothing to remove are left out */
  goesWith: { label: string; count: number }[];
}

const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id);

/**
 * Goods received moved stock and a live bill or PV is money, so those hold the PO. A cancelled PV holds it too,
 * as the record of what was paid or tried. What is left has neither, and goes with the PO.
 */
async function collect(db: Db, poId: string) {
  const receiptRows = await db.select({ id: receipts.id, deliveryNoteNo: receipts.deliveryNoteNo, receivedAt: receipts.receivedAt, status: receipts.status }).from(receipts).where(eq(receipts.poId, poId));
  const invoiceRows = await db.select({ id: invoices.id, invoiceNo: invoices.invoiceNo, status: invoices.status }).from(invoices).where(eq(invoices.poId, poId));
  const payableRows = await db.select({ id: payables.id, status: payables.status, note: payables.note }).from(payables).where(eq(payables.poId, poId));
  const closeShortIds = idsOf(await db.select({ id: closeShortRequests.id }).from(closeShortRequests).where(eq(closeShortRequests.poId, poId)));
  const claimRows = await db.select({ id: prvs.id, prvNumber: prvs.prvNumber, status: prvs.status }).from(prvs).where(eq(prvs.poId, poId));
  const pvRows = await db
    .selectDistinct({ id: pvs.id, number: pvs.number, status: pvs.status })
    .from(pvLines)
    .innerJoin(pvs, eq(pvs.id, pvLines.pvId))
    .where(inArray(pvLines.payableId, idsOf(payableRows)));

  const onPv = new Set(
    (await db.select({ payableId: pvLines.payableId }).from(pvLines).where(inArray(pvLines.payableId, idsOf(payableRows)))).map((l) => l.payableId),
  );
  const holders: VendorDocument[] = [
    ...receiptRows.map((r) => ({ label: 'ใบรับของ', number: r.deliveryNoteNo || `รับเมื่อ ${r.receivedAt}`, href: `/po/${poId}`, cancelled: r.status === 'CANCELLED' })),
    ...invoiceRows.filter((i) => i.status === 'ACTIVE').map((i) => ({ label: 'ใบแจ้งหนี้', number: i.invoiceNo, href: `/invoices/${i.id}`, cancelled: false })),
    ...pvRows.map((p) => ({ label: 'ใบสำคัญจ่าย PV', number: p.number, href: `/pv/${p.id}`, cancelled: p.status === 'CANCELLED' })),
    ...claimRows.map((c) => ({ label: 'ใบขอเบิก PRV', number: c.prvNumber, href: `/prv/${c.id}`, cancelled: false })),
    // Paid or on a PV without a line to show for it should not happen, but must not be removed if it does
    ...payableRows
      .filter((p) => !onPv.has(p.id) && (p.status === 'PAID' || p.status === 'IN_PV'))
      .map((p) => ({ label: 'รายการตั้งจ่าย', number: p.note || p.status, href: '/payables', cancelled: false })),
  ];

  return {
    holders,
    invoiceIds: idsOf(invoiceRows),
    cancelledInvoices: invoiceRows.filter((i) => i.status === 'CANCELLED').length,
    payableIds: idsOf(payableRows),
    openPayables: payableRows.filter((p) => p.status !== 'CANCELLED').length,
    closeShortIds,
  };
}

const parseId = (id: string) => {
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', 'ไม่พบใบสั่งซื้อ', 404);
};

/** Shown before anyone confirms, so they can see what holds the PO or what would go with it. */
export async function previewPoDeletion(db: Db, actor: SessionUser, id: string): Promise<PoDeletionPreview> {
  assertCan(actor, 'po.delete');
  parseId(id);
  const d = await collect(db, id);
  const entityIds = [id, ...d.invoiceIds, ...d.payableIds, ...d.closeShortIds];
  const [[files], [notes]] = await Promise.all([
    db.select({ n: count() }).from(attachments).where(inArray(attachments.entityId, entityIds)),
    db.select({ n: count() }).from(comments).where(inArray(comments.entityId, entityIds)),
  ]);
  const goesWith = [
    { label: 'รายการตั้งจ่ายที่ยังไม่ออก PV', count: d.openPayables },
    { label: 'ใบแจ้งหนี้ที่ยกเลิกแล้ว', count: d.cancelledInvoices },
    { label: 'ไฟล์แนบ', count: files?.n ?? 0 },
    { label: 'ความคิดเห็น', count: notes?.n ?? 0 },
  ].filter((i) => i.count > 0);
  return { holders: d.holders, goesWith };
}

const isForeignKeyViolation = (err: unknown): boolean => {
  const { code, cause } = err as { code?: string; cause?: { code?: string } };
  return code === '23503' || cause?.code === '23503';
};

/** Permanently removes a PO nothing depends on. Its number is not reused, and the activity log keeps the record. */
export async function deletePo(db: Db, actor: SessionUser, id: string): Promise<void> {
  assertCan(actor, 'po.delete');
  parseId(id);

  try {
    await db.transaction(async (tx) => {
      // Receiving against the PO or billing it takes this lock first
      const po = await lockPo(tx, id);
      const d = await collect(tx, id);
      if (d.holders.length > 0) {
        throw new DomainError('PO_IN_USE', `${po.number} มีเอกสารอ้างอิงอยู่: ${d.holders.map((h) => `${h.label} ${h.number}`).join(', ')}`, 409);
      }

      const entityIds = [id, ...d.invoiceIds, ...d.payableIds, ...d.closeShortIds];
      const files = await tx.select({ url: attachments.url }).from(attachments).where(inArray(attachments.entityId, entityIds));
      await tx.delete(attachments).where(inArray(attachments.entityId, entityIds));
      await tx.delete(comments).where(inArray(comments.entityId, entityIds));
      for (const file of files) await removeStoredFile(tx, file.url);

      await tx.delete(payables).where(eq(payables.poId, id));
      await tx.delete(invoices).where(and(eq(invoices.poId, id), ne(invoices.status, 'ACTIVE')));
      await tx.delete(notifications).where(eq(notifications.href, `/po/${id}`));
      await tx.delete(pos).where(eq(pos.id, id));
      await logActivity(tx, { entityType: 'PO', entityId: id, action: 'DELETE', userId: actor.id, note: `${po.number} ${po.gross} บาท สถานะ ${po.status}` });
    });
  } catch (err) {
    // Something began pointing at the PO while this ran; nothing has been removed
    if (isForeignKeyViolation(err)) {
      throw new DomainError('PO_IN_USE', 'มีเอกสารอื่นอ้างถึงใบสั่งซื้อนี้อยู่ จึงยังไม่ได้ลบ กรุณาลองใหม่อีกครั้ง', 409);
    }
    throw err;
  }
}
