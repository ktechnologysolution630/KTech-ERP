import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { settings, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, round2 } from '@/domain/money';

export type Settings = typeof settings.$inferSelect;

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(settings).limit(1);
  if (rows.length > 0) return rows[0];
  const inserted = await db
    .insert(settings)
    .values({
      companyName: 'บริษัท เค เทค เอ็นจิเนียริ่ง จำกัด',
      companyAddress: 'กรุงเทพมหานคร',
      companyTaxId: '0105500000000',
      companyBranch: '00000',
      poApprovalLimit: '50000.00',
    })
    .returning();
  return inserted[0];
}

const patchSchema = z.object({
  companyName: z.string().min(1).optional(),
  companyAddress: z.string().optional(),
  companyTaxId: z.string().optional(),
  companyBranch: z.string().optional(),
  logoUrl: z.string().nullable().optional(),
  poApprovalLimit: z.union([z.string(), z.number()]).optional(),
});

export async function updateSettings(
  db: Db,
  actor: SessionUser,
  patch: z.infer<typeof patchSchema>,
): Promise<Settings> {
  if (!actor.roles.includes('ADMIN') && !actor.roles.includes('OWNER')) {
    throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์แก้ไขการตั้งค่า', 403);
  }
  const parsed = patchSchema.parse(patch);
  const current = await getSettings(db);
  const limitStr =
    parsed.poApprovalLimit !== undefined
      ? round2(D(parsed.poApprovalLimit)).toFixed(2)
      : current.poApprovalLimit;

  const updated = await db
    .update(settings)
    .set({
      companyName: parsed.companyName ?? current.companyName,
      companyAddress: parsed.companyAddress ?? current.companyAddress,
      companyTaxId: parsed.companyTaxId ?? current.companyTaxId,
      companyBranch: parsed.companyBranch ?? current.companyBranch,
      logoUrl: parsed.logoUrl !== undefined ? parsed.logoUrl : current.logoUrl,
      poApprovalLimit: limitStr,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, current.id))
    .returning();
  return updated[0];
}
