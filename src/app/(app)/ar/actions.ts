'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import {
  createArInvoice,
  createInvoiceFromMilestone,
  issueArCreditNote,
  issueArInvoice,
  recordArReceipt,
  updateArInvoice,
  upsertCustomer,
  voidArInvoice,
  voidArReceipt,
  type ArInvoiceInput,
  type ArReceiptInput,
  type CustomerInput,
} from '@/server/services/ar';

export type ArResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>, paths: string[]): Promise<ArResult<T>> {
  try {
    const value = await fn();
    for (const p of ['/ar/invoices', '/ar/receivables', '/ar/output-vat', ...paths]) revalidatePath(p);
    return { ok: true, value };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

async function ctx() {
  return { actor: await requireWriter(), db: await getDb() };
}

export async function saveCustomerAction(input: CustomerInput) {
  const { actor, db } = await ctx();
  return run(async () => {
    await upsertCustomer(db, actor, input);
  }, ['/ar/customers']);
}

export async function createArInvoiceAction(input: ArInvoiceInput) {
  const { actor, db } = await ctx();
  return run(async () => (await createArInvoice(db, actor, input)).id, []);
}

export async function updateArInvoiceAction(id: string, input: ArInvoiceInput) {
  const { actor, db } = await ctx();
  return run(() => updateArInvoice(db, actor, id, input), [`/ar/invoices/${id}`]);
}

export async function invoiceFromMilestoneAction(milestoneId: string, projectId: string) {
  const { actor, db } = await ctx();
  return run(async () => (await createInvoiceFromMilestone(db, actor, milestoneId)).id, [
    `/labor-payments/${projectId}`,
  ]);
}

export async function issueArInvoiceAction(id: string) {
  const { actor, db } = await ctx();
  return run(() => issueArInvoice(db, actor, id), [`/ar/invoices/${id}`]);
}

export async function voidArInvoiceAction(id: string, reason: string) {
  const { actor, db } = await ctx();
  return run(() => voidArInvoice(db, actor, id, reason), [`/ar/invoices/${id}`]);
}

export async function recordArReceiptAction(invoiceId: string, input: ArReceiptInput) {
  const { actor, db } = await ctx();
  return run(async () => (await recordArReceipt(db, actor, invoiceId, input)).number, [`/ar/invoices/${invoiceId}`]);
}

export async function voidArReceiptAction(invoiceId: string, receiptId: string, reason: string) {
  const { actor, db } = await ctx();
  return run(() => voidArReceipt(db, actor, receiptId, reason), [`/ar/invoices/${invoiceId}`]);
}

export async function issueArCreditNoteAction(invoiceId: string, input: { gross: number; reason: string; docDate?: string }) {
  const { actor, db } = await ctx();
  return run(async () => (await issueArCreditNote(db, actor, invoiceId, input)).number, [`/ar/invoices/${invoiceId}`]);
}
