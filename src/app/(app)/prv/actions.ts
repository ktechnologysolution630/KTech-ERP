'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { createPrv, transitionPrv, type CreatePrvInput, type PrvTransition } from '@/server/services/prv';

export type PrvActionResult = { ok: true; id?: string } | { ok: false; error: string };

export async function createPrvAction(input: CreatePrvInput): Promise<PrvActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    const prv = await createPrv(db, actor, input);
    revalidatePath('/prv');
    return { ok: true, id: prv.id };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function transitionPrvAction(id: string, action: PrvTransition, note = ''): Promise<PrvActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    await transitionPrv(db, actor, id, action, note);
    revalidatePath('/prv');
    revalidatePath(`/prv/${id}`);
    revalidatePath('/payables');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
