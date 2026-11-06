import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { invoices, milestones, payables, pos, prvs, pvs, vendors, whtCerts, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';

const idsSchema = z.array(z.string().uuid()).min(1, 'กรุณาเลือกรายการที่จะลบ').max(5000, 'เลือกได้ครั้งละไม่เกิน 5,000 รายการ');

export interface VendorDeleteResult {
  deletedIds: string[];
  /** Vendors documents still name; those documents would lose who was paid */
  inUse: { id: string; code: string; name: string }[];
}

/** Removes the vendors no document mentions and reports the rest, so one in use does not hold up the others. */
export async function deleteVendors(db: Db, actor: SessionUser, ids: string[]): Promise<VendorDeleteResult> {
  assertCan(actor, 'vendor.delete');
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) throw new DomainError('INVALID_VENDOR', parsed.error.issues[0]!.message);

  return db.transaction(async (tx) => {
    // Adding a document for one of these waits on this lock, then fails because the vendor is gone
    const targets = await tx.select({ id: vendors.id, code: vendors.code, name: vendors.name }).from(vendors).where(inArray(vendors.id, parsed.data)).for('update');
    if (targets.length === 0) throw new DomainError('NOT_FOUND', 'ไม่พบรายการที่เลือก อาจถูกลบไปแล้ว', 404);
    const targetIds = targets.map((v) => v.id);

    const references = await Promise.all([
      tx.select({ id: pos.vendorId }).from(pos).where(inArray(pos.vendorId, targetIds)),
      tx.select({ id: invoices.vendorId }).from(invoices).where(inArray(invoices.vendorId, targetIds)),
      tx.select({ id: payables.vendorId }).from(payables).where(inArray(payables.vendorId, targetIds)),
      tx.select({ id: pvs.vendorId }).from(pvs).where(inArray(pvs.vendorId, targetIds)),
      tx.select({ id: whtCerts.vendorId }).from(whtCerts).where(inArray(whtCerts.vendorId, targetIds)),
      tx.select({ id: prvs.vendorId }).from(prvs).where(inArray(prvs.vendorId, targetIds)),
      tx.select({ id: milestones.vendorId }).from(milestones).where(inArray(milestones.vendorId, targetIds)),
    ]);
    const used = new Set(references.flat().map((r) => r.id));
    const removable = targets.filter((v) => !used.has(v.id));

    for (const vendor of removable) {
      await tx.delete(vendors).where(eq(vendors.id, vendor.id));
      await logActivity(tx, { entityType: 'VENDOR', entityId: vendor.id, action: 'DELETE', userId: actor.id, note: `${vendor.code} ${vendor.name}` });
    }
    return { deletedIds: removable.map((v) => v.id), inUse: targets.filter((v) => used.has(v.id)) };
  });
}
