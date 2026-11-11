'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { type PayMethod } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import { addComment } from '@/server/services/attachments';
import '@/server/services/wht-cert';
import {
  approvePv,
  cancelPv,
  createPv,
  markPvPaid,
  updateCheque,
  type ChequeAction,
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
  const actor = await requireWriter();
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
  const actor = await requireWriter();
  const db = await getDb();
  await updatePv(db, actor, id, input);
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
  revalidatePath('/payables');
}

export async function submitPvAction(id: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await submitPv(db, actor, id);
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
}

export async function approvePvAction(id: string, overrideReason?: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await approvePv(db, actor, id, overrideReason);
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
}

export async function rejectPvAction(id: string, reason: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await rejectPv(db, actor, id, reason);
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
}

export async function cancelPvAction(id: string, reason: string) {
  const actor = await requireWriter();
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
    cheque?: { no: string; bank: string; date: string };
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    await markPvPaid(db, actor, id, input);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
  revalidatePath('/payables');
  revalidatePath('/cheques');
  return { ok: true };
}

export async function updateChequeAction(id: string, input: ChequeAction): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    await updateCheque(db, actor, id, input);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath(`/pv/${id}`);
  revalidatePath('/pv');
  revalidatePath('/payables');
  revalidatePath('/cheques');
  return { ok: true };
}

export async function addPvCommentAction(id: string, body: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await addComment(db, actor, { entityType: 'PV', entityId: id, body });
  revalidatePath(`/pv/${id}`);
}
