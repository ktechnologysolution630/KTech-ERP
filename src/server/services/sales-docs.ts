import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { companyAccounts, customers, projects, salesDocLines, salesDocs, stockBalances, stockItems, stockMovements, users, vendors, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, round2, type Decimal } from '@/domain/money';
import { canConvert, computeSalesTotals, lineAmount, SALES_DOC_META, STOCK_CUT_KINDS, type SalesDocKind } from '@/domain/sales-doc';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { nextDocNumber } from './numbering';
import { SALES_STOCK_REF, syncJournal } from './gl';
import { applyStockMovement } from './stock';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง');
const money = z.number().finite().min(0, 'จำนวนเงินต้องไม่ติดลบ').max(1_000_000_000);
const text = (max: number) => z.string().trim().max(max).default('');

const lineSchema = z.object({
  isSection: z.boolean().default(false),
  name: z.string().trim().max(500).default(''),
  detail: text(2000),
  qty: z.number().finite().min(0).max(1_000_000_000).default(0),
  unit: text(30),
  unitPrice: money.default(0),
  discount: money.default(0),
  stockItemId: z.string().uuid().nullable().optional(),
});

const docSchema = z.object({
  kind: z.enum(['QT', 'SO', 'RC', 'TI', 'DN', 'STI', 'INC', 'EXP']),
  docDate: isoDate,
  dueDate: isoDate.nullable().optional(),
  reference: text(200),
  customerId: z.string().uuid().nullable().optional(),
  vendorId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  retentionRate: z.number().finite().min(0).max(100).default(0),
  customerName: text(300),
  customerTaxId: text(20),
  customerBranch: text(20),
  customerAddress: text(1000),
  contactName: text(200),
  phone: text(100),
  email: text(200),
  projectId: z.string().uuid().nullable().optional(),
  milestone: text(200),
  accountCategory: text(100),
  vatMode: z.enum(['EXCLUSIVE', 'INCLUSIVE', 'INCLUSIVE_HIDDEN', 'NONE', 'EXEMPT']).default('EXCLUSIVE'),
  discountType: z.enum(['PERCENT', 'AMOUNT']).default('AMOUNT'),
  discountValue: money.default(0),
  whtRate: z.number().finite().min(0).max(100).default(0),
  payMethod: z.enum(['TRANSFER', 'CASH', 'CHEQUE', 'PROMPTPAY', 'CARD']).nullable().optional(),
  bank: text(200),
  bankBranch: text(200),
  accountName: text(200),
  accountNo: text(50),
  notes: text(3000),
  lines: z.array(lineSchema).min(1, 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ').max(300),
});
export type SalesDocInput = z.input<typeof docSchema>;

type ParsedDoc = z.output<typeof docSchema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The checks every saved document passes, whether it is new or changed */
function parseDoc(input: SalesDocInput): ParsedDoc {
  const parsed = docSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_SALES_DOC', parsed.error.issues[0]!.message);
  const d = parsed.data;
  const items = d.lines.filter((l) => !l.isSection);
  if (items.length === 0 || items.some((l) => !l.name)) throw new DomainError('INVALID_SALES_DOC', 'กรุณากรอกชื่อรายการให้ครบ');
  // An abbreviated tax invoice may go without a named buyer; every other document needs one
  if (d.kind === 'EXP' && !d.vendorId && !d.customerName) throw new DomainError('INVALID_SALES_DOC', 'กรุณาเลือกผู้ขาย / ผู้รับเงิน');
  if (d.kind !== 'STI' && d.kind !== 'EXP' && !d.customerId && !d.customerName) throw new DomainError('INVALID_SALES_DOC', 'กรุณาเลือกลูกค้า');
  if (d.kind === 'DN' && !d.reference) throw new DomainError('INVALID_SALES_DOC', 'ใบเพิ่มหนี้ต้องอ้างอิงเลขที่ใบกำกับภาษีเดิม');
  if (items.some((l) => l.discount > l.qty * l.unitPrice + 0.005)) throw new DomainError('INVALID_SALES_DOC', 'ส่วนลดรายบรรทัดต้องไม่เกินจำนวนเงินของบรรทัดนั้น');
  if (d.kind === 'STI' && d.vatMode === 'EXCLUSIVE') throw new DomainError('INVALID_SALES_DOC', 'ใบกำกับภาษีอย่างย่อต้องเป็นราคารวม VAT');
  return d;
}

/** The document's stored columns and lines, with the party filled in from its record and the totals worked out */
async function docValues(tx: Tx, d: ParsedDoc) {
  const totals = computeSalesTotals({
    lines: d.lines,
    discountType: d.discountType,
    discountValue: d.discountValue,
    vatMode: d.vatMode,
    whtRate: d.whtRate,
    retentionRate: d.kind === 'EXP' ? d.retentionRate : 0,
  });
  const paid = d.kind === 'RC' || d.kind === 'INC' || d.kind === 'EXP';

  let customer = { name: d.customerName, taxId: d.customerTaxId, branch: d.customerBranch, address: d.customerAddress, contact: d.contactName, phone: d.phone, email: d.email };
  if (d.customerId) {
    const [c] = await tx.select().from(customers).where(eq(customers.id, d.customerId)).limit(1);
    if (!c) throw new DomainError('NOT_FOUND', 'ไม่พบลูกค้า', 404);
    // What was typed on the form wins; blanks come from the customer record
    customer = {
      name: d.customerName || c.name,
      taxId: d.customerTaxId || c.taxId || '',
      branch: d.customerBranch || c.branch,
      address: d.customerAddress || c.address,
      contact: d.contactName || c.contactName,
      phone: d.phone || c.phone,
      email: d.email || c.email,
    };
  }
  if (d.kind === 'EXP' && d.vendorId) {
    const [v] = await tx.select().from(vendors).where(eq(vendors.id, d.vendorId)).limit(1);
    if (!v) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ขาย', 404);
    customer = {
      name: d.customerName || v.name,
      taxId: d.customerTaxId || v.taxId || '',
      branch: d.customerBranch || v.branch,
      address: d.customerAddress || v.address,
      contact: d.contactName || v.contactPerson,
      phone: d.phone || v.phone,
      email: d.email || v.email,
    };
  }
  if (d.accountId) {
    const [a] = await tx.select({ id: companyAccounts.id }).from(companyAccounts).where(eq(companyAccounts.id, d.accountId)).limit(1);
    if (!a) throw new DomainError('NOT_FOUND', 'ไม่พบบัญชีธนาคาร', 404);
  }
  if (d.projectId) {
    const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, d.projectId)).limit(1);
    if (!p) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  }
  const itemIds = [...new Set(d.lines.filter((l) => !l.isSection && l.stockItemId).map((l) => l.stockItemId!))];
  if (itemIds.length > 0) {
    const found = await tx.select({ id: stockItems.id }).from(stockItems).where(inArray(stockItems.id, itemIds));
    if (found.length !== itemIds.length) throw new DomainError('NOT_FOUND', 'ไม่พบสินค้าในคลัง', 404);
  }

  const values = {
    docDate: d.docDate,
    dueDate: d.dueDate ?? null,
    reference: d.reference,
    customerId: d.kind === 'EXP' ? null : (d.customerId ?? null),
    vendorId: d.kind === 'EXP' ? (d.vendorId ?? null) : null,
    accountId: paid ? (d.accountId ?? null) : null,
    retentionRate: D(d.kind === 'EXP' ? d.retentionRate : 0).toFixed(2),
    retention: totals.retention.toFixed(2),
    customerName: customer.name,
    customerTaxId: customer.taxId,
    customerBranch: customer.branch,
    customerAddress: customer.address,
    contactName: customer.contact,
    phone: customer.phone,
    email: customer.email,
    projectId: d.projectId ?? null,
    milestone: d.milestone,
    accountCategory: d.accountCategory,
    vatMode: d.vatMode,
    discountType: d.discountType,
    discountValue: round2(D(d.discountValue)).toFixed(2),
    whtRate: D(d.whtRate).toFixed(2),
    payMethod: paid ? (d.payMethod ?? 'TRANSFER') : null,
    bank: paid ? d.bank : '',
    bankBranch: paid ? d.bankBranch : '',
    accountName: paid ? d.accountName : '',
    accountNo: paid ? d.accountNo : '',
    notes: d.notes,
    subtotal: totals.subtotal.toFixed(2),
    discount: totals.discount.toFixed(2),
    beforeVat: totals.beforeVat.toFixed(2),
    vat: totals.vat.toFixed(2),
    total: totals.total.toFixed(2),
    wht: totals.wht.toFixed(2),
    payable: totals.payable.toFixed(2),
  };
  const lines = (docId: string) =>
    d.lines.map((l, i) => ({
      docId,
      sort: i,
      isSection: l.isSection,
      name: l.name || (l.isSection ? 'พื้นที่' : ''),
      detail: l.detail,
      qty: l.isSection ? '0' : D(l.qty).toFixed(3),
      unit: l.isSection ? '' : l.unit,
      unitPrice: l.isSection ? '0' : round2(D(l.unitPrice)).toFixed(2),
      discount: l.isSection ? '0' : round2(D(l.discount)).toFixed(2),
      amount: lineAmount(l).toFixed(2),
      stockItemId: l.isSection ? null : (l.stockItemId ?? null),
    }));
  return { values, lines };
}

/**
 * Kinds changed in place once issued: a quotation, a sales order and the receipt and payment vouchers are not tax
 * documents. A receipt, tax invoice, debit note or abbreviated tax invoice is never written over; it is
 * cancelled and a new one issued in its place (createSalesDoc with replacesId).
 */
export const SALES_EDIT_IN_PLACE: readonly SalesDocKind[] = ['QT', 'SO', 'INC', 'EXP'];

/**
 * ตัดสต็อก: a tax invoice or abbreviated tax invoice takes the stock items on its lines out of the
 * project's store (the central store when no project), at the moving average cost. Short stock refuses
 * the whole document.
 */
async function cutStock(tx: Tx, doc: { id: string; kind: SalesDocKind; number: string; projectId: string | null }, actorId: string) {
  if (!STOCK_CUT_KINDS.includes(doc.kind)) return;
  const lines = await tx.select().from(salesDocLines).where(eq(salesDocLines.docId, doc.id)).orderBy(asc(salesDocLines.sort));
  for (const l of lines) {
    if (l.isSection || !l.stockItemId || D(l.qty).lte(0)) continue;
    await applyStockMovement(tx as unknown as Db, {
      stockItemId: l.stockItemId,
      projectId: doc.projectId,
      type: 'ISSUE',
      quantity: D(l.qty).toNumber(),
      referenceType: SALES_STOCK_REF,
      referenceId: doc.id,
      referenceNumber: doc.number,
      performedBy: actorId,
      notes: `ขาย ${l.name}`,
    });
  }
}

/** Puts back what a cancelled sale cut and has not been put back yet, at the cost it went out at */
async function restoreStock(tx: Tx, doc: { id: string; number: string }, actorId: string) {
  const moves = await tx
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.referenceType, SALES_STOCK_REF), eq(stockMovements.referenceId, doc.id)));
  const open = new Map<string, { stockItemId: string; projectId: string | null; qty: Decimal; value: Decimal }>();
  for (const m of moves) {
    const key = `${m.stockItemId}|${m.projectId ?? ''}`;
    const o = open.get(key) ?? { stockItemId: m.stockItemId, projectId: m.projectId, qty: D(0), value: D(0) };
    const sign = m.type === 'ISSUE' ? 1 : -1;
    o.qty = o.qty.plus(D(m.quantity).times(sign));
    o.value = o.value.plus(D(m.totalValue).times(sign));
    open.set(key, o);
  }
  for (const o of open.values()) {
    if (o.qty.lte(0)) continue;
    await applyStockMovement(tx as unknown as Db, {
      stockItemId: o.stockItemId,
      projectId: o.projectId,
      type: 'RETURN',
      quantity: o.qty.toNumber(),
      unitCost: round2(o.value.div(o.qty)).toNumber(),
      referenceType: SALES_STOCK_REF,
      referenceId: doc.id,
      referenceNumber: doc.number,
      performedBy: actorId,
      notes: `ยกเลิก ${doc.number} คืนสต็อก`,
    });
  }
}

/**
 * Issues a sales document; the number runs per kind and month (e.g. QT-6911-0001). With replacesId it
 * is issued in place of an earlier document of the same kind, which is cancelled in the same step, so
 * the old one is only cancelled once the new one exists.
 */
export async function createSalesDoc(
  db: Db,
  actor: SessionUser,
  input: SalesDocInput,
  opts: { replacesId?: string; sourceId?: string } = {},
): Promise<{ id: string; number: string }> {
  assertCan(actor, 'ar.manage');
  const d = parseDoc(input);
  if (opts.replacesId && !z.string().uuid().safeParse(opts.replacesId).success) throw new DomainError('NOT_FOUND', 'ไม่พบเอกสารเดิม', 404);
  if (opts.sourceId && !z.string().uuid().safeParse(opts.sourceId).success) throw new DomainError('NOT_FOUND', 'ไม่พบเอกสารต้นทาง', 404);

  return db.transaction(async (tx) => {
    const replaced = opts.replacesId ? (await tx.select().from(salesDocs).where(eq(salesDocs.id, opts.replacesId)).for('update'))[0] : undefined;
    if (opts.replacesId) {
      if (!replaced) throw new DomainError('NOT_FOUND', 'ไม่พบเอกสารเดิม', 404);
      if (replaced.kind !== d.kind) throw new DomainError('INVALID_SALES_DOC', 'เอกสารใหม่ต้องเป็นประเภทเดียวกับใบเดิม');
      if (replaced.status !== 'ISSUED') throw new DomainError('INVALID_STATUS', `${replaced.number} ถูกยกเลิกไปแล้ว`, 409);
    }

    let sourceId = replaced?.sourceId ?? null;
    if (opts.sourceId) {
      const [src] = await tx.select().from(salesDocs).where(eq(salesDocs.id, opts.sourceId)).limit(1);
      if (!src) throw new DomainError('NOT_FOUND', 'ไม่พบเอกสารต้นทาง', 404);
      if (src.status !== 'ISSUED') throw new DomainError('INVALID_STATUS', `${src.number} ถูกยกเลิกไปแล้ว`, 409);
      if (!canConvert(src.kind, d.kind)) throw new DomainError('INVALID_SALES_DOC', `${SALES_DOC_META[src.kind].th}เปิดเป็น${SALES_DOC_META[d.kind].th}ไม่ได้`);
      sourceId = src.id;
    }

    const { values, lines } = await docValues(tx, d);
    const number = await nextDocNumber(tx, SALES_DOC_META[d.kind].prefix, new Date(`${d.docDate}T12:00:00+07:00`));
    const [doc] = await tx
      .insert(salesDocs)
      .values({ ...values, kind: d.kind, number, sourceId, createdBy: actor.id })
      .returning();
    await tx.insert(salesDocLines).values(lines(doc!.id));
    await logActivity(tx, {
      entityType: 'SALES_DOC',
      entityId: doc!.id,
      action: 'CREATE',
      userId: actor.id,
      note: replaced ? `${SALES_DOC_META[d.kind].th} ${number} ออกแทน ${replaced.number}` : `${SALES_DOC_META[d.kind].th} ${number}`,
    });

    if (replaced) {
      const why = `แก้ไขโดยออกใบใหม่ ${number}`;
      await tx.update(salesDocs).set({ status: 'CANCELLED', cancelReason: why, updatedAt: new Date() }).where(eq(salesDocs.id, replaced.id));
      await logActivity(tx, { entityType: 'SALES_DOC', entityId: replaced.id, action: 'CANCEL', userId: actor.id, note: why });
      // The old one's goods go back before the new one takes them
      await restoreStock(tx, replaced, actor.id);
      await syncJournal(tx, 'SALES_DOC', replaced.id, actor.id);
    }
    await cutStock(tx, { id: doc!.id, kind: d.kind, number, projectId: doc!.projectId }, actor.id);
    await syncJournal(tx, 'SALES_DOC', doc!.id, actor.id);
    return { id: doc!.id, number };
  });
}

/** Changes an issued quotation or voucher in place; it keeps its number */
export async function updateSalesDoc(db: Db, actor: SessionUser, id: string, input: SalesDocInput): Promise<{ id: string; number: string }> {
  assertCan(actor, 'ar.manage');
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', 'ไม่พบเอกสาร', 404);
  const d = parseDoc(input);

  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(salesDocs).where(eq(salesDocs.id, id)).for('update');
    if (!doc) throw new DomainError('NOT_FOUND', 'ไม่พบเอกสาร', 404);
    if (doc.kind !== d.kind) throw new DomainError('INVALID_SALES_DOC', 'เปลี่ยนประเภทเอกสารไม่ได้');
    if (doc.status !== 'ISSUED') throw new DomainError('INVALID_STATUS', 'เอกสารที่ยกเลิกแล้วแก้ไขไม่ได้', 409);
    if (!SALES_EDIT_IN_PLACE.includes(doc.kind)) {
      throw new DomainError('INVALID_STATUS', `${SALES_DOC_META[doc.kind].th}ที่ออกแล้วแก้ทับไม่ได้ ให้ออกใบใหม่แทนใบเดิม`, 409);
    }

    const { values, lines } = await docValues(tx, d);
    await tx.update(salesDocs).set({ ...values, updatedAt: new Date() }).where(eq(salesDocs.id, id));
    await tx.delete(salesDocLines).where(eq(salesDocLines.docId, id));
    await tx.insert(salesDocLines).values(lines(id));
    await logActivity(tx, {
      entityType: 'SALES_DOC',
      entityId: id,
      action: 'UPDATE',
      userId: actor.id,
      note: `${SALES_DOC_META[doc.kind].th} ${doc.number}: ${doc.payable} → ${values.payable} บาท`,
    });
    await syncJournal(tx, 'SALES_DOC', id, actor.id);
    return { id, number: doc.number };
  });
}

/** Cancels an issued document; it keeps its number and stays listed as ยกเลิก */
export async function cancelSalesDoc(db: Db, actor: SessionUser, id: string, reason: string): Promise<void> {
  assertCan(actor, 'ar.manage');
  const why = reason.trim();
  if (!why) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ยกเลิก');
  await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(salesDocs).where(eq(salesDocs.id, id)).for('update');
    if (!doc) throw new DomainError('NOT_FOUND', 'ไม่พบเอกสาร', 404);
    if (doc.status === 'CANCELLED') throw new DomainError('INVALID_STATUS', 'เอกสารนี้ถูกยกเลิกไปแล้ว', 409);
    await tx.update(salesDocs).set({ status: 'CANCELLED', cancelReason: why, updatedAt: new Date() }).where(eq(salesDocs.id, id));
    await logActivity(tx, { entityType: 'SALES_DOC', entityId: id, action: 'CANCEL', userId: actor.id, note: why });
    await restoreStock(tx, doc, actor.id);
    await syncJournal(tx, 'SALES_DOC', id, actor.id);
  });
}

export async function listSalesDocs(db: Db, actor: SessionUser, kind: SalesDocKind, opts: { includeCancelled?: boolean } = {}) {
  assertCan(actor, 'ar.manage');
  const rows = await db
    .select({ doc: salesDocs, projectCode: projects.code, projectName: projects.name })
    .from(salesDocs)
    .leftJoin(projects, eq(projects.id, salesDocs.projectId))
    .where(opts.includeCancelled ? eq(salesDocs.kind, kind) : and(eq(salesDocs.kind, kind), eq(salesDocs.status, 'ISSUED')))
    .orderBy(desc(salesDocs.docDate), desc(salesDocs.createdAt));
  return rows.map((r) => ({ ...r.doc, projectLabel: r.projectCode ? `${r.projectCode} ${r.projectName}` : '' }));
}

export async function getSalesDoc(db: Db, actor: SessionUser, id: string) {
  assertCan(actor, 'ar.manage');
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', 'ไม่พบเอกสาร', 404);
  const [row] = await db
    .select({ doc: salesDocs, projectCode: projects.code, projectName: projects.name, creatorName: users.name })
    .from(salesDocs)
    .leftJoin(projects, eq(projects.id, salesDocs.projectId))
    .innerJoin(users, eq(users.id, salesDocs.createdBy))
    .where(eq(salesDocs.id, id))
    .limit(1);
  if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบเอกสาร', 404);
  const [lines, source, children] = await Promise.all([
    db
      .select({ line: salesDocLines, itemCode: stockItems.sku })
      .from(salesDocLines)
      .leftJoin(stockItems, eq(stockItems.id, salesDocLines.stockItemId))
      .where(eq(salesDocLines.docId, id))
      .orderBy(asc(salesDocLines.sort)),
    row.doc.sourceId
      ? db.select({ id: salesDocs.id, kind: salesDocs.kind, number: salesDocs.number }).from(salesDocs).where(eq(salesDocs.id, row.doc.sourceId)).limit(1)
      : Promise.resolve([]),
    db
      .select({ id: salesDocs.id, kind: salesDocs.kind, number: salesDocs.number, status: salesDocs.status })
      .from(salesDocs)
      .where(eq(salesDocs.sourceId, id))
      .orderBy(asc(salesDocs.createdAt)),
  ]);
  return {
    ...row.doc,
    projectLabel: row.projectCode ? `${row.projectCode} ${row.projectName}` : '',
    creatorName: row.creatorName,
    lines: lines.map((l) => ({ ...l.line, itemCode: l.itemCode })),
    /** The document this one was converted from, and the ones converted from it */
    source: source[0] ?? null,
    children,
  };
}

/** Customers for the picker on sales documents */
export async function listCustomersForSales(db: Db, actor: SessionUser) {
  assertCan(actor, 'ar.manage');
  return db.select().from(customers).where(inArray(customers.active, [true])).orderBy(asc(customers.name));
}

const accountSchema = z.object({
  id: z.string().uuid().optional(),
  bank: z.string().trim().min(1, 'กรุณาเลือกธนาคาร').max(200),
  accountName: z.string().trim().min(1, 'กรุณากรอกชื่อบัญชี').max(200),
  accountNo: z.string().trim().min(1, 'กรุณากรอกเลขที่บัญชี').max(50),
  branch: text(200),
  type: z.enum(['SAVINGS', 'CURRENT', 'FIXED', 'CASH', 'OTHER']).default('SAVINGS'),
  currency: z.string().trim().max(10).default('THB'),
  openingBalance: z.number().finite().min(-1_000_000_000).max(1_000_000_000).default(0),
  openingDate: isoDate.nullable().optional(),
  ownerName: text(300),
  isDefaultReceive: z.boolean().default(false),
  isDefaultPay: z.boolean().default(false),
  active: z.boolean().default(true),
  notes: text(1000),
});
export type CompanyAccountInput = z.input<typeof accountSchema>;

/** Adds or edits a company bank / cash account; only one account is the default for receiving and one for paying */
export async function saveCompanyAccount(db: Db, actor: SessionUser, input: CompanyAccountInput): Promise<string> {
  assertCan(actor, 'ar.manage');
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_ACCOUNT', parsed.error.issues[0]!.message);
  const { id, openingBalance, ...a } = parsed.data;
  return db.transaction(async (tx) => {
    if (a.isDefaultReceive) await tx.update(companyAccounts).set({ isDefaultReceive: false });
    if (a.isDefaultPay) await tx.update(companyAccounts).set({ isDefaultPay: false });
    const values = { ...a, openingBalance: round2(D(openingBalance)).toFixed(2), openingDate: a.openingDate ?? null, updatedAt: new Date() };
    if (id) {
      const [row] = await tx.update(companyAccounts).set(values).where(eq(companyAccounts.id, id)).returning();
      if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบบัญชี', 404);
      return row.id;
    }
    const [row] = await tx.insert(companyAccounts).values(values).returning();
    return row!.id;
  });
}

export interface AccountSummary {
  id: string;
  bank: string;
  accountName: string;
  accountNo: string;
  branch: string;
  type: string;
  currency: string;
  openingBalance: number;
  openingDate: string | null;
  ownerName: string;
  isDefaultReceive: boolean;
  isDefaultPay: boolean;
  active: boolean;
  notes: string;
  moneyIn: number;
  moneyOut: number;
  balance: number;
  recent: { id: string; kind: string; number: string; docDate: string; party: string; amount: number }[];
}

/**
 * Company accounts with their balance: what they started with, plus receipts and income vouchers
 * paid into them, less payment vouchers paid out of them. Cancelled documents do not count.
 */
export async function listCompanyAccounts(db: Db, actor: SessionUser): Promise<AccountSummary[]> {
  assertCan(actor, 'ar.manage');
  const [accounts, docs] = await Promise.all([
    db.select().from(companyAccounts).orderBy(desc(companyAccounts.active), asc(companyAccounts.bank)),
    db
      .select({ id: salesDocs.id, kind: salesDocs.kind, number: salesDocs.number, docDate: salesDocs.docDate, party: salesDocs.customerName, payable: salesDocs.payable, accountId: salesDocs.accountId })
      .from(salesDocs)
      .where(and(eq(salesDocs.status, 'ISSUED'), inArray(salesDocs.kind, ['RC', 'INC', 'EXP'])))
      .orderBy(desc(salesDocs.docDate), desc(salesDocs.createdAt)),
  ]);
  return accounts.map((a) => {
    const mine = docs.filter((d) => d.accountId === a.id);
    const moneyIn = mine.filter((d) => d.kind !== 'EXP').reduce((s, d) => s + Number(d.payable), 0);
    const moneyOut = mine.filter((d) => d.kind === 'EXP').reduce((s, d) => s + Number(d.payable), 0);
    return {
      id: a.id,
      bank: a.bank,
      accountName: a.accountName,
      accountNo: a.accountNo,
      branch: a.branch,
      type: a.type,
      currency: a.currency,
      openingBalance: Number(a.openingBalance),
      openingDate: a.openingDate,
      ownerName: a.ownerName,
      isDefaultReceive: a.isDefaultReceive,
      isDefaultPay: a.isDefaultPay,
      active: a.active,
      notes: a.notes,
      moneyIn: round2(D(moneyIn)).toNumber(),
      moneyOut: round2(D(moneyOut)).toNumber(),
      balance: round2(D(a.openingBalance).plus(moneyIn).minus(moneyOut)).toNumber(),
      recent: mine.slice(0, 10).map((d) => ({ id: d.id, kind: d.kind, number: d.number, docDate: d.docDate, party: d.party, amount: d.kind === 'EXP' ? -Number(d.payable) : Number(d.payable) })),
    };
  });
}

/** Stock items for the item picker on sales lines, with what is on hand in every store */
export async function listStockItemsForSales(db: Db, actor: SessionUser) {
  assertCan(actor, 'ar.manage');
  const rows = await db
    .select({
      id: stockItems.id,
      sku: stockItems.sku,
      name: stockItems.name,
      unit: stockItems.unit,
      onHand: sql<string>`coalesce(sum(${stockBalances.quantity}), 0)`,
    })
    .from(stockItems)
    .leftJoin(stockBalances, eq(stockBalances.stockItemId, stockItems.id))
    .groupBy(stockItems.id)
    .orderBy(asc(stockItems.sku));
  return rows.map((r) => ({ ...r, onHand: Number(r.onHand) }));
}

/** Vendors for the payee picker on payment vouchers */
export async function listVendorsForSales(db: Db, actor: SessionUser) {
  assertCan(actor, 'ar.manage');
  return db.select().from(vendors).where(eq(vendors.active, true)).orderBy(asc(vendors.name));
}
