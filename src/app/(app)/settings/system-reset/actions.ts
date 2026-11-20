'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import { resetSystem, type SystemResetPreview } from '@/server/services/system-reset';

export async function resetSystemAction(confirm: string): Promise<{ ok: true; result: SystemResetPreview } | { ok: false; error: string }> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    const result = await resetSystem(db, actor, confirm);
    revalidatePath('/', 'layout');
    return { ok: true, result };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
