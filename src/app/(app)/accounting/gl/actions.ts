'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { type SystemAccountKey } from '@/domain/gl';
import { requireWriter } from '@/server/auth/current-user';
import { repostAll, saveGlAccount, setSystemAccount, type GlAccountInput } from '@/server/services/gl';

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    revalidatePath('/accounting/gl');
    return { ok: true, data };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function repostAllAction() {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => repostAll(db, actor));
}

export async function saveGlAccountAction(input: GlAccountInput) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => saveGlAccount(db, actor, input));
}

export async function setSystemAccountAction(key: SystemAccountKey, accountId: string) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => setSystemAccount(db, actor, key, accountId));
}
