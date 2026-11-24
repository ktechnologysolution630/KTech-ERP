'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser, requireWriter } from '@/server/auth/current-user';
import {
  upsertItem,
  upsertProject,
  upsertUser,
  upsertVendor,
  resetPassword,
  setItemsUnit,
  type UserInput,
} from '@/server/services/master';
import type { ItemImportRow, VendorImportRow } from '@/domain/master-import';
import { importItemCatalog, importItems, importVendorDirectory, importVendors, type DirectoryImportResult } from '@/server/services/import';
import { updateSettings } from '@/server/services/settings';
import { deleteItems, itemUsage, type ItemDeleteResult } from '@/server/services/item-delete';
import { deleteUserSignature, setUserSignature } from '@/server/services/signatures';

function optionalText(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return v === null ? undefined : String(v);
}

function optionalDate(formData: FormData, key: string): string | null | undefined {
  const v = formData.get(key);
  if (v === null) return undefined;
  return String(v) || null;
}

export async function saveProjectAction(formData: FormData): Promise<{ error?: string }> {
  const actor = await requireWriter();
  const db = await getDb();
  const budgetRaw = formData.get('budget');
  try {
    await upsertProject(db, actor, {
      id: String(formData.get('id') || '') || undefined,
      code: String(formData.get('code') || ''),
      name: String(formData.get('name') || ''),
      active: formData.get('active') !== 'false',
      clientName: optionalText(formData, 'clientName'),
      location: optionalText(formData, 'location'),
      budget: budgetRaw === null || budgetRaw === '' ? undefined : Number(budgetRaw),
      startDate: optionalDate(formData, 'startDate'),
      endDate: optionalDate(formData, 'endDate'),
    });
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
  revalidatePath('/projects');
  return {};
}

export async function saveVendorAction(formData: FormData) {
  const actor = await requireWriter();
  const db = await getDb();
  await upsertVendor(db, actor, {
    id: String(formData.get('id') || '') || undefined,
    code: String(formData.get('code') || ''),
    name: String(formData.get('name') || ''),
    type: (String(formData.get('type') || 'COMPANY') as 'COMPANY' | 'INDIVIDUAL'),
    taxId: String(formData.get('taxId') || '') || null,
    branch: String(formData.get('branch') || '00000'),
    address: String(formData.get('address') || ''),
    phone: String(formData.get('phone') || ''),
    bankName: String(formData.get('bankName') || ''),
    bankAccountNo: String(formData.get('bankAccountNo') || ''),
    bankAccountName: String(formData.get('bankAccountName') || ''),
    defaultCreditDays: Number(formData.get('defaultCreditDays') || 30),
    defaultWhtRate: Number(formData.get('defaultWhtRate') || 0),
    suppliedItems: optionalText(formData, 'suppliedItems'),
    contactPerson: optionalText(formData, 'contactPerson'),
    altAddress: optionalText(formData, 'altAddress'),
    email: optionalText(formData, 'email'),
    fax: optionalText(formData, 'fax'),
    billingSchedule: optionalText(formData, 'billingSchedule'),
    creditBasis: (['INVOICE', 'BILLING', 'RECEIPT'] as const).find((b) => b === formData.get('creditBasis')),
    chequeSchedule: optionalText(formData, 'chequeSchedule'),
    defaultPayMethod: (['TRANSFER', 'CHEQUE', 'CASH'] as const).find((m) => m === formData.get('defaultPayMethod')),
    active: formData.get('active') !== 'false',
  });
  revalidatePath('/master/vendors');
  revalidatePath('/purchasing/vendors');
}

export async function importVendorsAction(rows: Record<string, string>[]) {
  const actor = await requireWriter();
  const db = await getDb();
  const res = await importVendors(db, actor, rows);
  revalidatePath('/master/vendors');
  return res;
}

export async function saveItemAction(formData: FormData) {
  const actor = await requireWriter();
  const db = await getDb();
  await upsertItem(db, actor, {
    id: String(formData.get('id') || '') || undefined,
    code: String(formData.get('code') || ''),
    name: String(formData.get('name') || ''),
    unitName: String(formData.get('unitName') || ''),
    category: String(formData.get('category') || '') || null,
    active: formData.get('active') !== 'false',
  });
  revalidatePath('/master/items');
  revalidatePath('/purchasing/items');
}

export async function importItemsAction(rows: Record<string, string>[]) {
  const actor = await requireWriter();
  const db = await getDb();
  const res = await importItems(db, actor, rows);
  revalidatePath('/master/items');
  revalidatePath('/purchasing/items');
  return res;
}

export type DirectoryImportReply = { ok: true; result: DirectoryImportResult } | { ok: false; error: string };

async function directoryImport(fn: () => Promise<DirectoryImportResult>): Promise<DirectoryImportReply> {
  try {
    return { ok: true, result: await fn() };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function importVendorDirectoryAction(rows: VendorImportRow[]): Promise<DirectoryImportReply> {
  const actor = await requireWriter();
  const db = await getDb();
  const reply = await directoryImport(() => importVendorDirectory(db, actor, rows));
  revalidatePath('/purchasing/vendors');
  revalidatePath('/master/vendors');
  return reply;
}

export async function importItemCatalogAction(rows: ItemImportRow[]): Promise<DirectoryImportReply> {
  const actor = await requireWriter();
  const db = await getDb();
  const reply = await directoryImport(() => importItemCatalog(db, actor, rows));
  revalidatePath('/master/items');
  revalidatePath('/purchasing/items');
  return reply;
}

export type UserActionResult = { ok: true } | { ok: false; error: string };

async function userAction(fn: () => Promise<unknown>): Promise<UserActionResult> {
  try {
    await fn();
    revalidatePath('/master/users');
    return { ok: true };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function saveUserAction(input: UserInput): Promise<UserActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return userAction(() => upsertUser(db, actor, input));
}

export async function resetUserPasswordAction(userId: string, newPassword: string): Promise<UserActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return userAction(() => resetPassword(db, actor, userId, newPassword));
}

export async function saveSettingsAction(formData: FormData) {
  const actor = await requireWriter();
  const db = await getDb();
  await updateSettings(db, actor, {
    companyName: String(formData.get('companyName') || ''),
    companyAddress: String(formData.get('companyAddress') || ''),
    companyTaxId: String(formData.get('companyTaxId') || ''),
    companyBranch: String(formData.get('companyBranch') || '00000'),
    poApprovalLimit: String(formData.get('poApprovalLimit') || '50000.00'),
  });
  revalidatePath('/settings');
}

/** Deletes ticked items from the register; items still on PR/PO lines are switched off instead. */
export async function deleteItemsAction(ids: string[]): Promise<{ ok: true; result: ItemDeleteResult } | { ok: false; error: string }> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    const result = await deleteItems(db, actor, ids);
    revalidatePath('/master/items');
    revalidatePath('/purchasing/items');
    revalidatePath('/pr');
    return { ok: true, result };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

/** PR / PO line counts for the items in the duplicate check, so a copy still in use is not deleted by mistake */
export async function itemUsageAction(ids: string[]): Promise<Record<string, { pr: number; po: number }>> {
  await requireUser();
  const db = await getDb();
  return itemUsage(db, ids);
}

/** Count the ticked items in another unit (e.g. steel กก. → เส้น) */
export async function setItemsUnitAction(ids: string[], unitName: string): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    const changed = await setItemsUnit(db, actor, ids, unitName);
    revalidatePath('/master/items');
    revalidatePath('/purchasing/items');
    return { ok: true, changed };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

/** An administrator sets someone's signature for them */
export async function setUserSignatureAction(userId: string, image: string): Promise<UserActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return userAction(() => setUserSignature(db, actor, userId, image));
}

export async function deleteUserSignatureAction(userId: string): Promise<UserActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return userAction(() => deleteUserSignature(db, actor, userId));
}
