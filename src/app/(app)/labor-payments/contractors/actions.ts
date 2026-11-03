'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { upsertVendor } from '@/server/services/master';

export async function createContractorAction(formData: FormData) {
  const actor = await requireUser();
  const db = await getDb();

  const code = (formData.get('code') as string)?.trim() || `CONT-${Date.now().toString().slice(-4)}`;
  const name = (formData.get('name') as string)?.trim();
  const phone = (formData.get('phone') as string)?.trim() || '';
  const bankName = (formData.get('bankName') as string)?.trim() || '';
  const bankAccountNo = (formData.get('bankAccountNo') as string)?.trim() || '';
  const bankAccountName = (formData.get('bankAccountName') as string)?.trim() || name;
  const defaultCreditDays = Number(formData.get('defaultCreditDays') || 0);
  const defaultWhtRate = Number(formData.get('defaultWhtRate') || 3);
  const taxId = (formData.get('taxId') as string)?.trim() || null;

  if (!name) {
    return { ok: false, error: 'กรุณากรอกชื่อผู้รับเหมาหรือทีมงาน' };
  }

  try {
    await upsertVendor(db, actor, {
      code,
      name,
      type: 'INDIVIDUAL',
      taxId: taxId && taxId.length === 13 ? taxId : null,
      phone,
      bankName,
      bankAccountNo,
      bankAccountName,
      defaultCreditDays,
      defaultWhtRate,
      active: true,
    });

    revalidatePath('/labor-payments/contractors');
    revalidatePath('/purchasing/vendors');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' };
  }
}
