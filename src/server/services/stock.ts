import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  items,
  poLines,
  pos,
  projects,
  stockAdjustRequests,
  stockBalances,
  stockCountLines,
  stockCounts,
  stockItems,
  stockMovements,
  stockDocs,
  type StockDocType,
  users,
  vendors,
  type PoStatus,
  type SessionUser,
  type StockAdjustStatus,
  type StockMovementType,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, Decimal, round2 } from '@/domain/money';
import { DEFAULT_STOCK_CATEGORY, STOCK_CATEGORIES } from '@/domain/stock';
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
  category: z.string().trim().max(100).default(DEFAULT_STOCK_CATEGORY),
  unit: z.string().trim().min(1, 'กรุณาระบุหน่วย').max(30).default('ชิ้น'),
  /** Standard cost; left out, a new item starts at 0 and an existing one keeps its cost */
  unitCost: z.number().finite().min(0, 'ราคาทุนต้องไม่ติดลบ').max(1_000_000_000).optional(),
  reorderPoint: z.number().finite().min(0, 'จุดสั่งซื้อต้องไม่ติดลบ').max(MAX_QTY).default(0),
  notes: z.string().trim().max(1000).default(''),
});
export type StockItemInput = z.input<typeof itemSchema>;

/**
 * The item form: a new item may point at the PO line it is bought on (then its stock arrives
 * with the goods receipt), or, without a PO, start with an opening quantity in the central store.
 */
const itemFormSchema = itemSchema.extend({
  quantity: z.number().finite().min(0, 'จำนวนต้องไม่ติดลบ').max(MAX_QTY).default(0),
  poLineId: uuid.optional(),
});
export type StockItemFormInput = z.input<typeof itemFormSchema>;

/** Inserts or updates a catalog item without permission checks (system use, e.g. receipt sync). */
async function writeStockItem(tx: Db, data: z.output<typeof itemSchema>) {
  const sku = data.sku || (await nextDocNumber(tx, 'MAT'));
  const [dup] = await tx.select({ id: stockItems.id }).from(stockItems).where(eq(stockItems.sku, sku)).limit(1);
  if (dup && dup.id !== data.id) throw new DomainError('DUPLICATE_SKU', `รหัสวัสดุ ${sku} มีอยู่แล้ว`, 409);

  const values = {
    sku,
    name: data.name,
    category: data.category || DEFAULT_STOCK_CATEGORY,
    unit: data.unit,
    ...(data.unitCost !== undefined ? { unitCost: D(data.unitCost).toFixed(2) } : {}),
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

/** Approved POs: the purchase is decided, so its lines are real items at a real price. */
const PO_STATUSES_FOR_STOCK: PoStatus[] = ['APPROVED', 'ORDERED', 'COMPLETED'];

export interface PoLineOptionDto {
  id: string;
  poNumber: string;
  /** null = office PO, received into the central store */
  projectCode: string | null;
  vendorName: string;
  /** Item master code when the PO line picked one; '' when typed freely */
  itemCode: string;
  description: string;
  unit: string;
  qty: number;
  unitPrice: number;
}

/** Lines of approved POs not yet tied to a stock item, newest first, for the item form's PO picker. */
export async function listPoLinesForStock(db: Db, actor: SessionUser, limit = 300): Promise<PoLineOptionDto[]> {
  if (!can(actor, 'stock.items')) return [];
  const scoped = isSiteScopedOnly(actor);
  if (scoped && actor.projectIds.length === 0) return [];
  const rows = await db
    .select({
      id: poLines.id,
      poNumber: pos.number,
      projectCode: projects.code,
      vendorName: vendors.name,
      itemCode: items.code,
      description: poLines.description,
      unit: poLines.unitName,
      qty: poLines.qty,
      unitPrice: poLines.unitPrice,
    })
    .from(poLines)
    .innerJoin(pos, eq(pos.id, poLines.poId))
    .innerJoin(vendors, eq(vendors.id, pos.vendorId))
    .leftJoin(projects, eq(projects.id, pos.projectId))
    .leftJoin(items, eq(items.id, poLines.itemId))
    .where(
      and(
        inArray(pos.status, PO_STATUSES_FOR_STOCK),
        isNull(poLines.stockItemId),
        // Site staff see their own projects' POs only, not office POs
        scoped ? inArray(pos.projectId, actor.projectIds) : undefined,
      ),
    )
    .orderBy(desc(pos.createdAt), poLines.sort)
    .limit(limit);
  return rows.map((r) => ({ ...r, itemCode: r.itemCode ?? '', qty: Number(r.qty), unitPrice: Number(r.unitPrice) }));
}

/**
 * Saves an item from the stock page. A new item may come from a PO line: it takes the line's
 * price and is tied to it, so the goods receipt puts the stock into this item (no quantity is
 * entered then, or it would be counted twice). Without a PO, a new item may start with an
 * opening quantity in the central store. Existing items change their balances only through movements.
 */
export async function upsertStockItem(db: Db, actor: SessionUser, input: StockItemFormInput) {
  assertCan(actor, 'stock.items');
  const { quantity, poLineId, ...data } = parse(itemFormSchema, input);
  if (!data.id && !(STOCK_CATEGORIES as readonly string[]).includes(data.category)) {
    throw new DomainError('INVALID_STOCK', 'กรุณาเลือกหมวดหมู่จากรายการ');
  }
  if (poLineId && quantity > 0) {
    throw new DomainError('INVALID_STOCK', 'วัสดุที่อ้างอิง PO จะเข้าสต็อกเมื่อรับของ ไม่ต้องใส่จำนวน');
  }

  return db.transaction(async (tx) => {
    let source: { lineId: string; unitPrice: string } | null = null;
    if (poLineId && !data.id) {
      const [row] = await tx
        .select({ lineId: poLines.id, unitPrice: poLines.unitPrice, stockItemId: poLines.stockItemId, status: pos.status, projectId: pos.projectId })
        .from(poLines)
        .innerJoin(pos, eq(pos.id, poLines.poId))
        .where(eq(poLines.id, poLineId))
        .for('update');
      if (!row || !PO_STATUSES_FOR_STOCK.includes(row.status)) {
        throw new DomainError('INVALID_STOCK', 'ไม่พบรายการในใบสั่งซื้อที่อ้างอิง หรือใบสั่งซื้อยังไม่อนุมัติ/ถูกยกเลิก');
      }
      if (isSiteScopedOnly(actor) && (!row.projectId || !actor.projectIds.includes(row.projectId))) {
        throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์อ้างอิงใบสั่งซื้อนี้', 403);
      }
      if (row.stockItemId) {
        throw new DomainError('INVALID_STOCK', 'รายการนี้ในใบสั่งซื้อผูกกับวัสดุอื่นแล้ว', 409);
      }
      source = row;
    }

    const unitCost = data.id ? data.unitCost : (data.unitCost ?? (source ? Number(source.unitPrice) : 0));
    const item = await writeStockItem(tx, { ...data, unitCost });

    if (source) {
      await tx.update(poLines).set({ stockItemId: item.id, updatedAt: new Date() }).where(eq(poLines.id, source.lineId));
    } else if (!data.id && quantity > 0) {
      await applyStockMovement(tx, {
        stockItemId: item.id,
        projectId: null,
        type: 'RECEIVE',
        quantity,
        referenceType: 'OPENING',
        performedBy: actor.id,
        notes: 'ยอดยกมาเมื่อเพิ่มวัสดุ',
      });
    }
    return item;
  });
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
  /** Stock document the movement is a line of */
  docId?: string;
  /** Receipt line detail: price before discount, discount, VAT and extra cost in baht */
  listPrice?: number;
  discount?: number;
  vat?: number;
  extraCost?: number;
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
    docId: input.docId ?? null,
    listPrice: input.listPrice !== undefined ? round2(D(input.listPrice)).toFixed(2) : null,
    discount: round2(D(input.discount ?? 0)).toFixed(2),
    vat: round2(D(input.vat ?? 0)).toFixed(2),
    extraCost: round2(D(input.extraCost ?? 0)).toFixed(2),
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
  lines: Array<{ poLineId?: string; description: string; unit: string; unitPrice: number | string; qty: number }>,
) {
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const name = line.description.trim();
    // The item tied to the PO line wins; otherwise one with the same name, otherwise a new one
    const [linked] = line.poLineId
      ? await tx.select({ id: poLines.stockItemId }).from(poLines).where(eq(poLines.id, line.poLineId)).limit(1)
      : [];
    const [existing] = linked?.id
      ? [{ id: linked.id }]
      : await tx.select({ id: stockItems.id }).from(stockItems).where(eq(stockItems.name, name)).limit(1);
    const stockItemId =
      existing?.id ??
      (
        await writeStockItem(tx, {
          sku: '',
          name,
          category: DEFAULT_STOCK_CATEGORY,
          unit: line.unit || 'ชิ้น',
          unitCost: Number(line.unitPrice || 0),
          reorderPoint: 0,
          notes: '',
        })
      ).id;

    // Later receipts of this line go into the same item even if it is renamed
    if (line.poLineId && !linked?.id) {
      await tx.update(poLines).set({ stockItemId, updatedAt: new Date() }).where(eq(poLines.id, line.poLineId));
    }

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
// Stock counts (นับสต็อก) — a record of what was counted; balances do not change
// ---------------------------------------------------------------------------

const countSchema = z.object({
  countedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'กรุณาระบุวันที่นับ'),
  note: z.string().trim().max(1000).default(''),
  lines: z
    .array(
      z.object({
        stockItemId: uuid,
        projectId: locationId,
        countedQty: z.number().finite().min(0, 'ยอดนับจริงต้องไม่ติดลบ').max(MAX_QTY),
      }),
    )
    .min(1, 'กรุณากรอกยอดนับจริงอย่างน้อย 1 รายการ')
    .max(5000, 'บันทึกได้ครั้งละไม่เกิน 5,000 รายการ'),
});
export type StockCountInput = z.input<typeof countSchema>;

/**
 * Records a stock count. The system quantity is read here, at save time, so the difference is
 * against what the books held then; the counter may count only locations they may move stock in.
 */
export async function createStockCount(db: Db, actor: SessionUser, input: StockCountInput) {
  const data = parse(countSchema, input);
  const seen = new Set<string>();
  for (const l of data.lines) {
    const key = `${l.stockItemId}:${l.projectId ?? ''}`;
    if (seen.has(key)) throw new DomainError('INVALID_STOCK', 'มีรายการสินค้าและคลังซ้ำกันในการนับ');
    seen.add(key);
    assertCan(actor, 'stock.move', { projectId: l.projectId });
  }

  return db.transaction(async (tx) => {
    const itemIds = [...new Set(data.lines.map((l) => l.stockItemId))];
    const [itemRows, balances] = await Promise.all([
      tx.select({ id: stockItems.id }).from(stockItems).where(inArray(stockItems.id, itemIds)),
      tx.select().from(stockBalances).where(inArray(stockBalances.stockItemId, itemIds)),
    ]);
    if (itemRows.length !== itemIds.length) throw new DomainError('NOT_FOUND', 'ไม่พบรายการวัสดุบางรายการ', 404);
    for (const projectId of new Set(data.lines.map((l) => l.projectId))) await assertProjectExists(tx, projectId);
    const held = new Map(balances.map((b) => [`${b.stockItemId}:${b.projectId ?? ''}`, D(b.quantity)]));

    const countNumber = await nextDocNumber(tx, 'SC');
    const [count] = await tx
      .insert(stockCounts)
      .values({ countNumber, countedOn: data.countedOn, note: data.note, countedBy: actor.id })
      .returning();
    await tx.insert(stockCountLines).values(
      data.lines.map((l) => {
        const system = held.get(`${l.stockItemId}:${l.projectId ?? ''}`) ?? D(0);
        const counted = D(l.countedQty);
        return {
          countId: count.id,
          stockItemId: l.stockItemId,
          projectId: l.projectId,
          systemQty: system.toFixed(3),
          countedQty: counted.toFixed(3),
          differenceQty: counted.minus(system).toFixed(3),
        };
      }),
    );
    await logActivity(tx, { entityType: 'STOCK_ADJUST', entityId: count.id, action: 'COUNT', userId: actor.id, note: `${countNumber} นับ ${data.lines.length} รายการ` });
    return count;
  });
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
    const approvers = (await usersWithRole(tx, ['PURCHASING_HEAD', 'GENERAL_MANAGER', 'OWNER'])).filter((id) => id !== actor.id);
    await notify(tx, approvers, { title: `${requestNumber} ขอปรับยอดสต็อก ${item.name}`, href: '/stock?tab=stock-adjust', category: 'RECEIPT' });
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
      href: '/stock?tab=stock-adjust',
      category: 'RECEIPT',
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
  imageUrl: string | null;
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
  /** Stock document the movement is a line of; null for older or system movements */
  docId: string | null;
  docType: StockDocType | null;
  performedByName: string;
  notes: string;
}

export interface StockAdjustDto {
  id: string;
  requestNumber: string;
  sku: string;
  itemName: string;
  unit: string;
  /** Location of the adjustment; null = central store */
  projectId: string | null;
  locationName: string;
  /** Item's standard cost, to value the difference */
  unitCost: number;
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

export interface StockCountLineDto {
  sku: string;
  itemName: string;
  unit: string;
  projectId: string | null;
  locationName: string;
  systemQty: number;
  countedQty: number;
  differenceQty: number;
}

export interface StockCountDto {
  id: string;
  countNumber: string;
  countedOn: string;
  note: string;
  countedByName: string;
  createdAt: Date;
  /** Lines at locations the viewer may see */
  lines: StockCountLineDto[];
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
  /** Latest stock counts, newest first */
  counts: StockCountDto[];
  monthly: MonthlyFlow[];
  permissions: { manageItems: boolean; approveAdjust: boolean; movableProjectIds: string[]; moveCentral: boolean };
  /** Approved PO lines a new item can be created from; empty for users who cannot manage items */
  poLineOptions: PoLineOptionDto[];
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
      imageUrl: it.imageUrl,
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

  // Documents the movements belong to: their type (ยืม shows as such) and supplier
  const docIds = [...new Set(movementRows.map((m) => m.docId).filter((x): x is string => !!x))];
  const docRows = docIds.length > 0 ? await db.select({ id: stockDocs.id, type: stockDocs.type, supplierName: stockDocs.supplierName }).from(stockDocs).where(inArray(stockDocs.id, docIds)) : [];
  const docById = new Map(docRows.map((d) => [d.id, d]));
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
    const doc = m.docId ? docById.get(m.docId) : undefined;
    if (m.type === 'RECEIVE') fromName = doc ? doc.supplierName || 'รับเข้า' : m.referenceNumber ? `PO ${m.referenceNumber}` : 'รับเข้า';
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
      docId: m.docId,
      docType: doc?.type ?? null,
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
        projectId: r.projectId,
        locationName: nameOf(r.projectId),
        unitCost: it?.unitCost ?? 0,
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

  const countRows = await db.select().from(stockCounts).orderBy(desc(stockCounts.createdAt)).limit(100);
  const countLineRows = countRows.length
    ? await db.select().from(stockCountLines).where(inArray(stockCountLines.countId, countRows.map((c) => c.id)))
    : [];
  const counts: StockCountDto[] = countRows
    .map((c) => ({
      id: c.id,
      countNumber: c.countNumber,
      countedOn: c.countedOn,
      note: c.note,
      countedByName: userName.get(c.countedBy) ?? '-',
      createdAt: c.createdAt,
      lines: countLineRows
        .filter((l) => l.countId === c.id && visible(l.projectId))
        .map((l) => {
          const it = itemById.get(l.stockItemId);
          return {
            sku: it?.sku ?? '-',
            itemName: it?.name ?? '-',
            unit: it?.unit ?? '',
            projectId: l.projectId,
            locationName: nameOf(l.projectId),
            systemQty: Number(l.systemQty),
            countedQty: Number(l.countedQty),
            differenceQty: Number(l.differenceQty),
          };
        }),
    }))
    // A count of only other projects' stores is not shown to site staff
    .filter((c) => c.lines.length > 0);

  return {
    locations: [{ projectId: null, name: CENTRAL_STORE }, ...projectRows.map((p) => ({ projectId: p.id, name: `${p.code} ${p.name}` }))],
    items,
    movements,
    adjustRequests,
    counts,
    monthly: [...monthly.values()].map((m) => ({ ...m, receiveValue: round2(D(m.receiveValue)).toNumber(), issueValue: round2(D(m.issueValue)).toNumber() })),
    permissions: {
      manageItems: can(actor, 'stock.items'),
      approveAdjust: can(actor, 'stock.approveAdjust'),
      movableProjectIds: projectRows.filter((p) => can(actor, 'stock.move', { projectId: p.id })).map((p) => p.id),
      moveCentral: can(actor, 'stock.move', { projectId: null }),
    },
    poLineOptions: await listPoLinesForStock(db, actor),
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

const reorderSchema = z
  .array(z.object({ stockItemId: uuid, reorderPoint: z.number().finite().min(0, 'จุดสั่งซื้อต้องไม่ติดลบ').max(MAX_QTY) }))
  .min(1, 'ไม่มีรายการที่เปลี่ยน')
  .max(5000);

/** Sets the reorder point of many items at once; 0 switches the warning off for that item */
export async function setReorderPoints(db: Db, actor: SessionUser, input: { stockItemId: string; reorderPoint: number }[]): Promise<number> {
  assertCan(actor, 'stock.items');
  const rows = parse(reorderSchema, input);
  return db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.update(stockItems).set({ reorderPoint: D(r.reorderPoint).toFixed(2), updatedAt: new Date() }).where(eq(stockItems.id, r.stockItemId));
    }
    return rows.length;
  });
}
