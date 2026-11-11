'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { DomainError } from '@/domain/errors';
import { getDb } from '@/db/client';
import { D } from '@/domain/money';
import { requireWriter } from '@/server/auth/current-user';
import {
  cancelInvoice,
  createInvoice,
  matchInvoice,
} from '@/server/services/invoice';
import {
  requestInstallment,
  requestPrepaid,
} from '@/server/services/payable';

export async function createInvoiceAction(input: {
  poId: string;
  invoiceNo: string;
  invoiceDate: string;
  isTaxInvoice: boolean;
  beforeVat: string;
  vat: string;
  dueDate?: string;
}): Promise<{ ok: false; error: string }> {
  const actor = await requireWriter();
  const db = await getDb();
  let res: { id: string };
  try {
    res = await createInvoice(db, actor, {
    poId: input.poId,
    invoiceNo: input.invoiceNo,
    invoiceDate: input.invoiceDate,
    isTaxInvoice: input.isTaxInvoice,
    beforeVat: D(input.beforeVat || 0),
    vat: D(input.vat || 0),
    dueDate: input.dueDate || null,
  });
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/invoices');
  revalidatePath('/payables');
  revalidatePath(`/po/${input.poId}`);
  redirect(`/invoices/${res.id}`);
}

export async function matchInvoiceAction(
  invoiceId: string,
  matches: { payableId: string; gross: string }[],
) {
  const actor = await requireWriter();
  const db = await getDb();
  await matchInvoice(
    db,
    actor,
    invoiceId,
    matches.map((m) => ({ payableId: m.payableId, gross: D(m.gross || 0) })),
  );
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');
}

export async function cancelInvoiceAction(id: string, reason: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await cancelInvoice(db, actor, id, reason);
  revalidatePath(`/invoices/${id}`);
  revalidatePath('/invoices');
  revalidatePath('/payables');
}

export async function requestPrepaidAction(poId: string, note?: string) {
  const actor = await requireWriter();
  const db = await getDb();
  await requestPrepaid(db, actor, poId, note);
  revalidatePath(`/po/${poId}`);
  revalidatePath('/payables');
}

export async function requestInstallmentAction(
  poId: string,
  installmentId: string,
  note?: string,
) {
  const actor = await requireWriter();
  const db = await getDb();
  await requestInstallment(db, actor, installmentId, note);
  revalidatePath(`/po/${poId}`);
  revalidatePath('/payables');
}
