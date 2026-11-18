'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import { reissueWhtCert, voidWhtCert } from '@/server/services/wht-cert';

export type WhtActionResult = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<WhtActionResult> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/accounting/wht');
  revalidatePath('/accounting/wht-report');
  return { ok: true };
}

export async function voidWhtCertAction(id: string, reason: string): Promise<WhtActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => voidWhtCert(db, actor, id, reason));
}

export async function reissueWhtCertAction(id: string): Promise<WhtActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => reissueWhtCert(db, actor, id));
}
