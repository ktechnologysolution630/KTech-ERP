'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { type PayMethod } from '@/db/schema';
import { requireUser } from '@/server/auth/current-user';
import { addComment } from '@/server/services/attachments';
import {
  approvePv,
  cancelPv,
  createPv,
  markPvPaid,
  rejectPv,
  submitPv,
  updatePv,
} from '@/server/services/pv';

export async function createPvAction(input: {
  vendorId: string;
  payableIds: string[];
  whtRates: Record<string, number>;
  note?: string;
}) {
  const actor = await requireUser();
  const db = await getDb();
  const res = await createPv(db, actor, input);
  revalidatePath('/pv');
  revalidatePath('/payables');
  redirect(`/pv/${res.id}`);
}

export async function updatePvAction(
  id: string,
  input: {
    payableIds: string[];
    whtRates: Record<string, number>;
    note?: string;
  },
) {
  const actor = await requireUser();
  const db = await getDb();
  await updatePv(db, actor, id, input);
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
  revalidatePath('/payables');
}

export async function submitPvAction(id: string) {
  const actor = await requireUser();
  const db = await getDb();
  await submitPv(db, actor, id);
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
}

export async function approvePvAction(id: string, overrideReason?: string) {
  const actor = await requireUser();
  const db = await getDb();
  await approvePv(db, actor, id, overrideReason);
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
}

export async function rejectPvAction(id: string, reason: string) {
  const actor = await requireUser();
  const db = await getDb();
  await rejectPv(db, actor, id, reason);
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
}

export async function cancelPvAction(id: string, reason: string) {
  const actor = await requireUser();
  const db = await getDb();
  await cancelPv(db, actor, id, reason);
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
  revalidatePath('/payables');
}

export async function markPvPaidAction(
  id: string,
  input: {
    paidAt: string;
    payMethod: PayMethod;
    payFromAccount?: string;
    payRef?: string;
  },
) {
  const actor = await requireUser();
  const db = await getDb();
  await markPvPaid(db, actor, id, input);
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
  revalidatePath('/payables');
}

export async function addPvCommentAction(id: string, body: string) {
  const actor = await requireUser();
  const db = await getDb();
  await addComment(db, actor, { entityType: 'PV', entityId: id, body });
  revalidatePath(`/pv/${id}`);
}
