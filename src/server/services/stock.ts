import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  projects,
  stockAdjustRequests,
  stockBalances,
  stockItems,
  stockMovements,
  users,
  type SessionUser,
  type StockAdjustStatus,
  type StockMovementType,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, Decimal, round2 } from '@/domain/money';
import { assertCan, can, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { notify, usersWithRole } from './notifications';
import { nextDocNumber } from './numbering';

/** The central store is the stock location without a project. */
export const CENTRAL_STORE = 'คลังกลาง';

const MAX_QTY = 1_000_000_000;
const uuid = z.string().uuid('ข้อมูลไม่ถูกต้อง');

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('INVALID_STOCK', r.error.issues[0].message);
  return r.data;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  id: uuid.optional(),
  sku: z.string().trim().max(50).default(''),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อสินค้า/วัสดุ').max(300),
  category: z.string().trim().max(100).default('ทั่วไป'),
  unit: z.string().trim().min(1, 'กรุณาระบุหน่วย').max(30).default('ชิ้น'),
  unitCost: z.number().finite().min(0, 'ราคาทุนต้องไม่ติดลบ').max(1_000_000_000).default(0),
  reorderPoint: z.number().finite().min(0, 'จุดสั่งซื้อต้องไม่ติดลบ').max(MAX_QTY).default(0),
  notes: z.string().trim().max(1000).default(''),
});
export type StockItemInput = z.input<typeof itemSchema>;

/** Inserts or updates a catalog item without permission checks (system use, e.g. receipt sync). */
async function writeStockItem(tx: Db, data: z.output<typeof itemSchema>) {
  const sku = data.sku || (await nextDocNumber(tx, 'MAT'));
  const [dup] = await tx.select({ id: stockItems.id }).from(stockItems).where(eq(stockItems.sku, sku)).limit(1);
  if (dup && dup.id !== data.id) throw new DomainError('DUPLICATE_SKU', `รหัสวัสดุ ${sku} มีอยู่แล้ว`, 409);

  const values = {
    sku,
    name: data.name,
    category: data.category || 'ทั่วไป',
    unit: data.unit,
    unitCost: D(data.unitCost).toFixed(2),
    reorderPoint: D(data.reorderPoint).toFixed(2),
    notes: data.notes,
  };
  if (data.id) {
    const [updated] = await tx
      .update(stockItems)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(stockItems.id, data.id))
      .returning();
    if (!updated) throw new DomainError('NOT_FOUND', 'ไม่พบรายการวัสดุ', 404);
    return updated;
  }
  const [created] = await tx.insert(stockItems).values(values).returning();
  return created;
}

export async function upsertStockItem(db: Db, actor: SessionUser, input: StockItemInput) {
  assertCan(actor, 'stock.items');
  const data = parse(itemSchema, input);
  return db.transaction((tx) => writeStockItem(tx, data));
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export interface StockMovementInput {
  stockItemId: string;
  /** null = central store */
  projectId: string | null;
  type: StockMovementType;
  /** Always positive; ADJUST carries its sign in `adjustDelta` instead */
  quantity: number;
  /** Signed change for ADJUST movements */
  adjustDelta?: number;
  unitCost?: number;
  /** TRANSFER destination; null = central store */
  targetProjectId?: string | null;
  warehouseName?: string;
  targetWarehouseName?: string;
  referenceType?: string;
  referenceId?: string;
  referenceNumber?: string;
  performedBy: string;
  locationUsed?: string;
  notes?: string;
}

function locationLabel(projectId: string | null): string {
  return projectId ? 'คลังหน้างาน' : CENTRAL_STORE;
}

/**
 * Applies one movement inside the caller's transaction. The item row is locked first so
 * concurrent movements of the same item are serialized (no lost updates, no duplicate
 * balance rows). Throws INSUFFICIENT_STOCK instead of letting a balance go negative.
 */
export async function applyStockMovement(tx: Db, input: StockMovementInput): Promise<string> {
  const [item] = await tx.select().from(stockItems).where(eq(stockItems.id, input.stockItemId)).for('update');
  if (!item) throw new DomainError('NOT_FOUND', 'ไม่พบรายการวัสดุ', 404);

  const balanceAt = async (projectId: string | null) => {
    const [row] = await tx
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.stockItemId, item.id),
          projectId ? eq(stockBalances.projectId, projectId) : isNull(stockBalances.projectId),
        ),
      )
      .limit(1);
    return row ?? null;
  };

  const change = async (projectId: string | null, delta: Decimal, warehouseName?: string) => {
    const row = await balanceAt(projectId);
    const current = D(row?.quantity ?? 0);
    const next = current.plus(delta);
    if (next.lt(0)) {
      throw new DomainError(
        'INSUFFICIENT_STOCK',
        `${item.name} คงเหลือ${projectId ? 'ที่หน้างาน' : 'ในคลังกลาง'}เพียง ${current.toNumber()} ${item.unit}`,
        409,
      );
    }
    if (row) {
      await tx
        .update(stockBalances)
        .set({
          quantity: next.toFixed(3),
          ...(warehouseName ? { warehouseName } : {}),
          updatedAt: new Date(),
        })
        .where(eq(stockBalances.id, row.id));
    } else {
      await tx.insert(stockBalances).values({
        stockItemId: item.id,
        projectId,
        warehouseName: warehouseName || locationLabel(projectId),
        quantity: next.toFixed(3),
      });
    }
  };

  const qty = D(input.quantity);
  // Issues and transfers are valued at the item's standard cost when no cost is given
  const unitCost = D(input.unitCost && input.unitCost > 0 ? input.unitCost : item.unitCost);

  switch (input.type) {
    case 'RECEIVE':
    case 'RETURN':
      await change(input.projectId, qty, input.warehouseName);
      break;
    case 'ISSUE':
      await change(input.projectId, qty.neg());
      break;
    case 'TRANSFER':
      if (input.targetProjectId === undefined) {
        throw new DomainError('INVALID_STOCK', 'กรุณาเลือกคลังปลายทาง');
      }
      if (input.targetProjectId === input.projectId) {
        throw new DomainError('INVALID_STOCK', 'คลังต้นทางและปลายทางต้องไม่ใช่ที่เดียวกัน');
      }
      await change(input.projectId, qty.neg());
      await change(input.targetProjectId, qty, input.targetWarehouseName);
      break;
    case 'ADJUST':
      await change(input.projectId, D(input.adjustDelta ?? 0));
      break;
  }

  const movementNumber = await nextDocNumber(tx, 'SM');
  const signedQty = input.type === 'ADJUST' ? D(input.adjustDelta ?? 0) : qty;
  await tx.insert(stockMovements).values({
    movementNumber,
    stockItemId: item.id,
    projectId: input.projectId,
    type: input.type,
    quantity: signedQty.toFixed(3),
    unitCost: unitCost.toFixed(2),
    totalValue: round2(signedQty.abs().times(unitCost)).toFixed(2),
    referenceType: input.referenceType || 'MANUAL',
    referenceId: input.referenceId,
    referenceNumber: input.referenceNumber,
    targetProjectId: input.type === 'TRANSFER' ? (input.targetProjectId ?? null) : null,
    performedBy: input.performedBy,
    locationUsed: input.locationUsed,
    notes: input.notes || '',
  });
  // Receipts at a new price become the item's standard cost
  if (input.type === 'RECEIVE' && input.unitCost && input.unitCost > 0) {
    await tx.update(stockItems).set({ unitCost: unitCost.toFixed(2), updatedAt: new Date() }).where(eq(stockItems.id, item.id));
  }
  return movementNumber;
}

const locationId = uuid.nullable();

const movementSchema = z
  .object({
    stockItemId: uuid,
    projectId: locationId,
    type: z.enum(['RECEIVE', 'ISSUE', 'TRANSFER', 'RETURN']),
    quantity: z.number().finite().positive('จำนวนต้องมากกว่า 0').max(MAX_QTY),
    unitCost: z.number().finite().min(0, 'ราคาทุนต้องไม่ติดลบ').max(1_000_000_000).optional(),
    targetProjectId: locationId.optional(),
    warehouseName: z.string().trim().max(100).optional(),
    targetWarehouseName: z.string().trim().max(100).optional(),
    referenceNumber: z.string().trim().max(100).optional(),
    locationUsed: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((m) => m.type !== 'TRANSFER' || m.targetProjectId !== undefined, {
    message: 'กรุณาเลือกคลังปลายทาง',
  });
export type RecordMovementInput = z.input<typeof movementSchema>;

async function assertProjectExists(tx: Db, projectId: string | null | undefined) {
  if (!projectId) return;
  const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
}

/** Manual receipt / issue / transfer / return from the stock page. */
export async function recordStockMovement(db: Db, actor: SessionUser, input: RecordMovementInput): Promise<string> {
  const data = parse(movementSchema, input);
  // Authority follows the source: site staff may send surplus to any store (e.g. back to central)
  assertCan(actor, 'stock.move', { projectId: data.projectId });
  return db.transaction(async (tx) => {
    await assertProjectExists(tx, data.projectId);
    await assertProjectExists(tx, data.targetProjectId);
    return applyStockMovement(tx, { ...data, performedBy: actor.id });
  });
}

/** Goods received against a PO go straight into stock (office POs into the central store). */
export async function syncReceiptToStock(
  tx: Db,
  receiptId: string,
  actorId: string,
  projectId: string | null,
  poNumber: string,
  lines: Array<{ description: string; unit: string; unitPrice: number | string; qty: number }>,
) {
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const name = line.description.trim();
    const [existing] = await tx.select({ id: stockItems.id }).from(stockItems).where(eq(stockItems.name, name)).limit(1);
    const stockItemId =
      existing?.id ??
      (
        await writeStockItem(tx, {
          sku: '',
          name,
          category: 'วัสดุโครงการ',
          unit: line.unit || 'ชิ้น',
          unitCost: Number(line.unitPrice || 0),
          reorderPoint: 0,
          notes: '',
        })
      ).id;

    await applyStockMovement(tx, {
      stockItemId,
      projectId,
      type: 'RECEIVE',
      quantity: line.qty,
      unitCost: Number(line.unitPrice || 0),
      referenceType: 'RECEIPT',
      referenceId: receiptId,
      referenceNumber: poNumber,
      performedBy: actorId,
      notes: `รับของตาม PO ${poNumber}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Adjustments (count differences) — requested by staff, approved by management
// ---------------------------------------------------------------------------

const adjustSchema = z.object({
  stockItemId: uuid,
  projectId: locationId,
  countedQty: z.number().finite().min(0, 'ยอดตรวจนับต้องไม่ติดลบ').max(MAX_QTY),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลในการปรับยอด').max(500),
  notes: z.string().trim().max(1000).default(''),
});
export type StockAdjustInput = z.input<typeof adjustSchema>;

/** The system quantity is read here, not trusted from the client. */
export async function requestStockAdjust(db: Db, actor: SessionUser, input: StockAdjustInput) {
  const data = parse(adjustSchema, input);
  assertCan(actor, 'stock.move', { projectId: data.projectId });
  return db.transaction(async (tx) => {
    await assertProjectExists(tx, data.projectId);
    const [item] = await tx.select().from(stockItems).where(eq(stockItems.id, data.stockItemId)).limit(1);
    if (!item) throw new DomainError('NOT_FOUND', 'ไม่พบรายการวัสดุ', 404);
    const [bal] = await tx
      .select({ quantity: stockBalances.quantity })
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.stockItemId, item.id),
          data.projectId ? eq(stockBalances.projectId, data.projectId) : isNull(stockBalances.projectId),
        ),
      )
      .limit(1);
    const current = D(bal?.quantity ?? 0);
    const diff = D(data.countedQty).minus(current);
    if (diff.isZero()) throw new DomainError('INVALID_STOCK', 'ยอดตรวจนับเท่ากับยอดในระบบ ไม่ต้องปรับ');

    const requestNumber = await nextDocNumber(tx, 'SAR');
    const [req] = await tx
      .insert(stockAdjustRequests)
      .values({
        requestNumber,
        stockItemId: item.id,
        projectId: data.projectId,
        currentQty: current.toFixed(3),
        adjustedQty: D(data.countedQty).toFixed(3),
        differenceQty: diff.toFixed(3),
        reason: data.reason,
        status: 'PENDING',
        requestedBy: actor.id,
        notes: data.notes,
      })
      .returning();
    await logActivity(tx, { entityType: 'STOCK_ADJUST', entityId: req.id, action: 'REQUEST', userId: actor.id });
    const approvers = (await usersWithRole(tx, ['PURCHASING_HEAD', 'OWNER'])).filter((id) => id !== actor.id);
    await notify(tx, approvers, { title: `${requestNumber} ขอปรับยอดสต็อก ${item.name}`, href: '/stock?tab=document-history' });
    return req;
  });
}

export async function decideStockAdjust(
  db: Db,
  actor: SessionUser,
  requestId: string,
  approve: boolean,
): Promise<StockAdjustStatus> {
  assertCan(actor, 'stock.approveAdjust');
  parse(uuid, requestId);
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(stockAdjustRequests).where(eq(stockAdjustRequests.id, requestId)).for('update');
    if (!req) throw new DomainError('NOT_FOUND', 'ไม่พบคำขอปรับยอด', 404);
    if (req.status !== 'PENDING') throw new DomainError('INVALID_STATE', 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ', 409);
    if (req.requestedBy === actor.id) throw new DomainError('SELF_APPROVAL', 'อนุมัติคำขอของตนเองไม่ได้', 403);

    if (approve) {
      await applyStockMovement(tx, {
        stockItemId: req.stockItemId,
        projectId: req.projectId,
        type: 'ADJUST',
        quantity: Math.abs(Number(req.differenceQty)),
        adjustDelta: Number(req.differenceQty),
        referenceType: 'ADJUSTMENT',
        referenceId: req.id,
        referenceNumber: req.requestNumber,
        performedBy: actor.id,
        notes: `ปรับยอดตามคำขอ ${req.requestNumber}: ${req.reason}`,
      });
    }
    const status: StockAdjustStatus = approve ? 'APPROVED' : 'REJECTED';
    await tx
      .update(stockAdjustRequests)
      .set({ status, approvedBy: actor.id, approvedAt: new Date() })
      .where(eq(stockAdjustRequests.id, requestId));
    await logActivity(tx, { entityType: 'STOCK_ADJUST', entityId: req.id, action: approve ? 'APPROVE' : 'REJECT', userId: actor.id });
    await notify(tx, [req.requestedBy], {
      title: `${req.requestNumber} ${approve ? 'อนุมัติปรับยอดแล้ว' : 'ไม่อนุมัติปรับยอด'}`,
      href: '/stock?tab=document-history',
    });
    return status;
  });
}

// ---------------------------------------------------------------------------
// Read model for the stock page
// ---------------------------------------------------------------------------

export interface StockLocationDto {
  /** null = central store */
  projectId: string | null;
  name: string;
}

export interface StockItemDto {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  unitCost: number;
  reorderPoint: number;
  notes: string;
  totalQty: number;
  totalValue: number;
  isLowStock: boolean;
  balances: { projectId: string | null; locationName: string; warehouseName: string; quantity: number }[];
}

export interface StockMovementDto {
  id: string;
  movementNumber: string;
  date: Date;
  type: StockMovementType;
  stockItemId: string;
  sku: string;
  itemName: string;
  unit: string;
  quantity: number;
  value: number;
  fromName: string;
  toName: string;
  /** Location whose balance the movement changed (TRANSFER: the source); null = central store */
  projectId: string | null;
  /** TRANSFER destination; null = central store or not a transfer */
  targetProjectId: string | null;
  referenceNumber: string | null;
  performedByName: string;
  notes: string;
}

export interface StockAdjustDto {
  id: string;
  requestNumber: string;
  sku: string;
  itemName: string;
  unit: string;
  locationName: string;
  currentQty: number;
  adjustedQty: number;
  differenceQty: number;
  reason: string;
  status: StockAdjustStatus;
  requestedBy: string;
  requestedByName: string;
  approvedByName: string | null;
  createdAt: Date;
}

export interface MonthlyFlow {
  /** yyyy-mm */
  month: string;
  receiveValue: number;
  issueValue: number;
  receiveCount: number;
  issueCount: number;
}

export interface StockPageData {
  locations: StockLocationDto[];
  items: StockItemDto[];
  movements: StockMovementDto[];
  adjustRequests: StockAdjustDto[];
  monthly: MonthlyFlow[];
  permissions: { manageItems: boolean; approveAdjust: boolean; movableProjectIds: string[]; moveCentral: boolean };
  me: string;
}

function monthKey(d: Date): string {
  // Bangkok month boundaries (UTC+7)
  const t = new Date(d.getTime() + 7 * 3600_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastMonths(n: number, now = new Date()): string[] {
  const t = new Date(now.getTime() + 7 * 3600_000);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Everything the stock page shows. Site staff see the central store and their own projects;
 * everyone else sees every location.
 */
export async function getStockPageData(db: Db, actor: SessionUser, opts: { movementLimit?: number } = {}): Promise<StockPageData> {
  const scoped = isSiteScopedOnly(actor);
  const projectRows = await db
    .select({ id: projects.id, code: projects.code, name: projects.name })
    .from(projects)
    .where(scoped ? (actor.projectIds.length ? inArray(projects.id, actor.projectIds) : sql`false`) : undefined)
    .orderBy(projects.code);
  const projectName = new Map(projectRows.map((p) => [p.id, `${p.code} ${p.name}`]));
  const visible = (projectId: string | null) => projectId === null || projectName.has(projectId);
  const nameOf = (projectId: string | null) => (projectId ? (projectName.get(projectId) ?? 'โครงการ') : CENTRAL_STORE);

  const [itemRows, balanceRows, userRows] = await Promise.all([
    db.select().from(stockItems).orderBy(stockItems.sku),
    db.select().from(stockBalances),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const userName = new Map(userRows.map((u) => [u.id, u.name]));

  const balancesByItem = new Map<string, StockItemDto['balances']>();
  for (const b of balanceRows) {
    if (!visible(b.projectId)) continue;
    const list = balancesByItem.get(b.stockItemId) ?? [];
    list.push({ projectId: b.projectId, locationName: nameOf(b.projectId), warehouseName: b.warehouseName, quantity: Number(b.quantity) });
    balancesByItem.set(b.stockItemId, list);
  }

  const items: StockItemDto[] = itemRows.map((it) => {
    const balances = balancesByItem.get(it.id) ?? [];
    const totalQty = balances.reduce((s, b) => s.plus(b.quantity), D(0));
    const reorderPoint = Number(it.reorderPoint);
    return {
      id: it.id,
      sku: it.sku,
      name: it.name,
      category: it.category,
      unit: it.unit,
      unitCost: Number(it.unitCost),
      reorderPoint,
      notes: it.notes ?? '',
      totalQty: totalQty.toNumber(),
      totalValue: round2(totalQty.times(it.unitCost)).toNumber(),
      isLowStock: reorderPoint > 0 && totalQty.lte(reorderPoint),
      balances,
    };
  });
  const itemById = new Map(items.map((i) => [i.id, i]));

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 13);
  const movementRows = await db
    .select()
    .from(stockMovements)
    .where(gte(stockMovements.createdAt, since))
    .orderBy(desc(stockMovements.createdAt));

  const movements: StockMovementDto[] = [];
  const months = lastMonths(12);
  const monthly = new Map<string, MonthlyFlow>(months.map((m) => [m, { month: m, receiveValue: 0, issueValue: 0, receiveCount: 0, issueCount: 0 }]));
  for (const m of movementRows) {
    if (!visible(m.projectId) && !(m.targetProjectId && visible(m.targetProjectId))) continue;
    const it = itemById.get(m.stockItemId);
    const qty = Number(m.quantity);
    const value = Number(m.totalValue);
    const bucket = monthly.get(monthKey(m.createdAt));
    if (bucket && (m.type === 'RECEIVE' || m.type === 'RETURN')) {
      bucket.receiveValue += value;
      bucket.receiveCount += 1;
    } else if (bucket && m.type === 'ISSUE') {
      bucket.issueValue += value;
      bucket.issueCount += 1;
    }
    if (movements.length >= (opts.movementLimit ?? 500)) continue;
    const here = nameOf(m.projectId);
    let fromName = here;
    let toName = here;
    if (m.type === 'RECEIVE') fromName = m.referenceNumber ? `PO ${m.referenceNumber}` : 'รับเข้า';
    else if (m.type === 'RETURN') fromName = 'รับคืน';
    else if (m.type === 'ISSUE') toName = m.locationUsed || 'เบิกใช้หน้างาน';
    else if (m.type === 'TRANSFER') toName = nameOf(m.targetProjectId);
    else if (m.type === 'ADJUST') fromName = 'ปรับยอด';
    movements.push({
      id: m.id,
      movementNumber: m.movementNumber,
      date: m.createdAt,
      type: m.type,
      stockItemId: m.stockItemId,
      sku: it?.sku ?? '-',
      itemName: it?.name ?? 'รายการที่ถูกลบ',
      unit: it?.unit ?? '',
      quantity: qty,
      value,
      fromName,
      toName,
      projectId: m.projectId,
      targetProjectId: m.targetProjectId,
      referenceNumber: m.referenceNumber,
      performedByName: userName.get(m.performedBy) ?? '-',
      notes: m.notes ?? '',
    });
  }

  const adjustRows = await db
    .select()
    .from(stockAdjustRequests)
    .orderBy(desc(stockAdjustRequests.createdAt))
    .limit(200);
  const adjustRequests: StockAdjustDto[] = adjustRows
    .filter((r) => visible(r.projectId))
    .map((r) => {
      const it = itemById.get(r.stockItemId);
      return {
        id: r.id,
        requestNumber: r.requestNumber,
        sku: it?.sku ?? '-',
        itemName: it?.name ?? '-',
        unit: it?.unit ?? '',
        locationName: nameOf(r.projectId),
        currentQty: Number(r.currentQty),
        adjustedQty: Number(r.adjustedQty),
        differenceQty: Number(r.differenceQty),
        reason: r.reason,
        status: r.status,
        requestedBy: r.requestedBy,
        requestedByName: userName.get(r.requestedBy) ?? '-',
        approvedByName: r.approvedBy ? (userName.get(r.approvedBy) ?? '-') : null,
        createdAt: r.createdAt,
      };
    });

  return {
    locations: [{ projectId: null, name: CENTRAL_STORE }, ...projectRows.map((p) => ({ projectId: p.id, name: `${p.code} ${p.name}` }))],
    items,
    movements,
    adjustRequests,
    monthly: [...monthly.values()].map((m) => ({ ...m, receiveValue: round2(D(m.receiveValue)).toNumber(), issueValue: round2(D(m.issueValue)).toNumber() })),
    permissions: {
      manageItems: can(actor, 'stock.items'),
      approveAdjust: can(actor, 'stock.approveAdjust'),
      movableProjectIds: projectRows.filter((p) => can(actor, 'stock.move', { projectId: p.id })).map((p) => p.id),
      moveCentral: can(actor, 'stock.move', { projectId: null }),
    },
    me: actor.id,
  };
}

/** Dashboard-style totals derived from the page data (kept here so other pages can reuse them). */
export function summarizeStock(items: StockItemDto[]) {
  const totalValue = items.reduce((s, i) => s.plus(i.totalValue), D(0));
  const byCategory = new Map<string, { count: number; value: Decimal }>();
  for (const it of items) {
    const c = byCategory.get(it.category) ?? { count: 0, value: D(0) };
    c.count += 1;
    c.value = c.value.plus(it.totalValue);
    byCategory.set(it.category, c);
  }
  return {
    totalItems: items.length,
    totalValue: totalValue.toNumber(),
    lowStock: items.filter((i) => i.isLowStock),
    categories: [...byCategory.entries()]
      .map(([category, c]) => ({ category, itemCount: c.count, totalValue: c.value.toNumber() }))
      .sort((a, b) => b.totalValue - a.totalValue),
  };
}
