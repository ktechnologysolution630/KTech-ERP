'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import {
  createStockCount,
  decideStockAdjust,
  recordStockMovement,
  requestStockAdjust,
  upsertStockItem,
  type RecordMovementInput,
  type StockCountInput,
  type StockAdjustInput,
  type StockItemFormInput,
} from '@/server/services/stock';

export type StockActionResult = { ok: true; value?: string } | { ok: false; error: string };

async function run(fn: () => Promise<string | void>): Promise<StockActionResult> {
  try {
    const value = await fn();
    revalidatePath('/stock');
    return { ok: true, value: value ?? undefined };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function saveStockItemAction(input: StockItemFormInput): Promise<StockActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  return run(async () => (await upsertStockItem(db, actor, input)).id);
}

export async function recordStockMovementAction(input: RecordMovementInput): Promise<StockActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  return run(() => recordStockMovement(db, actor, input));
}

export async function requestStockAdjustAction(input: StockAdjustInput): Promise<StockActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  return run(async () => (await requestStockAdjust(db, actor, input)).requestNumber);
}

export async function decideStockAdjustAction(requestId: string, approve: boolean): Promise<StockActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  return run(() => decideStockAdjust(db, actor, requestId, approve));
}

export async function createStockCountAction(input: StockCountInput): Promise<StockActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  return run(async () => (await createStockCount(db, actor, input)).countNumber);
}
