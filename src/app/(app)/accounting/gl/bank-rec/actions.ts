'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import { saveBankReconciliation, undoLastReconciliation, type SaveBankRecInput } from '@/server/services/bank-rec';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/accounting/gl/bank-rec');
  return { ok: true };
}

export async function saveBankRecAction(input: SaveBankRecInput) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => saveBankReconciliation(db, actor, input));
}

export async function undoBankRecAction(accountId: string) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => undoLastReconciliation(db, actor, accountId));
}
