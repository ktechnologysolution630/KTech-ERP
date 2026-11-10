import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { customers, projects, salesDocLines, salesDocs, users, type SessionUser } from '@/db/schema';
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
  kind: z.enum(['QT', 'RC', 'TI', 'DN', 'STI']),
  docDate: isoDate,
  dueDate: isoDate.nullable().optional(),
  reference: text(200),
  customerId: z.string().uuid().nullable().optional(),
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
  payMethod: z.enum(['TRANSFER', 'CASH', 'CHEQUE']).nullable().optional(),
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
  if (d.kind !== 'STI' && !d.customerId && !d.customerName) throw new DomainError('INVALID_SALES_DOC', 'กรุณาเลือกลูกค้า');
  if (d.kind === 'DN' && !d.reference) throw new DomainError('INVALID_SALES_DOC', 'ใบเพิ่มหนี้ต้องอ้างอิงเลขที่ใบกำกับภาษีเดิม');
  if (d.kind === 'STI' && d.vatMode === 'EXCLUSIVE') throw new DomainError('INVALID_SALES_DOC', 'ใบกำกับภาษีอย่างย่อต้องเป็นราคารวม VAT');

  const totals = computeSalesTotals({ lines: d.lines, discountType: d.discountType, discountValue: d.discountValue, vatMode: d.vatMode, whtRate: d.whtRate });

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
        customerId: d.customerId ?? null,
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
        payMethod: d.kind === 'RC' ? (d.payMethod ?? 'TRANSFER') : null,
        bank: d.kind === 'RC' ? d.bank : '',
        bankBranch: d.kind === 'RC' ? d.bankBranch : '',
        accountName: d.kind === 'RC' ? d.accountName : '',
        accountNo: d.kind === 'RC' ? d.accountNo : '',
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
