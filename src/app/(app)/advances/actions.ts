'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import {
  addAdvanceExpense,
  cancelAdvance,
  cancelReceiptSubstitute,
  createReceiptSubstitute,
  decideAdvance,
  decideReceiptSubstitute,
  payAdvance,
  recordAdvanceReturn,
  removeAdvanceExpense,
  requestAdvance,
  submitReceiptSubstitute,
  updateReceiptSubstitute,
  type AdvanceExpenseInput,
  type AdvanceInput,
  type ReceiptSubstituteInput,
} from '@/server/services/advances';

export type AdvResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<AdvResult<T>> {
  try {
    const value = await fn();
    revalidatePath('/advances', 'layout');
    revalidatePath('/receipt-substitutes', 'layout');
    return { ok: true, value };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

async function ctx() {
  return { actor: await requireWriter(), db: await getDb() };
}

export async function requestAdvanceAction(input: AdvanceInput) {
  const { actor, db } = await ctx();
  return run(async () => (await requestAdvance(db, actor, input)).id);
}

export async function decideAdvanceAction(id: string, approve: boolean, note: string) {
  const { actor, db } = await ctx();
  return run(() => decideAdvance(db, actor, id, approve, note));
}

export async function payAdvanceAction(id: string, paidOn?: string) {
  const { actor, db } = await ctx();
  return run(() => payAdvance(db, actor, id, paidOn));
}

export async function cancelAdvanceAction(id: string) {
  const { actor, db } = await ctx();
  return run(() => cancelAdvance(db, actor, id));
}

export async function addAdvanceExpenseAction(id: string, input: AdvanceExpenseInput) {
  const { actor, db } = await ctx();
  return run(() => addAdvanceExpense(db, actor, id, input));
}

export async function removeAdvanceExpenseAction(expenseId: string) {
  const { actor, db } = await ctx();
  return run(() => removeAdvanceExpense(db, actor, expenseId));
}

export async function recordAdvanceReturnAction(id: string, amount: number) {
  const { actor, db } = await ctx();
  return run(() => recordAdvanceReturn(db, actor, id, amount));
}

export async function saveReceiptSubstituteAction(id: string | null, input: ReceiptSubstituteInput) {
  const { actor, db } = await ctx();
  return run(async () => {
    if (id) {
      await updateReceiptSubstitute(db, actor, id, input);
      return id;
    }
    return (await createReceiptSubstitute(db, actor, input)).id;
  });
}

export async function submitReceiptSubstituteAction(id: string) {
  const { actor, db } = await ctx();
  return run(() => submitReceiptSubstitute(db, actor, id));
}

export async function decideReceiptSubstituteAction(id: string, approve: boolean, note: string) {
  const { actor, db } = await ctx();
  return run(() => decideReceiptSubstitute(db, actor, id, approve, note));
}

export async function cancelReceiptSubstituteAction(id: string) {
  const { actor, db } = await ctx();
  return run(() => cancelReceiptSubstitute(db, actor, id));
}
