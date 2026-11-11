'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import { deleteVendors } from '@/server/services/vendor-delete';
import type { VendorDeleteActionResult } from '@/components/vendor-delete';

/** Deletes the ticked suppliers; ones still named on documents are kept and reported. */
export async function deleteSuppliersAction(ids: string[]): Promise<VendorDeleteActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    const result = await deleteVendors(db, actor, ids);
    revalidatePath('/purchasing/vendors');
    revalidatePath('/labor-payments/contractors');
    return { ok: true, result };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
