'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { addComment } from '@/server/services/attachments';
import {
  approvePr,
  cancelPr,
  closePr,
  createPr,
  rejectPr,
  submitPr,
  updatePr,
  type PrHeaderInput,
  type PrLineInput,
} from '@/server/services/pr';

type SaveResult = { ok: false; error: string };

export async function createPrAction(
  input: {
    projectId: string;
    note?: string;
    submitNow?: boolean;
    lines: PrLineInput[];
  } & PrHeaderInput,
): Promise<SaveResult> {
  const actor = await requireUser();
  const db = await getDb();
  let created: { id: string };
  try {
    created = await createPr(db, actor, input);
    if (input.submitNow) await submitPr(db, actor, created.id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/pr');
  redirect(`/pr/${created.id}`);
}

export async function updatePrAction(
  id: string,
  input: { note?: string; submitNow?: boolean; lines: PrLineInput[] } & PrHeaderInput,
): Promise<SaveResult> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    await updatePr(db, actor, id, input);
    if (input.submitNow) await submitPr(db, actor, id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath(`/pr/${id}`);
  revalidatePath('/pr');
  redirect(`/pr/${id}`);
}

export async function submitPrAction(id: string) {
  const actor = await requireUser();
  const db = await getDb();
  await submitPr(db, actor, id);
  revalidatePath(`/pr/${id}`);
  revalidatePath('/pr');
}

export async function approvePrAction(id: string) {
  const actor = await requireUser();
  const db = await getDb();
  await approvePr(db, actor, id);
  revalidatePath(`/pr/${id}`);
  revalidatePath('/pr');
}

export async function rejectPrAction(id: string, reason: string) {
  const actor = await requireUser();
  const db = await getDb();
  await rejectPr(db, actor, id, reason);
  revalidatePath(`/pr/${id}`);
  revalidatePath('/pr');
}

export async function cancelPrAction(id: string) {
  const actor = await requireUser();
  const db = await getDb();
  await cancelPr(db, actor, id);
  revalidatePath(`/pr/${id}`);
  revalidatePath('/pr');
}

export async function closePrAction(id: string) {
  const actor = await requireUser();
  const db = await getDb();
  await closePr(db, actor, id);
  revalidatePath(`/pr/${id}`);
  revalidatePath('/pr');
}

export async function addPrCommentAction(id: string, body: string) {
  const actor = await requireUser();
  const db = await getDb();
  await addComment(db, actor, { entityType: 'PR', entityId: id, body });
  revalidatePath(`/pr/${id}`);
}

/** Permanently deletes the ticked requisitions; ones a PO has ordered from are kept and reported */
export async function deletePrsAction(
  ids: string[],
): Promise<{ ok: true; result: import('@/server/services/pr-delete').PrDeleteResult } | { ok: false; error: string }> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    const { deletePrs } = await import('@/server/services/pr-delete');
    const result = await deletePrs(db, actor, ids);
    revalidatePath('/pr');
    revalidatePath('/purchasing');
    revalidatePath('/purchasing/approve');
    return { ok: true, result };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
