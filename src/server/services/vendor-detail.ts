import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { vendors, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { isSiteScopedOnly } from '@/server/policy';
import { documentsOf, type VendorDocument } from './vendor-delete';

/** One vendor with every document naming it. For office roles: it shows bank details and spans all projects. */
export async function getVendorDetail(db: Db, actor: SessionUser, id: string) {
  if (isSiteScopedOnly(actor)) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดูข้อมูลผู้ขาย', 403);
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ขาย', 404);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
  if (!vendor) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ขาย', 404);
  const documents: VendorDocument[] = (await documentsOf(db, [id])).get(id) ?? [];
  return { vendor, documents };
}
