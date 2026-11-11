'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireDecider, requireWriter } from '@/server/auth/current-user';
import { decideBoqOverrun, requestBoqOverrun } from '@/server/services/boq-overrun';

export type ApActionResult = { ok: true } | { ok: false; error: string };

async function run(poId: string, fn: () => Promise<unknown>): Promise<ApActionResult> {
  try {
    await fn();
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath(`/po/${poId}`);
  revalidatePath('/purchasing/ap');
  revalidatePath('/purchasing/approve');
  return { ok: true };
}

export async function requestBoqOverrunAction(poId: string, reason: string): Promise<ApActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return run(poId, () => requestBoqOverrun(db, actor, poId, reason));
}

export async function decideBoqOverrunAction(
  poId: string,
  requestId: string,
  approve: boolean,
  note: string,
): Promise<ApActionResult> {
  const actor = await requireDecider();
  const db = await getDb();
  return run(poId, () => decideBoqOverrun(db, actor, requestId, approve, note));
}
