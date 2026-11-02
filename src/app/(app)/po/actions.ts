'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { addComment } from '@/server/services/attachments';
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

export async function createPoAction(input: PoInput & { submitNow?: boolean }) {
  const actor = await requireUser();
  const db = await getDb();
  const created = await createPo(db, actor, input);
  if (input.submitNow) {
    await submitPo(db, actor, created.id);
  }
  revalidatePath('/po');
  redirect(`/po/${created.id}`);
}

export async function updatePoAction(
  id: string,
  input: PoInput & { submitNow?: boolean },
) {
  const actor = await requireUser();
  const db = await getDb();
  await updatePo(db, actor, id, input);
  if (input.submitNow) {
    await submitPo(db, actor, id);
  }
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
  redirect(`/po/${id}`);
}

export async function submitPoAction(id: string) {
  const actor = await requireUser();
  const db = await getDb();
  await submitPo(db, actor, id);
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
}

export async function approvePoAction(id: string) {
  const actor = await requireUser();
  const db = await getDb();
  await approvePo(db, actor, id);
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
}

export async function rejectPoAction(id: string, reason: string) {
  const actor = await requireUser();
  const db = await getDb();
  await rejectPo(db, actor, id, reason);
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
}

export async function markOrderedAction(id: string) {
  const actor = await requireUser();
  const db = await getDb();
  await markOrdered(db, actor, id);
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
}

export async function cancelPoAction(id: string, reason: string) {
  const actor = await requireUser();
  const db = await getDb();
  await cancelPo(db, actor, id, reason);
  revalidatePath(`/po/${id}`);
  revalidatePath('/po');
}

export async function addPoCommentAction(id: string, body: string) {
  const actor = await requireUser();
  const db = await getDb();
  await addComment(db, actor, { entityType: 'PO', entityId: id, body });
  revalidatePath(`/po/${id}`);
}
