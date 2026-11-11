'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import { addComment } from '@/server/services/attachments';
import { deletePo } from '@/server/services/po-delete';
import {
  approvePo,
  cancelPo,
  createPo,
  markOrdered,
  rejectPo,
  submitPo,
  updatePo,
  type PoInput,
} from '@/server/services/po';
import {
  approveCloseShort,
  rejectCloseShort,
  requestCloseShort,
} from '@/server/services/close-short';

/** Saved PO id, or why it was refused; the form uploads its pictures and then opens the PO */
export type PoSaveResult = { ok: true; id: string } | { ok: false; error: string };

export async function createPoAction(input: PoInput & { submitNow?: boolean }): Promise<PoSaveResult> {
  const actor = await requireWriter();
  const db = await getDb();
  let created: { id: string };
  try {
    created = await createPo(db, actor, input);
    if (input.submitNow) await submitPo(db, actor, created.id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/po');
  return { ok: true, id: created.id };
}

export async function updatePoAction(
  id: string,
  input: PoInput & { submitNow?: boolean },
): Promise<PoSaveResult> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    await updatePo(db, actor, id, input);
    if (input.submitNow) await submitPo(db, actor, id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
  return { ok: true, id };
}

export async function deletePoAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    await deletePo(db, actor, id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/po');
  revalidatePath('/purchasing/vendors');
  return { ok: true };
}

export async function submitPoAction(id: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await submitPo(db, actor, id);
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
}

export async function approvePoAction(id: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await approvePo(db, actor, id);
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
}

export async function rejectPoAction(id: string, reason: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await rejectPo(db, actor, id, reason);
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
}

export async function markOrderedAction(id: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await markOrdered(db, actor, id);
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
}

export async function cancelPoAction(id: string, reason: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await cancelPo(db, actor, id, reason);
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
}

export async function addPoCommentAction(id: string, body: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await addComment(db, actor, { entityType: 'PO', entityId: id, body });
  revalidatePath(`/po/${id}`);
}

export async function requestCloseShortAction(poId: string, reason: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await requestCloseShort(db, actor, poId, reason);
  revalidatePath(`/po/${poId}`);
}

export async function approveCloseShortAction(poId: string, requestId: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await approveCloseShort(db, actor, requestId);
  revalidatePath(`/po/${poId}`);
  revalidatePath('/po');
}

export async function rejectCloseShortAction(
  poId: string,
  requestId: string,
  reason: string,
) {
  const actor = await requireWriter();
  const db = await getDb();
  await rejectCloseShort(db, actor, requestId, reason);
  revalidatePath(`/po/${poId}`);
}
