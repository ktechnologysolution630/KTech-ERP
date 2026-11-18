'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import {
  deleteAccountCategories,
  deleteAdvances,
  deleteApInvoices,
  deleteArCreditNotes,
  deleteArInvoices,
  deleteCompanyAccounts,
  deleteCustomers,
  deletePvs,
  deleteReceiptSubstitutes,
  deleteSalesDocs,
  wipeAccounting,
  type AccountingWipePreview,
  type DeleteOutcome,
} from '@/server/services/accounting-delete';

type Result<T> = { ok: true; result: T } | { ok: false; error: string };

async function ctx() {
  return { actor: await requireWriter(), db: await getDb() };
}

/** A refusal comes back as a message for the dialog; the pages that list what changed are refreshed */
async function run<T>(work: () => Promise<T>, paths: string[]): Promise<Result<T>> {
  try {
    const result = await work();
    for (const p of paths) revalidatePath(p, 'layout');
    return { ok: true, result };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function deleteSalesDocsAction(ids: string[]): Promise<Result<DeleteOutcome>> {
  const { actor, db } = await ctx();
  return run(() => deleteSalesDocs(db, actor, ids), ['/sales', '/cash-bank', '/accounting']);
}

export async function deleteArInvoicesAction(ids: string[]): Promise<Result<DeleteOutcome>> {
  const { actor, db } = await ctx();
  return run(() => deleteArInvoices(db, actor, ids), ['/ar', '/accounting']);
}

export async function deleteArCreditNotesAction(ids: string[]): Promise<Result<DeleteOutcome>> {
  const { actor, db } = await ctx();
  return run(() => deleteArCreditNotes(db, actor, ids), ['/ar']);
}

export async function deleteCustomersAction(ids: string[]): Promise<Result<DeleteOutcome>> {
  const { actor, db } = await ctx();
  return run(() => deleteCustomers(db, actor, ids), ['/ar/customers']);
}

export async function deleteApInvoicesAction(ids: string[]): Promise<Result<DeleteOutcome>> {
  const { actor, db } = await ctx();
  return run(() => deleteApInvoices(db, actor, ids), ['/invoices', '/po', '/payables', '/accounting']);
}

export async function deletePvsAction(ids: string[]): Promise<Result<DeleteOutcome>> {
  const { actor, db } = await ctx();
  return run(() => deletePvs(db, actor, ids), ['/pv', '/payables', '/accounting']);
}

export async function deleteAdvancesAction(ids: string[]): Promise<Result<DeleteOutcome>> {
  const { actor, db } = await ctx();
  return run(() => deleteAdvances(db, actor, ids), ['/advances', '/vehicles']);
}

export async function deleteReceiptSubstitutesAction(ids: string[]): Promise<Result<DeleteOutcome>> {
  const { actor, db } = await ctx();
  return run(() => deleteReceiptSubstitutes(db, actor, ids), ['/receipt-substitutes']);
}

export async function deleteCompanyAccountsAction(ids: string[]): Promise<Result<DeleteOutcome>> {
  const { actor, db } = await ctx();
  return run(() => deleteCompanyAccounts(db, actor, ids), ['/cash-bank']);
}

export async function deleteAccountCategoriesAction(ids: string[]): Promise<Result<DeleteOutcome>> {
  const { actor, db } = await ctx();
  return run(() => deleteAccountCategories(db, actor, ids), ['/accounting/settings']);
}

/** Every accounting document at once; the words must match */
export async function wipeAccountingAction(confirm: string): Promise<Result<AccountingWipePreview>> {
  const { actor, db } = await ctx();
  return run(() => wipeAccounting(db, actor, confirm), ['/']);
}
