import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  stockItems,
  stockBalances,
  stockMovements,
  stockAdjustRequests,
  projects,
  users,
  type StockMovementType,
} from '@/db/schema';
import { nextDocNumber } from './numbering';
import Decimal from 'decimal.js';

export interface StockOverviewData {
  totalItems: number;
  totalValue: number;
  lowStockCount: number;
  totalMovements: number;
  categoryStats: Array<{
    category: string;
    itemCount: number;
    totalValue: number;
    percentage: number;
  }>;
  projectStats: Array<{
    projectId: string | null;
    projectName: string;
    itemCount: number;
    totalValue: number;
    percentage: number;
  }>;
  lowStockAlerts: Array<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    category: string;
    remaining: number;
    reorderPoint: number;
    imageUrl?: string | null;
  }>;
  recentMovements: Array<{
    id: string;
    movementNumber: string;
    date: Date;
    type: StockMovementType;
    sku: string;
    itemName: string;
    quantity: number;
    unit: string;
    projectName: string;
    performedByName: string;
    locationUsed?: string | null;
    notes?: string | null;
  }>;
}

export async function getStockOverview(db: Db): Promise<StockOverviewData> {
  const items = await db.select().from(stockItems);
  const balances = await db.select().from(stockBalances);
  const allProjects = await db.select().from(projects);
  const projectMap = new Map(allProjects.map((p) => [p.id, p.name]));

  // Calculate total balance & value per item
  const itemBalanceMap = new Map<string, number>();
  for (const b of balances) {
    const prev = itemBalanceMap.get(b.stockItemId) || 0;
    itemBalanceMap.set(b.stockItemId, prev + Number(b.quantity));
  }

  let totalValue = new Decimal(0);
  const lowStockAlerts: StockOverviewData['lowStockAlerts'] = [];
  const categoryMap = new Map<string, { count: number; value: Decimal }>();

  for (const it of items) {
    const qty = itemBalanceMap.get(it.id) || 0;
    const cost = new Decimal(it.unitCost || '0');
    const val = cost.mul(qty);
    totalValue = totalValue.add(val);

    // Categories
    const cat = it.category || 'ทั่วไป';
    const cStat = categoryMap.get(cat) || { count: 0, value: new Decimal(0) };
    cStat.count += 1;
    cStat.value = cStat.value.add(val);
    categoryMap.set(cat, cStat);

    // Low stock check
    const reorder = Number(it.reorderPoint || '0');
    if (reorder > 0 && qty <= reorder) {
      lowStockAlerts.push({
        id: it.id,
        sku: it.sku,
        name: it.name,
        unit: it.unit,
        category: it.category,
        remaining: qty,
        reorderPoint: reorder,
        imageUrl: it.imageUrl,
      });
    }
  }

  // Project breakdown
  const projectValueMap = new Map<string, { name: string; count: Set<string>; value: Decimal }>();
  for (const b of balances) {
    const pId = b.projectId || 'CENTRAL';
    const pName = b.projectId ? projectMap.get(b.projectId) || 'ไม่ระบุโครงการ' : 'คลังกลาง (สำนักงานใหญ่)';
    const item = items.find((i) => i.id === b.stockItemId);
    const cost = item ? new Decimal(item.unitCost || '0') : new Decimal(0);
    const val = cost.mul(Number(b.quantity));

    const pStat = projectValueMap.get(pId) || { name: pName, count: new Set<string>(), value: new Decimal(0) };
    pStat.count.add(b.stockItemId);
    pStat.value = pStat.value.add(val);
    projectValueMap.set(pId, pStat);
  }

  const totValNum = totalValue.toNumber();

  const categoryStats = Array.from(categoryMap.entries()).map(([category, s]) => ({
    category,
    itemCount: s.count,
    totalValue: s.value.toNumber(),
    percentage: totValNum > 0 ? Math.round((s.value.toNumber() / totValNum) * 100) : 0,
  })).sort((a, b) => b.totalValue - a.totalValue);

  const projectStats = Array.from(projectValueMap.entries()).map(([pId, s]) => ({
    projectId: pId === 'CENTRAL' ? null : pId,
    projectName: s.name,
    itemCount: s.count.size,
    totalValue: s.value.toNumber(),
    percentage: totValNum > 0 ? Math.round((s.value.toNumber() / totValNum) * 100) : 0,
  })).sort((a, b) => b.totalValue - a.totalValue);

  // Recent movements
  const movements = await db
    .select({
      id: stockMovements.id,
      movementNumber: stockMovements.movementNumber,
      date: stockMovements.createdAt,
      type: stockMovements.type,
      stockItemId: stockMovements.stockItemId,
      quantity: stockMovements.quantity,
      projectId: stockMovements.projectId,
      performedBy: stockMovements.performedBy,
      locationUsed: stockMovements.locationUsed,
      notes: stockMovements.notes,
    })
    .from(stockMovements)
    .orderBy(desc(stockMovements.createdAt))
    .limit(15);

  const allUsers = await db.select().from(users);
  const userMap = new Map(allUsers.map((u) => [u.id, u.name]));
  const itemLookup = new Map(items.map((i) => [i.id, i]));

  const recentMovements = movements.map((m) => {
    const it = itemLookup.get(m.stockItemId);
    return {
      id: m.id,
      movementNumber: m.movementNumber,
      date: m.date,
      type: m.type,
      sku: it?.sku || '-',
      itemName: it?.name || 'รายการสินค้า',
      quantity: Number(m.quantity),
      unit: it?.unit || 'ชิ้น',
      projectName: m.projectId ? projectMap.get(m.projectId) || 'โครงการ' : 'คลังกลาง',
      performedByName: userMap.get(m.performedBy) || 'เจ้าหน้าที่',
      locationUsed: m.locationUsed,
      notes: m.notes,
    };
  });

  return {
    totalItems: items.length,
    totalValue: totValNum,
    lowStockCount: lowStockAlerts.length,
    totalMovements: movements.length,
    categoryStats,
    projectStats,
    lowStockAlerts,
    recentMovements,
  };
}

export async function listRecentAdjustRequests(db: Db, limit = 30) {
  return db
    .select({
      id: stockAdjustRequests.id,
      requestNumber: stockAdjustRequests.requestNumber,
      stockItemId: stockAdjustRequests.stockItemId,
      projectId: stockAdjustRequests.projectId,
      currentQty: stockAdjustRequests.currentQty,
      adjustedQty: stockAdjustRequests.adjustedQty,
      differenceQty: stockAdjustRequests.differenceQty,
      reason: stockAdjustRequests.reason,
      status: stockAdjustRequests.status,
      requestedBy: stockAdjustRequests.requestedBy,
      createdAt: stockAdjustRequests.createdAt,
    })
    .from(stockAdjustRequests)
    .orderBy(desc(stockAdjustRequests.createdAt))
    .limit(limit);
}

export async function getAllStockItems(
  db: Db,
  filters?: {
    search?: string;
    category?: string;
    projectId?: string;
  },
) {
  const allItems = await db.select().from(stockItems);
  const allBalances = await db.select().from(stockBalances);
  const allProjects = await db.select().from(projects);
  const projectMap = new Map(allProjects.map((p) => [p.id, p.name]));

  return allItems
    .filter((it) => {
      if (filters?.category && it.category !== filters.category) return false;
      if (filters?.search) {
        const q = filters.search.toLowerCase();
        const matchSku = it.sku.toLowerCase().includes(q);
        const matchName = it.name.toLowerCase().includes(q);
        if (!matchSku && !matchName) return false;
      }
      return true;
    })
    .map((it) => {
      let matchingBalances = allBalances.filter((b) => b.stockItemId === it.id);
      if (filters?.projectId) {
        matchingBalances = matchingBalances.filter((b) => b.projectId === filters.projectId);
      }
      const totalQty = matchingBalances.reduce((sum, b) => sum + Number(b.quantity), 0);
      const cost = Number(it.unitCost || 0);
      const totalVal = totalQty * cost;

      return {
        id: it.id,
        sku: it.sku,
        name: it.name,
        category: it.category,
        unit: it.unit,
        unitCost: cost,
        reorderPoint: Number(it.reorderPoint || 0),
        totalQty,
        totalValue: totalVal,
        isLowStock: Number(it.reorderPoint || 0) > 0 && totalQty <= Number(it.reorderPoint || 0),
        balances: matchingBalances.map((b) => ({
          id: b.id,
          projectId: b.projectId,
          projectName: b.projectId ? projectMap.get(b.projectId) || 'โครงการ' : 'คลังกลาง',
          warehouseName: b.warehouseName,
          location: b.location,
          quantity: Number(b.quantity),
        })),
      };
    });
}

export async function createOrUpdateStockItem(
  db: Db,
  data: {
    id?: string;
    sku?: string;
    name: string;
    category?: string;
    unit?: string;
    unitCost?: number;
    reorderPoint?: number;
    notes?: string;
    imageUrl?: string;
  },
) {
  let sku = data.sku?.trim();
  if (!sku) {
    const nextSeq = await nextDocNumber(db, 'SM');
    sku = `MAT-${nextSeq.slice(-4)}`;
  }

  if (data.id) {
    const [updated] = await db
      .update(stockItems)
      .set({
        sku,
        name: data.name,
        category: data.category || 'ทั่วไป',
        unit: data.unit || 'ชิ้น',
        unitCost: String(data.unitCost ?? 0),
        reorderPoint: String(data.reorderPoint ?? 0),
        notes: data.notes || '',
        imageUrl: data.imageUrl,
        updatedAt: new Date(),
      })
      .where(eq(stockItems.id, data.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(stockItems)
    .values({
      sku,
      name: data.name,
      category: data.category || 'ทั่วไป',
      unit: data.unit || 'ชิ้น',
      unitCost: String(data.unitCost ?? 0),
      reorderPoint: String(data.reorderPoint ?? 0),
      notes: data.notes || '',
      imageUrl: data.imageUrl,
    })
    .returning();
  return created;
}

export async function recordStockMovement(
  db: Db,
  input: {
    stockItemId: string;
    projectId?: string | null;
    type: StockMovementType;
    quantity: number;
    unitCost?: number;
    referenceType?: string;
    referenceId?: string;
    referenceNumber?: string;
    targetProjectId?: string | null;
    performedBy: string;
    locationUsed?: string;
    notes?: string;
  },
) {
  const movementNumber = await nextDocNumber(db, 'SM');
  const qty = Number(input.quantity);
  const cost = Number(input.unitCost ?? 0);
  const totalValue = qty * cost;

  // Insert movement record
  await db.insert(stockMovements).values({
    movementNumber,
    stockItemId: input.stockItemId,
    projectId: input.projectId || null,
    type: input.type,
    quantity: String(qty),
    unitCost: String(cost),
    totalValue: String(totalValue),
    referenceType: input.referenceType || 'MANUAL',
    referenceId: input.referenceId,
    referenceNumber: input.referenceNumber,
    targetProjectId: input.targetProjectId || null,
    performedBy: input.performedBy,
    locationUsed: input.locationUsed,
    notes: input.notes || '',
  });

  // Helper to adjust balance row
  const adjustBalance = async (pId: string | null | undefined, delta: number) => {
    const existing = await db
      .select()
      .from(stockBalances)
      .where(
        pId
          ? and(eq(stockBalances.stockItemId, input.stockItemId), eq(stockBalances.projectId, pId))
          : and(eq(stockBalances.stockItemId, input.stockItemId), sql`${stockBalances.projectId} IS NULL`),
      )
      .limit(1);

    if (existing.length > 0) {
      const newQty = Math.max(0, Number(existing[0].quantity) + delta);
      await db
        .update(stockBalances)
        .set({ quantity: String(newQty), updatedAt: new Date() })
        .where(eq(stockBalances.id, existing[0].id));
    } else {
      await db.insert(stockBalances).values({
        stockItemId: input.stockItemId,
        projectId: pId || null,
        warehouseName: pId ? 'คลังหน้างาน' : 'คลังกลาง',
        location: input.locationUsed || 'ทั่วไป',
        quantity: String(Math.max(0, delta)),
      });
    }
  };

  if (input.type === 'RECEIVE' || input.type === 'RETURN') {
    await adjustBalance(input.projectId, qty);
  } else if (input.type === 'ISSUE') {
    await adjustBalance(input.projectId, -qty);
  } else if (input.type === 'TRANSFER') {
    await adjustBalance(input.projectId, -qty);
    if (input.targetProjectId) {
      await adjustBalance(input.targetProjectId, qty);
    }
  } else if (input.type === 'ADJUST') {
    // For adjust, the passed quantity is delta
    await adjustBalance(input.projectId, qty);
  }

  return movementNumber;
}

export async function createStockAdjustRequest(
  db: Db,
  input: {
    stockItemId: string;
    projectId?: string | null;
    currentQty: number;
    adjustedQty: number;
    reason: string;
    requestedBy: string;
    notes?: string;
  },
) {
  const requestNumber = await nextDocNumber(db, 'SAR');
  const differenceQty = input.adjustedQty - input.currentQty;

  const [req] = await db
    .insert(stockAdjustRequests)
    .values({
      requestNumber,
      stockItemId: input.stockItemId,
      projectId: input.projectId || null,
      currentQty: String(input.currentQty),
      adjustedQty: String(input.adjustedQty),
      differenceQty: String(differenceQty),
      reason: input.reason,
      status: 'PENDING',
      requestedBy: input.requestedBy,
      notes: input.notes || '',
    })
    .returning();

  return req;
}

export async function approveStockAdjustRequest(
  db: Db,
  requestId: string,
  approverId: string,
  approved: boolean,
) {
  const [req] = await db
    .select()
    .from(stockAdjustRequests)
    .where(eq(stockAdjustRequests.id, requestId))
    .limit(1);

  if (!req || req.status !== 'PENDING') {
    throw new Error('คำขอปรับสต็อกไม่อยู่ในสถานะรออนุมัติ');
  }

  if (!approved) {
    await db
      .update(stockAdjustRequests)
      .set({
        status: 'REJECTED',
        approvedBy: approverId,
        approvedAt: new Date(),
      })
      .where(eq(stockAdjustRequests.id, requestId));
    return { status: 'REJECTED' };
  }

  // If approved, execute delta movement
  const delta = Number(req.differenceQty);
  await recordStockMovement(db, {
    stockItemId: req.stockItemId,
    projectId: req.projectId,
    type: 'ADJUST',
    quantity: delta,
    referenceType: 'ADJUSTMENT',
    referenceId: req.id,
    referenceNumber: req.requestNumber,
    performedBy: approverId,
    notes: `อนุมัติคำขอปรับสต็อก ${req.requestNumber}: ${req.reason}`,
  });

  await db
    .update(stockAdjustRequests)
    .set({
      status: 'APPROVED',
      approvedBy: approverId,
      approvedAt: new Date(),
    })
    .where(eq(stockAdjustRequests.id, requestId));

  return { status: 'APPROVED' };
}

export async function syncReceiptToStock(
  tx: Db,
  receiptId: string,
  actorId: string,
  projectId: string,
  poNumber: string,
  lines: Array<{ description: string; unit: string; unitPrice: number | string; qty: number }>,
) {
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const cleanName = line.description.trim();

    // Check if stock item exists
    const [existing] = await tx
      .select()
      .from(stockItems)
      .where(eq(stockItems.name, cleanName))
      .limit(1);

    let stockItemId = existing?.id;
    if (!stockItemId) {
      const created = await createOrUpdateStockItem(tx, {
        name: cleanName,
        unit: line.unit,
        unitCost: Number(line.unitPrice || 0),
        category: 'วัสดุโครงการ',
      });
      stockItemId = created.id;
    }

    await recordStockMovement(tx, {
      stockItemId,
      projectId,
      type: 'RECEIVE',
      quantity: line.qty,
      unitCost: Number(line.unitPrice || 0),
      referenceType: 'RECEIPT',
      referenceId: receiptId,
      referenceNumber: poNumber,
      performedBy: actorId,
      notes: `รับของหน้างานตาม PO ${poNumber}`,
    });
  }
}

