import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { companyAccounts, customers, projects, salesDocLines, salesDocs, users, vendors, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, round2 } from '@/domain/money';
import { computeSalesTotals, SALES_DOC_META, type SalesDocKind } from '@/domain/sales-doc';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { nextDocNumber } from './numbering';

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
});

const docSchema = z.object({
  kind: z.enum(['QT', 'RC', 'TI', 'DN', 'STI', 'INC', 'EXP']),
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

/** Issues a sales document; the number runs per kind and month (e.g. QT-6911-0001) */
export async function createSalesDoc(db: Db, actor: SessionUser, input: SalesDocInput): Promise<{ id: string; number: string }> {
  assertCan(actor, 'ar.manage');
  const parsed = docSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_SALES_DOC', parsed.error.issues[0]!.message);
  const d = parsed.data;
  const items = d.lines.filter((l) => !l.isSection);
  if (items.length === 0 || items.some((l) => !l.name)) throw new DomainError('INVALID_SALES_DOC', 'กรุณากรอกชื่อรายการให้ครบ');
  // An abbreviated tax invoice may go without a named buyer; every other document needs one
  if (d.kind === 'EXP' && !d.vendorId && !d.customerName) throw new DomainError('INVALID_SALES_DOC', 'กรุณาเลือกผู้ขาย / ผู้รับเงิน');
  if (d.kind !== 'STI' && d.kind !== 'EXP' && !d.customerId && !d.customerName) throw new DomainError('INVALID_SALES_DOC', 'กรุณาเลือกลูกค้า');
  if (d.kind === 'DN' && !d.reference) throw new DomainError('INVALID_SALES_DOC', 'ใบเพิ่มหนี้ต้องอ้างอิงเลขที่ใบกำกับภาษีเดิม');
  if (d.kind === 'STI' && d.vatMode === 'EXCLUSIVE') throw new DomainError('INVALID_SALES_DOC', 'ใบกำกับภาษีอย่างย่อต้องเป็นราคารวม VAT');

  const totals = computeSalesTotals({
    lines: d.lines,
    discountType: d.discountType,
    discountValue: d.discountValue,
    vatMode: d.vatMode,
    whtRate: d.whtRate,
    retentionRate: d.kind === 'EXP' ? d.retentionRate : 0,
  });
  const paid = d.kind === 'RC' || d.kind === 'INC' || d.kind === 'EXP';

  return db.transaction(async (tx) => {
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
    const number = await nextDocNumber(tx, SALES_DOC_META[d.kind].prefix, new Date(`${d.docDate}T12:00:00+07:00`));
    const [doc] = await tx
      .insert(salesDocs)
      .values({
        kind: d.kind,
        number,
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
        createdBy: actor.id,
      })
      .returning();
    await tx.insert(salesDocLines).values(
      d.lines.map((l, i) => ({
        docId: doc!.id,
        sort: i,
        isSection: l.isSection,
        name: l.name || (l.isSection ? 'พื้นที่' : ''),
        detail: l.detail,
        qty: l.isSection ? '0' : D(l.qty).toFixed(3),
        unit: l.isSection ? '' : l.unit,
        unitPrice: l.isSection ? '0' : round2(D(l.unitPrice)).toFixed(2),
        amount: l.isSection ? '0' : round2(D(l.qty).times(D(l.unitPrice))).toFixed(2),
      })),
    );
    await logActivity(tx, { entityType: 'SALES_DOC', entityId: doc!.id, action: 'CREATE', userId: actor.id, note: `${SALES_DOC_META[d.kind].th} ${number}` });
    return { id: doc!.id, number };
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
  const lines = await db.select().from(salesDocLines).where(eq(salesDocLines.docId, id)).orderBy(asc(salesDocLines.sort));
  return { ...row.doc, projectLabel: row.projectCode ? `${row.projectCode} ${row.projectName}` : '', creatorName: row.creatorName, lines };
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

/** Vendors for the payee picker on payment vouchers */
export async function listVendorsForSales(db: Db, actor: SessionUser) {
  assertCan(actor, 'ar.manage');
  return db.select().from(vendors).where(eq(vendors.active, true)).orderBy(asc(vendors.name));
}
