'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser, requireWriter } from '@/server/auth/current-user';
import { importAssets, type ImportResult } from '@/server/services/import';
import type { InspectionResult } from '@/domain/asset';
import {
  confirmAssetCheck,
  createAsset,
  deleteAssets,
  listInspections,
  updateAsset,
  type AssetInput,
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
  const actor = await requireWriter();
  const db = await getDb();
  const result = await run<unknown>(() => (id ? updateAsset(db, actor, id, input) : createAsset(db, actor, input)));
  if (result.ok) revalidatePath('/assets');
  return result;
}

export async function deleteAssetsAction(ids: string[]): Promise<AssetResult<{ deleted: number }>> {
  const actor = await requireWriter();
  const db = await getDb();
  const result = await run(() => deleteAssets(db, actor, ids));
  if (result.ok) revalidatePath('/assets');
  return result;
}

export async function importAssetsAction(rows: Record<string, string>[]): Promise<ImportResult> {
  const actor = await requireWriter();
  const db = await getDb();
  const result = await importAssets(db, actor, rows);
  revalidatePath('/assets');
  return result;
}

export async function confirmAssetCheckAction(assetId: string, form: FormData): Promise<AssetResult<{ id: string }>> {
  const actor = await requireWriter();
  const db = await getDb();
  // A missing field must not turn into 0, which is a valid coordinate
  const coordinate = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' && value.trim() ? Number(value) : NaN;
  };
  const photo = form.get('photo');
  const result = await run(() =>
    confirmAssetCheck(db, actor, assetId, {
      result: String(form.get('result')) as InspectionResult,
      note: String(form.get('note') ?? ''),
      location: { latitude: coordinate('latitude'), longitude: coordinate('longitude'), accuracyMeters: coordinate('accuracyMeters') },
      photo: photo instanceof File ? photo : null,
    }),
  );
  if (result.ok) revalidatePath('/assets');
  return result;
}

export async function loadInspectionsAction(assetId: string): Promise<AssetResult<InspectionRow[]>> {
  const actor = await requireUser();
  const db = await getDb();
  return run(() => listInspections(db, actor, assetId));
}
