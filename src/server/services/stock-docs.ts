import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { boqLines, boqs, projects, stockDocs, stockItems, vendors, type SessionUser, type StockDocType } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, round2, sum, type Decimal } from '@/domain/money';
import { DEFAULT_STOCK_CATEGORY, STOCK_CATEGORIES } from '@/domain/stock';
import { assertCan, can, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { nextDocNumber } from './numbering';
import { applyStockMovement } from './stock';

const MAX_QTY = 1_000_000_000;
const MAX_MONEY = 1_000_000_000;
const uuid = z.string().uuid('ข้อมูลไม่ถูกต้อง');
const money = z.number().finite().min(0, 'จำนวนเงินต้องไม่ติดลบ').max(MAX_MONEY);
const text = (max: number) => z.string().trim().max(max).default('');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');

const lineSchema = z
  .object({
    /** An item already in stock, or newItem for a receipt of something not yet registered */
    stockItemId: uuid.optional(),
    newItem: z
      .object({
        sku: z.string().trim().min(1, 'กรุณากรอกรหัส SKU').max(60),
        name: z.string().trim().min(1, 'กรุณากรอกรายการวัสดุ').max(300),
        unit: z.string().trim().min(1, 'กรุณากรอกหน่วย').max(30),
        category: z.string().trim().max(60).optional(),
      })
      .optional(),
    quantity: z.number().finite().positive('จำนวนต้องมากกว่า 0').max(MAX_QTY),
    unitPrice: money.optional(),
    discount: money.optional(),
    extraCost: money.optional(),
    note: text(500),
  })
  .refine((l) => Boolean(l.stockItemId) !== Boolean(l.newItem), { message: 'กรุณาเลือกวัสดุในแต่ละรายการ' });

const docSchema = z.object({
  type: z.enum(['RECEIVE', 'ISSUE', 'TRANSFER', 'BORROW']),
  docDate: isoDate,
  docTime: z.string().trim().max(10).default(''),
  /** Receipt: store received into; others: source. null = central store */
  projectId: uuid.nullable(),
  targetProjectId: uuid.nullable().optional(),
  warehouseName: text(100),
  vendorId: uuid.nullable().optional(),
  supplierName: text(300),
  poNumber: text(100),
  deliveryNoteNo: text(100),
  taxInvoiceNo: text(100),
  taxInvoiceDate: isoDate.nullable().optional(),
  receiverName: text(200),
  inspectorName: text(200),
  taxType: z.enum(['VAT7', 'NONE', 'INCLUSIVE', 'EXEMPT']).default('VAT7'),
  accountingMethod: z.enum(['STOCK', 'PROJECT_COST', 'EXPENSE']).default('STOCK'),
  accountingStatus: z.enum(['PENDING', 'AWAITING_TAX_INVOICE', 'POSTED']).default('PENDING'),
  debitAccount: text(60),
  creditAccount: text(60),
  payMethod: z.enum(['CASH', 'TRANSFER', 'CREDIT']).default('CREDIT'),
  creditDays: z.number().int().min(0).max(3650).nullable().optional(),
  issueKind: z.enum(['MATERIAL_ISSUE', 'RETURN_IN', 'RETURN_SUPPLIER', 'DAMAGE_LOSS', 'OTHER']).optional(),
  useProjectId: uuid.nullable().optional(),
  boqCategoryId: uuid.nullable().optional(),
  boqLineId: uuid.nullable().optional(),
  zone: text(200),
  usageNote: text(1000),
  notes: text(2000),
  lines: z.array(lineSchema).min(1, 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ').max(200, 'รายการต้องไม่เกิน 200 รายการ'),
});
export type StockDocInput = z.input<typeof docSchema>;

const PREFIX: Record<StockDocType, 'GR' | 'ISS' | 'TRF' | 'BRW'> = { RECEIVE: 'GR', ISSUE: 'ISS', TRANSFER: 'TRF', BORROW: 'BRW' };
const VAT_RATE = D('0.07');

/** Value of one receipt line: before VAT, VAT, extra cost and the real cost per unit */
export function receiptLineValue(line: { quantity: number; unitPrice?: number; discount?: number; extraCost?: number }, taxType: 'VAT7' | 'NONE' | 'INCLUSIVE' | 'EXEMPT') {
  const qty = D(line.quantity);
  const gross = round2(qty.times(D(line.unitPrice ?? 0)).minus(D(line.discount ?? 0)));
  if (gross.isNegative()) throw new DomainError('INVALID_STOCK', 'ส่วนลดต้องไม่เกินมูลค่าของรายการ');
  let beforeVat: Decimal;
  let vat: Decimal;
  if (taxType === 'VAT7') {
    beforeVat = gross;
    vat = round2(gross.times(VAT_RATE));
  } else if (taxType === 'INCLUSIVE') {
    vat = round2(gross.times(VAT_RATE).div(D(1).plus(VAT_RATE)));
    beforeVat = round2(gross.minus(vat));
  } else {
    beforeVat = gross;
    vat = D(0);
  }
  const extra = round2(D(line.extraCost ?? 0));
  // VAT is claimed back, so the stock is carried at the cost before VAT plus what it took to get it here
  const unitCost = qty.gt(0) ? beforeVat.plus(extra).div(qty) : D(0);
  return { beforeVat, vat, extra, net: round2(beforeVat.plus(vat).plus(extra)), unitCost: round2(unitCost) };
}

/**
 * Records a stock document and its lines in one transaction. A receipt adds every line to the
 * store (registering new items on the way); an issue takes them out (a return puts them back);
 * a transfer or borrow moves them between stores. Nothing is saved if any line fails.
 */
export async function createStockDoc(db: Db, actor: SessionUser, input: StockDocInput): Promise<{ id: string; number: string }> {
  const parsed = docSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_STOCK', parsed.error.issues[0]!.message);
  const d = parsed.data;
  assertCan(actor, 'stock.move', { projectId: d.projectId });
  const moves = d.type === 'TRANSFER' || d.type === 'BORROW';
  if (moves) {
    if (d.targetProjectId === undefined) throw new DomainError('INVALID_STOCK', 'กรุณาเลือกปลายทาง');
    if (d.targetProjectId === d.projectId) throw new DomainError('INVALID_STOCK', 'ต้นทางและปลายทางต้องไม่ใช่ที่เดียวกัน');
  }
  if (d.type === 'RECEIVE' && !d.vendorId && !d.supplierName) throw new DomainError('INVALID_STOCK', 'กรุณาระบุ Supplier');
  if (d.type === 'ISSUE' && !d.issueKind) throw new DomainError('INVALID_STOCK', 'กรุณาเลือกประเภทการจ่าย');
  if (d.lines.some((l) => l.newItem) && !can(actor, 'stock.items')) {
    throw new DomainError('FORBIDDEN', 'เพิ่มวัสดุใหม่ได้เฉพาะฝ่ายจัดซื้อหรือผู้บริหาร กรุณาเลือกวัสดุที่มีในสต็อก', 403);
  }
  if (d.type !== 'RECEIVE' && d.lines.some((l) => l.newItem)) {
    throw new DomainError('INVALID_STOCK', 'การจ่ายออก โอนย้าย และยืม ต้องเลือกวัสดุที่มีในสต็อกแล้ว');
  }

  return db.transaction(async (tx) => {
    const projectIds = [d.projectId, d.targetProjectId, d.useProjectId].filter((x): x is string => !!x);
    if (projectIds.length > 0) {
      const found = await tx.select({ id: projects.id }).from(projects).where(inArray(projects.id, projectIds));
      if (new Set(found.map((f) => f.id)).size !== new Set(projectIds).size) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
    }
    let supplierName = d.supplierName;
    if (d.vendorId) {
      const [v] = await tx.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, d.vendorId)).limit(1);
      if (!v) throw new DomainError('NOT_FOUND', 'ไม่พบ Supplier', 404);
      supplierName = supplierName || v.name;
    }

    const values = d.type === 'RECEIVE' ? d.lines.map((l) => receiptLineValue(l, d.taxType)) : [];
    const number = await nextDocNumber(tx, PREFIX[d.type]);
    const [doc] = await tx
      .insert(stockDocs)
      .values({
        number,
        type: d.type,
        docDate: d.docDate,
        docTime: d.docTime,
        projectId: d.projectId,
        targetProjectId: d.targetProjectId ?? null,
        warehouseName: d.warehouseName,
        vendorId: d.vendorId ?? null,
        supplierName,
        poNumber: d.poNumber,
        deliveryNoteNo: d.deliveryNoteNo,
        taxInvoiceNo: d.taxInvoiceNo,
        taxInvoiceDate: d.taxInvoiceDate ?? null,
        receiverName: d.receiverName,
        inspectorName: d.inspectorName,
        taxType: d.taxType,
        accountingMethod: d.accountingMethod,
        accountingStatus: d.accountingStatus,
        debitAccount: d.debitAccount || 'Inventory',
        creditAccount: d.creditAccount || 'Trade Payables',
        payMethod: d.payMethod,
        creditDays: d.payMethod === 'CREDIT' ? (d.creditDays ?? null) : null,
        issueKind: d.type === 'ISSUE' ? d.issueKind : null,
        useProjectId: d.useProjectId ?? null,
        boqCategoryId: d.boqCategoryId ?? null,
        boqLineId: d.boqLineId ?? null,
        zone: d.zone,
        usageNote: d.usageNote,
        beforeVat: sum(values.map((v) => v.beforeVat)).toFixed(2),
        vat: sum(values.map((v) => v.vat)).toFixed(2),
        net: sum(values.map((v) => v.net)).toFixed(2),
        notes: d.notes,
        performedBy: actor.id,
      })
      .returning();

    for (let i = 0; i < d.lines.length; i++) {
      const line = d.lines[i]!;
      let stockItemId = line.stockItemId;
      if (line.newItem) {
        const sku = line.newItem.sku;
        const [taken] = await tx.select({ id: stockItems.id }).from(stockItems).where(eq(stockItems.sku, sku)).limit(1);
        if (taken) throw new DomainError('INVALID_STOCK', `รายการที่ ${i + 1}: รหัส SKU ${sku} มีอยู่แล้ว กรุณาเลือกจากรายการแทน`);
        const category = line.newItem.category && (STOCK_CATEGORIES as readonly string[]).includes(line.newItem.category) ? line.newItem.category : DEFAULT_STOCK_CATEGORY;
        const [created] = await tx
          .insert(stockItems)
          .values({ sku, name: line.newItem.name, unit: line.newItem.unit, category, unitCost: values[i]?.unitCost.toFixed(2) ?? '0' })
          .returning();
        stockItemId = created!.id;
      }
      const common = { stockItemId: stockItemId!, quantity: line.quantity, performedBy: actor.id, docId: doc!.id, referenceType: 'STOCK_DOC', referenceId: doc!.id, referenceNumber: doc!.number, notes: line.note };
      try {
        if (d.type === 'RECEIVE') {
          const v = values[i]!;
          await applyStockMovement(tx, {
            ...common,
            projectId: d.projectId,
            type: 'RECEIVE',
            unitCost: v.unitCost.toNumber(),
            warehouseName: d.warehouseName || undefined,
            listPrice: line.unitPrice ?? 0,
            discount: line.discount ?? 0,
            vat: v.vat.toNumber(),
            extraCost: v.extra.toNumber(),
          });
        } else if (d.type === 'ISSUE') {
          await applyStockMovement(tx, {
            ...common,
            projectId: d.projectId,
            // A return puts the material back into this store; every other kind takes it out
            type: d.issueKind === 'RETURN_IN' ? 'RETURN' : 'ISSUE',
            locationUsed: d.zone || undefined,
          });
        } else {
          await applyStockMovement(tx, { ...common, projectId: d.projectId, type: 'TRANSFER', targetProjectId: d.targetProjectId ?? null, targetWarehouseName: d.warehouseName || undefined });
        }
      } catch (err) {
        // Say which line could not be moved
        if (err instanceof DomainError) throw new DomainError(err.code, `รายการที่ ${i + 1}: ${err.message}`, err.status);
        throw err;
      }
    }

    await logActivity(tx, { entityType: 'STOCK_DOC', entityId: doc!.id, action: 'CREATE', userId: actor.id, note: `${doc!.number} ${d.lines.length} รายการ` });
    return { id: doc!.id, number: doc!.number };
  });
}

export interface BoqPickCategory {
  id: string;
  projectId: string;
  label: string;
  lines: { id: string; label: string }[];
}

/** Main-BOQ categories of each visible project with the lines under them, for tagging an issue */
export async function listBoqTreeForStock(db: Db, actor: SessionUser): Promise<BoqPickCategory[]> {
  const rows = await db
    .select({ id: boqLines.id, no: boqLines.no, description: boqLines.description, isCategory: boqLines.isCategory, projectId: boqs.projectId })
    .from(boqLines)
    .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
    .where(and(eq(boqs.kind, 'MAIN')))
    .orderBy(boqs.projectId, asc(boqLines.sort));
  const visible = isSiteScopedOnly(actor) ? rows.filter((r) => actor.projectIds.includes(r.projectId)) : rows;
  const out: BoqPickCategory[] = [];
  let current: BoqPickCategory | null = null;
  for (const r of visible) {
    const label = [r.no, r.description].filter(Boolean).join(' ');
    if (r.isCategory) {
      current = { id: r.id, projectId: r.projectId, label, lines: [] };
      out.push(current);
    } else if (current && current.projectId === r.projectId) {
      current.lines.push({ id: r.id, label });
    }
  }
  return out;
}
