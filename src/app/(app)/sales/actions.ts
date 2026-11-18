'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { SALES_DOC_META } from '@/domain/sales-doc';
import { requireWriter } from '@/server/auth/current-user';
import { cancelSalesDoc, createSalesDoc, updateSalesDoc, type SalesDocInput } from '@/server/services/sales-docs';

type Result = { ok: true; id: string } | { ok: false; error: string };

/** With replacesId the new document is issued in place of that one, which is cancelled */
export async function createSalesDocAction(input: SalesDocInput, replacesId?: string): Promise<Result> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    const doc = await createSalesDoc(db, actor, input, { replacesId });
    const slug = SALES_DOC_META[input.kind].slug;
    revalidatePath(`/sales/${slug}`);
    if (replacesId) revalidatePath(`/sales/${slug}/${replacesId}`);
    return { ok: true, id: doc.id };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function updateSalesDocAction(id: string, input: SalesDocInput): Promise<Result> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    await updateSalesDoc(db, actor, id, input);
    const slug = SALES_DOC_META[input.kind].slug;
    revalidatePath(`/sales/${slug}`);
    revalidatePath(`/sales/${slug}/${id}`);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function cancelSalesDocAction(id: string, slug: string, reason: string): Promise<Result> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    await cancelSalesDoc(db, actor, id, reason);
    revalidatePath(`/sales/${slug}`);
    revalidatePath(`/sales/${slug}/${id}`);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function saveCompanyAccountAction(input: import('@/server/services/sales-docs').CompanyAccountInput): Promise<Result> {
  const actor = await requireWriter();
  const db = await getDb();
  const { saveCompanyAccount } = await import('@/server/services/sales-docs');
  try {
    const id = await saveCompanyAccount(db, actor, input);
    revalidatePath('/cash-bank');
    return { ok: true, id };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function saveAccountCategoryAction(input: import('@/server/services/account-categories').AccountCategoryInput): Promise<Result> {
  const actor = await requireWriter();
  const db = await getDb();
  const { saveAccountCategory } = await import('@/server/services/account-categories');
  try {
    const id = await saveAccountCategory(db, actor, input);
    revalidatePath('/accounting/settings');
    return { ok: true, id };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
