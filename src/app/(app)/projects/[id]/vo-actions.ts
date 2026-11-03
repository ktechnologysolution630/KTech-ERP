'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import type { BoqDocumentDto, SaveBoqInput } from '@/server/services/boq';
import {
  cancelVo,
  decideVo,
  getVoBoqSheet,
  getVoDocument,
  saveVoBoq,
  saveVoDocument,
  submitVo,
  type VoBoqSheet,
  type VoDocumentDto,
  type VoInput,
} from '@/server/services/variation-orders';

export type VoActionResult = { ok: true } | { ok: false; error: string };

async function run<T>(projectId: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await fn();
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/variation-orders`);
    return { ok: true, value };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

const done = (r: { ok: true } | { ok: false; error: string }): VoActionResult =>
  r.ok ? { ok: true } : { ok: false, error: r.error };

/** Saves the whole VO form (header + BOQ) atomically; voId = null creates a new VO. */
export async function saveVoDocumentAction(
  projectId: string,
  voId: string | null,
  input: { vo: VoInput; boq: SaveBoqInput | null },
): Promise<{ ok: true; value: { id: string; number: string } } | { ok: false; error: string }> {
  const actor = await requireUser();
  const db = await getDb();
  return run(projectId, () => saveVoDocument(db, actor, projectId, voId, input));
}

export async function loadVoDocumentAction(
  projectId: string,
  voId: string,
): Promise<{ ok: true; value: VoDocumentDto } | { ok: false; error: string }> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    const value = await getVoDocument(db, actor, voId);
    if (value.projectId !== projectId) return { ok: false, error: 'ไม่พบ VO' };
    return { ok: true, value };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function submitVoAction(projectId: string, voId: string): Promise<VoActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  return done(await run(projectId, () => submitVo(db, actor, voId)));
}

export async function decideVoAction(
  projectId: string,
  voId: string,
  approve: boolean,
  note: string,
): Promise<VoActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  return done(await run(projectId, () => decideVo(db, actor, voId, approve, note)));
}

export async function cancelVoAction(projectId: string, voId: string): Promise<VoActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  return done(await run(projectId, () => cancelVo(db, actor, voId)));
}

export async function loadVoBoqAction(
  projectId: string,
  voId: string,
): Promise<{ ok: true; value: VoBoqSheet } | { ok: false; error: string }> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    return { ok: true, value: await getVoBoqSheet(db, actor, voId) };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function saveVoBoqAction(
  projectId: string,
  voId: string,
  input: SaveBoqInput,
): Promise<{ ok: true; boq: BoqDocumentDto } | { ok: false; error: string; conflict: boolean }> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    const boq = await saveVoBoq(db, actor, voId, input);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, boq };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message, conflict: err.status === 409 };
    throw err;
  }
}
