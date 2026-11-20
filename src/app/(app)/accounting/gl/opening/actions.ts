'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import {
  addApOpening,
  addArOpening,
  removeApOpening,
  removeArOpening,
  saveOpeningEntry,
  type ApOpeningInput,
  type ArOpeningInput,
  type OpeningEntryInput,
} from '@/server/services/opening';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/accounting/gl/opening');
  revalidatePath('/accounting/gl');
  revalidatePath('/payables');
  revalidatePath('/ar/invoices');
  return { ok: true };
}

export async function saveOpeningEntryAction(input: OpeningEntryInput) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => saveOpeningEntry(db, actor, input));
}

export async function addArOpeningAction(input: ArOpeningInput) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => addArOpening(db, actor, input));
}

export async function removeArOpeningAction(id: string) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => removeArOpening(db, actor, id));
}

export async function addApOpeningAction(input: ApOpeningInput) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => addApOpening(db, actor, input));
}

export async function removeApOpeningAction(id: string) {
  const actor = await requireWriter();
  const db = await getDb();
  return run(() => removeApOpening(db, actor, id));
}
