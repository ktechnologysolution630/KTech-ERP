import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { invoices, milestones, payables, pos, prvs, pvLines, pvs, vendors, whtCerts, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';

const idsSchema = z.array(z.string().uuid()).min(1, 'กรุณาเลือกรายการที่จะลบ').max(5000, 'เลือกได้ครั้งละไม่เกิน 5,000 รายการ');

export interface VendorDocument {
  label: string;
  number: string;
  /** Page where the document can be opened */
  href: string;
  cancelled: boolean;
}

export interface VendorDeleteResult {
  deletedIds: string[];
  /** Vendors documents still name; those documents would lose who was paid */
  inUse: { id: string; code: string; name: string; documents: VendorDocument[] }[];
}

/** Every document naming these vendors, by vendor. A payable already cancelled and on no PV is left out: nothing depends on it. */
async function documentsOf(tx: Db, vendorIds: string[]): Promise<Map<string, VendorDocument[]>> {
  const [poRows, invoiceRows, pvRows, whtRows, prvRows, milestoneRows, payableRows] = await Promise.all([
    tx.select({ vendorId: pos.vendorId, id: pos.id, number: pos.number, status: pos.status }).from(pos).where(inArray(pos.vendorId, vendorIds)),
    tx.select({ vendorId: invoices.vendorId, id: invoices.id, number: invoices.invoiceNo, status: invoices.status }).from(invoices).where(inArray(invoices.vendorId, vendorIds)),
    tx.select({ vendorId: pvs.vendorId, id: pvs.id, number: pvs.number, status: pvs.status }).from(pvs).where(inArray(pvs.vendorId, vendorIds)),
    tx.select({ vendorId: whtCerts.vendorId, pvId: whtCerts.pvId, number: whtCerts.number, status: whtCerts.status }).from(whtCerts).where(inArray(whtCerts.vendorId, vendorIds)),
    tx.select({ vendorId: prvs.vendorId, id: prvs.id, number: prvs.prvNumber }).from(prvs).where(inArray(prvs.vendorId, vendorIds)),
    tx.select({ vendorId: milestones.vendorId, projectId: milestones.projectId, title: milestones.title }).from(milestones).where(inArray(milestones.vendorId, vendorIds)),
    tx.select({ vendorId: payables.vendorId, id: payables.id, poId: payables.poId, note: payables.note, gross: payables.gross, status: payables.status }).from(payables).where(inArray(payables.vendorId, vendorIds)),
  ]);
  const onPv = new Set((await tx.select({ id: pvLines.payableId }).from(pvLines).where(inArray(pvLines.payableId, payableRows.map((p) => p.id)))).map((l) => l.id));

  const byVendor = new Map<string, VendorDocument[]>();
  const add = (vendorId: string | null, doc: VendorDocument) => {
    if (vendorId) byVendor.set(vendorId, [...(byVendor.get(vendorId) ?? []), doc]);
  };
  for (const r of poRows) add(r.vendorId, { label: 'ใบสั่งซื้อ PO', number: r.number, href: `/po/${r.id}`, cancelled: r.status === 'CANCELLED' });
  for (const r of invoiceRows) add(r.vendorId, { label: 'ใบแจ้งหนี้', number: r.number, href: `/invoices/${r.id}`, cancelled: r.status === 'CANCELLED' });
  for (const r of pvRows) add(r.vendorId, { label: 'ใบสำคัญจ่าย PV', number: r.number, href: `/pv/${r.id}`, cancelled: r.status === 'CANCELLED' });
  for (const r of whtRows) add(r.vendorId, { label: '50 ทวิ', number: r.number, href: `/pv/${r.pvId}`, cancelled: r.status === 'VOID' });
  for (const r of prvRows) add(r.vendorId, { label: 'ใบขอเบิก PRV', number: r.number, href: `/prv/${r.id}`, cancelled: false });
  for (const r of milestoneRows) add(r.vendorId, { label: 'งวดงาน', number: r.title, href: `/labor-payments/${r.projectId}`, cancelled: false });
  for (const r of payableRows) {
    if (r.status === 'CANCELLED' && !onPv.has(r.id)) continue;
    add(r.vendorId, { label: 'รายการตั้งจ่าย', number: r.note.split(' · ')[0] || `${r.gross} บาท`, href: r.poId ? `/po/${r.poId}` : '/payables', cancelled: r.status === 'CANCELLED' });
  }
  return byVendor;
}

/** Removes the vendors no document mentions and reports the rest with their documents, so one in use does not hold up the others. */
export async function deleteVendors(db: Db, actor: SessionUser, ids: string[]): Promise<VendorDeleteResult> {
  assertCan(actor, 'vendor.delete');
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) throw new DomainError('INVALID_VENDOR', parsed.error.issues[0]!.message);

  return db.transaction(async (tx) => {
    // Adding a document for one of these waits on this lock, then fails because the vendor is gone
    const targets = await tx.select({ id: vendors.id, code: vendors.code, name: vendors.name }).from(vendors).where(inArray(vendors.id, parsed.data)).for('update');
    if (targets.length === 0) throw new DomainError('NOT_FOUND', 'ไม่พบรายการที่เลือก อาจถูกลบไปแล้ว', 404);

    const documents = await documentsOf(tx, targets.map((v) => v.id));
    const removable = targets.filter((v) => !documents.has(v.id));

    for (const vendor of removable) {
      // Payables cancelled along with a deleted claim are all that can remain, and they would hold the vendor for good
      await tx.delete(payables).where(and(eq(payables.vendorId, vendor.id), eq(payables.status, 'CANCELLED')));
      await tx.delete(vendors).where(eq(vendors.id, vendor.id));
      await logActivity(tx, { entityType: 'VENDOR', entityId: vendor.id, action: 'DELETE', userId: actor.id, note: `${vendor.code} ${vendor.name}` });
    }
    return {
      deletedIds: removable.map((v) => v.id),
      inUse: targets.flatMap((v) => {
        const docs = documents.get(v.id);
        return docs ? [{ ...v, documents: docs }] : [];
      }),
    };
  });
}
