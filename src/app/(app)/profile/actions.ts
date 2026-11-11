'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { deleteMySignature, saveMySignature } from '@/server/services/signatures';

type Result = { ok: true } | { ok: false; error: string };

/** Sets the signed-in person's own signature */
export async function saveSignatureAction(image: string): Promise<Result> {
  const actor = await requireUser();
  try {
    await saveMySignature(await getDb(), actor, image);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/profile');
  return { ok: true };
}

export async function deleteSignatureAction(): Promise<Result> {
  const actor = await requireUser();
  await deleteMySignature(await getDb(), actor);
  revalidatePath('/profile');
  return { ok: true };
}
