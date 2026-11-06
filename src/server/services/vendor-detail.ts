import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { vendors, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { upsertVendor } from './master';
import { documentsOf, type VendorDocument } from './vendor-delete';

export type VendorEdit = Omit<Parameters<typeof upsertVendor>[2], 'id' | 'code' | 'active'>;

async function findVendor(db: Db, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ขาย', 404);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
  if (!vendor) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ขาย', 404);
  return vendor;
}

/** One vendor with every document naming it. For office roles: it shows bank details and spans all projects. */
export async function getVendorDetail(db: Db, actor: SessionUser, id: string) {
  if (isSiteScopedOnly(actor)) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดูข้อมูลผู้ขาย', 403);
  const vendor = await findVendor(db, id);
  const documents: VendorDocument[] = (await documentsOf(db, [id])).get(id) ?? [];
  return { vendor, documents };
}

/** Its code and active state stay as they are. The log names the fields changed, so a changed bank account can be traced. */
export async function updateVendor(db: Db, actor: SessionUser, id: string, edit: VendorEdit) {
  assertCan(actor, 'master.manage');
  const vendor = await findVendor(db, id);
  const changed = Object.entries(edit)
    .filter(([field, value]) => String(value ?? '') !== String(vendor[field as keyof typeof vendor] ?? ''))
    .map(([field]) => field);
  return db.transaction(async (tx) => {
    const saved = await upsertVendor(tx, actor, { ...edit, id, code: vendor.code, active: vendor.active });
    await logActivity(tx, { entityType: 'VENDOR', entityId: id, action: 'UPDATE', userId: actor.id, note: changed.join(', ') });
    return saved;
  });
}
