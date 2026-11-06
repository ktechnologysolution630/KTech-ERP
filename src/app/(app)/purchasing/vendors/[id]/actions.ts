'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { updateVendor } from '@/server/services/vendor-detail';

export async function updateVendorAction(id: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireUser();
  const db = await getDb();
  const text = (key: string) => String(formData.get(key) ?? '');
  try {
    await updateVendor(db, actor, id, {
      name: text('name'),
      type: text('type') === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY',
      taxId: text('taxId') || null,
      branch: text('branch') || '00000',
      address: text('address'),
      altAddress: text('altAddress'),
      contactPerson: text('contactPerson'),
      phone: text('phone'),
      email: text('email'),
      fax: text('fax'),
      suppliedItems: text('suppliedItems'),
      defaultCreditDays: Number(text('defaultCreditDays')),
      defaultWhtRate: Number(text('defaultWhtRate')),
      bankName: text('bankName'),
      bankAccountNo: text('bankAccountNo'),
      bankAccountName: text('bankAccountName'),
    });
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/purchasing/vendors');
  revalidatePath(`/purchasing/vendors/${id}`);
  return { ok: true };
}
