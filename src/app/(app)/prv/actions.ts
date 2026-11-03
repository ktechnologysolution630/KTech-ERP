'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import {
  createPrv,
  updatePrvStatus,
  type PrvCategory,
  type PrvStatus,
} from '@/server/services/prv';

export async function createPrvAction(formData: FormData) {
  const user = await requireUser();

  const projectId = String(formData.get('projectId') || '');
  const poId = formData.get('poId') ? String(formData.get('poId')) : null;
  const vendorId = formData.get('vendorId') ? String(formData.get('vendorId')) : null;
  const payeeName = String(formData.get('payeeName') || '').trim();
  const category = String(formData.get('category') || 'EXPENSE') as PrvCategory;
  const installmentNo = formData.get('installmentNo') ? Number(formData.get('installmentNo')) : null;
  const retentionPercent = Number(formData.get('retentionPercent') || 0);
  const whtRate = Number(formData.get('whtRate') || 0);
  const vatRate = Number(formData.get('vatRate') || 0);
  const notes = String(formData.get('notes') || '').trim();

  const rawDescriptions = formData.getAll('description');
  const rawQuantities = formData.getAll('quantity');
  const rawUnits = formData.getAll('unit');
  const rawUnitPrices = formData.getAll('unitPrice');
  const rawProgress = formData.getAll('progressPercent');

  const items = rawDescriptions.map((desc, idx) => ({
    description: String(desc || ''),
    quantity: Number(rawQuantities[idx] || 1),
    unit: String(rawUnits[idx] || 'งาน'),
    unitPrice: Number(rawUnitPrices[idx] || 0),
    progressPercent: Number(rawProgress[idx] || 100),
  })).filter((it) => it.description.trim() !== '');

  if (!projectId) throw new Error('กรุณาเลือกโครงการ');
  if (!payeeName) throw new Error('กรุณาระบุชื่อผู้รับเงิน / ผู้ขอเบิก');
  if (items.length === 0) throw new Error('ต้องมีรายการขอเบิกอย่างน้อย 1 รายการ');

  const db = await getDb();
  const prv = await createPrv(
    db,
    {
      projectId,
      poId,
      vendorId,
      payeeName,
      category,
      installmentNo,
      retentionPercent,
      whtRate,
      vatRate,
      notes,
      items,
    },
    user.id,
  );

  revalidatePath('/prv');
  redirect(`/prv/${prv.id}`);
}

export async function updatePrvStatusAction(formData: FormData) {
  const user = await requireUser();

  const id = String(formData.get('id') || '');
  const status = String(formData.get('status') || '') as PrvStatus;

  const db = await getDb();
  await updatePrvStatus(db, id, status, user.id);

  revalidatePath('/prv');
  revalidatePath(`/prv/${id}`);
}
