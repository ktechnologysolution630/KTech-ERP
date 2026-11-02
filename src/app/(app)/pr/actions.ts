'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
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
  type PrLineInput,
} from '@/server/services/pr';

export async function createPrAction(input: {
  projectId: string;
  note?: string;
  submitNow?: boolean;
  lines: PrLineInput[];
}) {
  const actor = await requireUser();
  const db = await getDb();
  const created = await createPr(db, actor, input);
  if (input.submitNow) {
    await submitPr(db, actor, created.id);
  }
  revalidatePath('/pr');
  redirect(`/pr/${created.id}`);
}

export async function updatePrAction(
  id: string,
  input: { note?: string; submitNow?: boolean; lines: PrLineInput[] },
) {
  const actor = await requireUser();
  const db = await getDb();
  await updatePr(db, actor, id, input);
  if (input.submitNow) {
    await submitPr(db, actor, id);
  }
  revalidatePath(`/pr/${id}`);
  revalidatePath('/pr');
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
