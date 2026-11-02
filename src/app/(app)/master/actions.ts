'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { ROLES, type Role } from '@/db/schema';
import { requireUser } from '@/server/auth/current-user';
import {
  upsertItem,
  upsertProject,
  upsertUser,
  upsertVendor,
  resetPassword,
} from '@/server/services/master';
import { importItems, importVendors } from '@/server/services/import';
import { updateSettings } from '@/server/services/settings';

export async function saveProjectAction(formData: FormData) {
  const actor = await requireUser();
  const db = await getDb();
  await upsertProject(db, actor, {
    id: String(formData.get('id') || '') || undefined,
    code: String(formData.get('code') || ''),
    name: String(formData.get('name') || ''),
    active: formData.get('active') !== 'false',
  });
  revalidatePath('/master/projects');
}

export async function saveVendorAction(formData: FormData) {
  const actor = await requireUser();
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
    active: formData.get('active') !== 'false',
  });
  revalidatePath('/master/vendors');
}

export async function importVendorsAction(rows: Record<string, string>[]) {
  const actor = await requireUser();
  const db = await getDb();
  const res = await importVendors(db, actor, rows);
  revalidatePath('/master/vendors');
  return res;
}

export async function saveItemAction(formData: FormData) {
  const actor = await requireUser();
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
}

export async function importItemsAction(rows: Record<string, string>[]) {
  const actor = await requireUser();
  const db = await getDb();
  const res = await importItems(db, actor, rows);
  revalidatePath('/master/items');
  return res;
}

export async function saveUserAction(formData: FormData) {
  const actor = await requireUser();
  const db = await getDb();
  const roles = formData
    .getAll('roles')
    .map(String)
    .filter((r): r is Role => (ROLES as readonly string[]).includes(r));
  const projectIds = formData.getAll('projectIds').map(String).filter(Boolean);
  const password = String(formData.get('password') || '').trim() || undefined;

  await upsertUser(db, actor, {
    id: String(formData.get('id') || '') || undefined,
    email: String(formData.get('email') || ''),
    name: String(formData.get('name') || ''),
    password,
    roles,
    projectIds,
    active: formData.get('active') !== 'false',
  });
  revalidatePath('/master/users');
}

export async function resetUserPasswordAction(formData: FormData) {
  const actor = await requireUser();
  const db = await getDb();
  const userId = String(formData.get('userId') || '');
  const newPassword = String(formData.get('newPassword') || '');
  await resetPassword(db, actor, userId, newPassword);
  revalidatePath('/master/users');
}

export async function saveSettingsAction(formData: FormData) {
  const actor = await requireUser();
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
