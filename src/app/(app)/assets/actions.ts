'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { importAssets, type ImportResult } from '@/server/services/import';
import {
  createAsset,
  listInspections,
  recordInspection,
  updateAsset,
  type AssetInput,
  type InspectionInput,
  type InspectionRow,
} from '@/server/services/assets';

export type AssetResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<AssetResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function saveAssetAction(id: string | null, input: AssetInput): Promise<AssetResult<unknown>> {
  const actor = await requireUser();
  const db = await getDb();
  const result = await run<unknown>(() => (id ? updateAsset(db, actor, id, input) : createAsset(db, actor, input)));
  if (result.ok) revalidatePath('/assets');
  return result;
}

export async function importAssetsAction(rows: Record<string, string>[]): Promise<ImportResult> {
  const actor = await requireUser();
  const db = await getDb();
  const result = await importAssets(db, actor, rows);
  revalidatePath('/assets');
  return result;
}

export async function recordInspectionAction(assetId: string, input: InspectionInput): Promise<AssetResult<{ id: string }>> {
  const actor = await requireUser();
  const db = await getDb();
  const result = await run(() => recordInspection(db, actor, assetId, input));
  if (result.ok) revalidatePath('/assets');
  return result;
}

export async function loadInspectionsAction(assetId: string): Promise<AssetResult<InspectionRow[]>> {
  const actor = await requireUser();
  const db = await getDb();
  return run(() => listInspections(db, actor, assetId));
}
