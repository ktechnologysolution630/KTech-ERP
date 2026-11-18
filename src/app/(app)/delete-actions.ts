'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import {
  deleteBoqOverrunRequests,
  deleteBoqs,
  deleteDailyReports,
  deleteHandovers,
  deletePayables,
  deletePos,
  deleteStockAdjustRequests,
  deleteStockCounts,
  deleteVariationOrders,
  deleteVehicleTrips,
  deleteWarrantyDefects,
} from '@/server/services/operations-delete';
import type { DeleteOutcome } from '@/server/services/record-delete';

/** Deletes on the purchasing, stock, vehicle, project and after-sales menus; the accounting ones are in accounting/ */

type Result = { ok: true; result: DeleteOutcome } | { ok: false; error: string };

async function ctx() {
  return { actor: await requireWriter(), db: await getDb() };
}

/** A refusal comes back as a message for the dialog; the pages that list what changed are refreshed */
async function run(work: () => Promise<DeleteOutcome>, paths: string[]): Promise<Result> {
  try {
    const result = await work();
    for (const p of paths) revalidatePath(p, 'layout');
    return { ok: true, result };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function deleteBoqOverrunRequestsAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deleteBoqOverrunRequests(db, actor, ids), ['/purchasing/ap', '/po']);
}

export async function deletePayablesAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deletePayables(db, actor, ids), ['/payables', '/po']);
}

export async function deletePosAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deletePos(db, actor, ids), ['/po', '/purchasing']);
}

export async function deleteStockCountsAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deleteStockCounts(db, actor, ids), ['/stock']);
}

export async function deleteStockAdjustRequestsAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deleteStockAdjustRequests(db, actor, ids), ['/stock']);
}

export async function deleteVehicleTripsAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deleteVehicleTrips(db, actor, ids), ['/vehicles']);
}

export async function deleteHandoversAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deleteHandovers(db, actor, ids), ['/handover', '/warranty']);
}

export async function deleteWarrantyDefectsAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deleteWarrantyDefects(db, actor, ids), ['/warranty']);
}

export async function deleteVariationOrdersAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deleteVariationOrders(db, actor, ids), ['/projects']);
}

export async function deleteBoqsAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deleteBoqs(db, actor, ids), ['/projects']);
}

export async function deleteDailyReportsAction(ids: string[]): Promise<Result> {
  const { actor, db } = await ctx();
  return run(() => deleteDailyReports(db, actor, ids), ['/projects']);
}
