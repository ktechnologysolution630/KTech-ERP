'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import {
  createOrUpdateStockItem,
  recordStockMovement,
  createStockAdjustRequest,
  approveStockAdjustRequest,
} from '@/server/services/stock';
import { type StockMovementType } from '@/db/schema';

export async function createStockItemAction(formData: FormData) {
  const user = await requireUser();

  const id = formData.get('id') ? String(formData.get('id')) : undefined;
  const sku = formData.get('sku') ? String(formData.get('sku')) : undefined;
  const name = String(formData.get('name') || '').trim();
  const category = String(formData.get('category') || 'ทั่วไป').trim();
  const unit = String(formData.get('unit') || 'ชิ้น').trim();
  const unitCost = Number(formData.get('unitCost') || 0);
  const reorderPoint = Number(formData.get('reorderPoint') || 0);
  const notes = String(formData.get('notes') || '').trim();

  if (!name) throw new Error('กรุณาระบุชื่อสินค้า/วัสดุ');

  const db = await getDb();
  await createOrUpdateStockItem(db, {
    id,
    sku,
    name,
    category,
    unit,
    unitCost,
    reorderPoint,
    notes,
  });

  revalidatePath('/stock');
}

export async function recordStockMovementAction(formData: FormData) {
  const user = await requireUser();

  const stockItemId = String(formData.get('stockItemId') || '');
  const projectId = formData.get('projectId') ? String(formData.get('projectId')) : null;
  const targetProjectId = formData.get('targetProjectId') ? String(formData.get('targetProjectId')) : null;
  const type = String(formData.get('type') || 'ISSUE') as StockMovementType;
  const quantity = Number(formData.get('quantity') || 0);
  const unitCost = Number(formData.get('unitCost') || 0);
  const locationUsed = formData.get('locationUsed') ? String(formData.get('locationUsed')) : undefined;
  const notes = formData.get('notes') ? String(formData.get('notes')) : undefined;

  if (!stockItemId) throw new Error('กรุณาเลือกรายการสินค้า');
  if (quantity <= 0) throw new Error('จำนวนต้องมากกว่า 0');

  const db = await getDb();
  await recordStockMovement(db, {
    stockItemId,
    projectId,
    targetProjectId,
    type,
    quantity,
    unitCost,
    performedBy: user.id,
    locationUsed,
    notes,
  });

  revalidatePath('/stock');
}

export async function createStockAdjustRequestAction(formData: FormData) {
  const user = await requireUser();

  const stockItemId = String(formData.get('stockItemId') || '');
  const projectId = formData.get('projectId') ? String(formData.get('projectId')) : null;
  const currentQty = Number(formData.get('currentQty') || 0);
  const adjustedQty = Number(formData.get('adjustedQty') || 0);
  const reason = String(formData.get('reason') || 'ตรวจนับยอดจริง').trim();
  const notes = String(formData.get('notes') || '').trim();

  if (!stockItemId) throw new Error('กรุณาเลือกสินค้า');
  if (!reason) throw new Error('กรุณาระบุเหตุผลในการปรับยอด');

  const db = await getDb();
  await createStockAdjustRequest(db, {
    stockItemId,
    projectId,
    currentQty,
    adjustedQty,
    reason,
    notes,
    requestedBy: user.id,
  });

  revalidatePath('/stock');
}

export async function approveStockAdjustAction(formData: FormData) {
  const user = await requireUser();

  const requestId = String(formData.get('requestId') || '');
  const approved = formData.get('approved') === 'true';

  const db = await getDb();
  await approveStockAdjustRequest(db, requestId, user.id, approved);

  revalidatePath('/stock');
}
