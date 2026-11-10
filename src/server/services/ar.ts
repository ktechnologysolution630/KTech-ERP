import { and, asc, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  arCreditNotes,
  arInvoiceLines,
  arInvoices,
  arReceipts,
  customers,
  milestones,
  projects,
  salesDocs,
  type SessionUser,
} from '@/db/schema';
import {
  PAY_METHODS,
  agingBucket,
  computeArInvoiceTotals,
  invoiceBalance,
  settledStatus,
  splitByInvoiceVat,
  type AgingBucket,
  type ArInvoiceStatus,
  type ArPayMethod,
} from '@/domain/ar';
import { DomainError } from '@/domain/errors';
import { D, Decimal, round2, sum } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { nextDocNumber } from './numbering';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const money = (msg: string) => z.number().finite().min(0, msg).max(10_000_000_000_000);

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown, code = 'INVALID_AR'): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError(code, r.error.issues[0].message);
  return r.data;
}

function uuidOr404(id: string, what: string) {
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', `ไม่พบ${what}`, 404);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ───────────────────────────── Customers ─────────────────────────────

const customerSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, 'กรุณาระบุรหัสลูกค้า').max(50),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อลูกค้า').max(300),
  taxId: z
    .string()
    .trim()
    .regex(/^\d{13}$/, 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก')
    .nullable()
    .or(z.literal('').transform(() => null))
    .default(null),
  branch: z.string().trim().regex(/^\d{5}$/, 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก').default('00000'),
  address: z.string().trim().max(1000).default(''),
  contactName: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(50).default(''),
  email: z.string().trim().max(200).default(''),
  creditDays: z.number().int().min(0).max(365).default(30),
  active: z.boolean().default(true),
});

export type CustomerInput = z.input<typeof customerSchema>;

export async function listCustomers(db: Db, actor: SessionUser) {
  assertCan(actor, 'ar.manage');
  return db.select().from(customers).orderBy(asc(customers.code));
}

export async function upsertCustomer(db: Db, actor: SessionUser, input: CustomerInput) {
  assertCan(actor, 'ar.manage');
  const d = parse(customerSchema, input, 'INVALID_CUSTOMER');
  const [dup] = await db.select({ id: customers.id }).from(customers).where(eq(customers.code, d.code)).limit(1);
  if (dup && dup.id !== d.id) throw new DomainError('DUPLICATE_CUSTOMER', `รหัสลูกค้า ${d.code} มีอยู่แล้ว`, 409);
  const values = {
    code: d.code,
    name: d.name,
    taxId: d.taxId,
    branch: d.branch,
    address: d.address,
    contactName: d.contactName,
    phone: d.phone,
    email: d.email,
    creditDays: d.creditDays,
    active: d.active,
  };
  if (d.id) {
    const [row] = await db
      .update(customers)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(customers.id, d.id))
      .returning();
    if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบลูกค้า', 404);
    return row;
  }
  const [row] = await db.insert(customers).values(values).returning();
  return row;
}

// ───────────────────────────── Invoices ─────────────────────────────

const lineSchema = z.object({
  description: z.string().trim().min(1, 'กรุณาระบุรายการ').max(500),
  qty: z.number().finite().positive('จำนวนต้องมากกว่า 0').max(1_000_000_000),
  unitPrice: money('ราคาต่อหน่วยต้องไม่ติดลบ'),
});

const invoiceSchema = z.object({
  customerId: z.string().uuid('กรุณาเลือกลูกค้า'),
  projectId: z.string().uuid().nullable().default(null),
  docDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  vatMode: z.enum(['EXCLUSIVE', 'INCLUSIVE', 'NONE']).default('EXCLUSIVE'),
  retentionAmount: money('ยอดหักประกันต้องไม่ติดลบ').default(0),
  note: z.string().trim().max(2000).default(''),
  lines: z.array(lineSchema).min(1, 'ต้องมีรายการอย่างน้อย 1 รายการ').max(200),
});

export type ArInvoiceInput = z.input<typeof invoiceSchema>;

async function loadCustomer(tx: Db, id: string) {
  const [c] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!c) throw new DomainError('INVALID_AR', 'ไม่พบลูกค้า');
  return c;
}

async function writeInvoice(
  tx: Db,
  actor: SessionUser,
  existingId: string | null,
  data: z.output<typeof invoiceSchema>,
  milestoneId: string | null,
) {
  const customer = await loadCustomer(tx, data.customerId);
  if (data.projectId) {
    const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, data.projectId)).limit(1);
    if (!p) throw new DomainError('INVALID_AR', 'ไม่พบโครงการ');
  }
  const docDate = data.docDate ?? bangkokDateString();
  const dueDate = data.dueDate ?? addDays(docDate, customer.creditDays);
  if (dueDate < docDate) throw new DomainError('INVALID_AR', 'วันครบกำหนดต้องไม่ก่อนวันที่เอกสาร');
  const totals = computeArInvoiceTotals(data.lines, data.vatMode);
  if (D(data.retentionAmount).gt(totals.gross)) {
    throw new DomainError('INVALID_AR', 'ยอดหักประกันผลงานต้องไม่เกินยอดรวมใบแจ้งหนี้');
  }
  const header = {
    customerId: data.customerId,
    projectId: data.projectId,
    docDate,
    dueDate,
    vatMode: data.vatMode,
    beforeVat: totals.beforeVat.toFixed(2),
    vat: totals.vat.toFixed(2),
    gross: totals.gross.toFixed(2),
    retentionAmount: D(data.retentionAmount).toFixed(2),
    note: data.note,
    updatedAt: new Date(),
  };
  let id = existingId;
  if (id) {
    await tx.update(arInvoices).set(header).where(eq(arInvoices.id, id));
    await tx.delete(arInvoiceLines).where(eq(arInvoiceLines.invoiceId, id));
  } else {
    const [row] = await tx
      .insert(arInvoices)
      .values({ ...header, milestoneId, createdBy: actor.id })
      .returning();
    id = row.id;
  }
  await tx.insert(arInvoiceLines).values(
    data.lines.map((l, i) => ({
      invoiceId: id!,
      sort: i,
      description: l.description,
      qty: D(l.qty).toFixed(3),
      unitPrice: D(l.unitPrice).toFixed(2),
      amount: totals.lineAmounts[i].toFixed(2),
    })),
  );
  return id;
}

export async function createArInvoice(db: Db, actor: SessionUser, input: ArInvoiceInput): Promise<{ id: string }> {
  assertCan(actor, 'ar.manage');
  const data = parse(invoiceSchema, input);
  return db.transaction(async (tx) => ({ id: await writeInvoice(tx, actor, null, data, null) }));
}

async function lockInvoice(tx: Db, id: string) {
  uuidOr404(id, 'ใบแจ้งหนี้');
  const [inv] = await tx.select().from(arInvoices).where(eq(arInvoices.id, id)).for('update');
  if (!inv) throw new DomainError('NOT_FOUND', 'ไม่พบใบแจ้งหนี้', 404);
  return inv;
}

export async function updateArInvoice(db: Db, actor: SessionUser, id: string, input: ArInvoiceInput): Promise<void> {
  assertCan(actor, 'ar.manage');
  const data = parse(invoiceSchema, input);
  await db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status !== 'DRAFT') throw new DomainError('INVALID_STATE', 'แก้ไขได้เฉพาะใบแจ้งหนี้ฉบับร่าง', 409);
    await writeInvoice(tx, actor, id, data, inv.milestoneId);
  });
}

/**
 * วางบิลตามงวดงานรับ: a draft invoice for a claimed or approved receive milestone. Milestone amounts
 * come from the BOQ grand total, so the invoice is VAT-inclusive; the milestone's retention carries over.
 */
export async function createInvoiceFromMilestone(
  db: Db,
  actor: SessionUser,
  milestoneId: string,
): Promise<{ id: string }> {
  assertCan(actor, 'ar.manage');
  uuidOr404(milestoneId, 'งวดงาน');
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(milestones).where(eq(milestones.id, milestoneId)).for('update');
    if (!m) throw new DomainError('NOT_FOUND', 'ไม่พบงวดงาน', 404);
    if (m.kind !== 'RECEIVE') throw new DomainError('INVALID_AR', 'วางบิลได้เฉพาะงวดงานรับ');
    if (m.status !== 'CLAIMED' && m.status !== 'APPROVED') {
      throw new DomainError('INVALID_STATE', 'วางบิลได้เมื่องวดงานส่งเบิกหรืออนุมัติแล้ว', 409);
    }
    const [existing] = await tx
      .select({ id: arInvoices.id })
      .from(arInvoices)
      .where(and(eq(arInvoices.milestoneId, milestoneId), ne(arInvoices.status, 'VOID')))
      .limit(1);
    if (existing) throw new DomainError('ALREADY_INVOICED', 'งวดงานนี้มีใบแจ้งหนี้แล้ว', 409);

    const [project] = await tx.select().from(projects).where(eq(projects.id, m.projectId)).limit(1);
    if (!project?.customerId) {
      throw new DomainError('NO_CUSTOMER', 'กรุณากำหนดลูกค้าของโครงการในแท็บตั้งค่าก่อนวางบิล');
    }
    const id = await writeInvoice(
      tx,
      actor,
      null,
      {
        customerId: project.customerId,
        projectId: project.id,
        docDate: undefined,
        dueDate: undefined,
        vatMode: 'INCLUSIVE',
        retentionAmount: Number(m.retentionAmount),
        note: m.completionCriteria,
        lines: [{ description: `งวดที่ ${m.seq}: ${m.title}`, qty: 1, unitPrice: Number(m.amount) }],
      },
      m.id,
    );
    return { id };
  });
}

export async function issueArInvoice(db: Db, actor: SessionUser, id: string): Promise<string> {
  assertCan(actor, 'ar.manage');
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status !== 'DRAFT') throw new DomainError('INVALID_STATE', 'ใบแจ้งหนี้นี้วางบิลไปแล้ว', 409);
    const number = await nextDocNumber(tx, 'INV');
    await tx
      .update(arInvoices)
      .set({ number, status: 'ISSUED', issuedAt: new Date(), updatedAt: new Date() })
      .where(eq(arInvoices.id, id));
    await logActivity(tx, { entityType: 'AR_INVOICE', entityId: id, action: 'ISSUE', userId: actor.id, note: number });
    return number;
  });
}

async function invoiceMovements(tx: Db, invoiceIds: string[]) {
  if (invoiceIds.length === 0) return { settled: new Map<string, Decimal>(), wht: new Map<string, Decimal>(), credited: new Map<string, Decimal>() };
  const [rcs, cns] = await Promise.all([
    tx
      .select({ invoiceId: arReceipts.invoiceId, amount: arReceipts.amountReceived, wht: arReceipts.whtAmount })
      .from(arReceipts)
      .where(and(inArray(arReceipts.invoiceId, invoiceIds), eq(arReceipts.voided, false))),
    tx
      .select({ invoiceId: arCreditNotes.invoiceId, gross: arCreditNotes.gross })
      .from(arCreditNotes)
      .where(and(inArray(arCreditNotes.invoiceId, invoiceIds), eq(arCreditNotes.voided, false))),
  ]);
  const settled = new Map<string, Decimal>();
  const wht = new Map<string, Decimal>();
  const credited = new Map<string, Decimal>();
  for (const r of rcs) {
    settled.set(r.invoiceId, (settled.get(r.invoiceId) ?? D(0)).plus(r.amount).plus(r.wht));
    wht.set(r.invoiceId, (wht.get(r.invoiceId) ?? D(0)).plus(r.wht));
  }
  for (const c of cns) credited.set(c.invoiceId, (credited.get(c.invoiceId) ?? D(0)).plus(c.gross));
  return { settled, wht, credited };
}

/** Recomputes status after a receipt or credit note; a fully settled milestone invoice marks the milestone paid. */
async function refreshInvoiceStatus(tx: Db, inv: typeof arInvoices.$inferSelect, paidOn: string) {
  const mv = await invoiceMovements(tx, [inv.id]);
  const settled = mv.settled.get(inv.id) ?? D(0);
  const credited = mv.credited.get(inv.id) ?? D(0);
  const balance = invoiceBalance({ gross: inv.gross, credited, settled });
  // Derive from movements alone, so a reversed receipt can move PAID back to PARTIAL
  const base: ArInvoiceStatus = inv.status === 'PAID' ? 'ISSUED' : inv.status;
  const status = settledStatus(base, balance, settled.plus(credited));
  if (status !== inv.status) {
    await tx.update(arInvoices).set({ status, updatedAt: new Date() }).where(eq(arInvoices.id, inv.id));
  }
  if (status === 'PAID' && inv.milestoneId) {
    await tx
      .update(milestones)
      .set({ status: 'PAID', paidAt: paidOn, updatedAt: new Date() })
      .where(and(eq(milestones.id, inv.milestoneId), eq(milestones.status, 'APPROVED')));
  }
  return { balance, status };
}

export async function voidArInvoice(db: Db, actor: SessionUser, id: string, reason: string): Promise<void> {
  assertCan(actor, 'ar.manage');
  const why = reason.trim();
  if (!why) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ยกเลิก');
  await db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status === 'VOID') throw new DomainError('INVALID_STATE', 'ใบแจ้งหนี้นี้ยกเลิกแล้ว', 409);
    const mv = await invoiceMovements(tx, [id]);
    if ((mv.settled.get(id) ?? D(0)).gt(0) || (mv.credited.get(id) ?? D(0)).gt(0)) {
      throw new DomainError('INVOICE_HAS_MOVEMENTS', 'มีใบเสร็จหรือใบลดหนี้แล้ว ต้องยกเลิกเอกสารเหล่านั้นก่อน', 409);
    }
    await tx.update(arInvoices).set({ status: 'VOID', voidReason: why, updatedAt: new Date() }).where(eq(arInvoices.id, id));
    await logActivity(tx, { entityType: 'AR_INVOICE', entityId: id, action: 'VOID', userId: actor.id, note: why });
  });
}

// ───────────────────────────── Receipts & credit notes ─────────────────────────────

const receiptSchema = z.object({
  receiptDate: isoDate.optional(),
  method: z.enum(PAY_METHODS).default('TRANSFER'),
  reference: z.string().trim().max(200).default(''),
  amountReceived: money('ยอดรับต้องไม่ติดลบ'),
  whtAmount: money('ยอดหัก ณ ที่จ่ายต้องไม่ติดลบ').default(0),
});

export type ArReceiptInput = z.input<typeof receiptSchema>;

/** ออกใบเสร็จรับเงิน/ใบกำกับภาษี for money (plus WHT) received against one invoice. */
export async function recordArReceipt(
  db: Db,
  actor: SessionUser,
  invoiceId: string,
  input: ArReceiptInput,
): Promise<{ id: string; number: string }> {
  assertCan(actor, 'ar.manage');
  const d = parse(receiptSchema, input);
  const settledNow = round2(D(d.amountReceived).plus(d.whtAmount));
  if (settledNow.lte(0)) throw new DomainError('INVALID_AR', 'ยอดรับชำระต้องมากกว่า 0');

  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== 'ISSUED' && inv.status !== 'PARTIAL') {
      throw new DomainError('INVALID_STATE', 'รับชำระได้เฉพาะใบแจ้งหนี้ที่วางบิลแล้วและยังค้างชำระ', 409);
    }
    const mv = await invoiceMovements(tx, [invoiceId]);
    const balance = invoiceBalance({
      gross: inv.gross,
      credited: mv.credited.get(invoiceId) ?? D(0),
      settled: mv.settled.get(invoiceId) ?? D(0),
    });
    if (settledNow.gt(balance)) {
      throw new DomainError('OVER_BALANCE', `ยอดรับชำระเกินยอดคงค้าง ${balance.toFixed(2)} บาท`, 409);
    }
    const split = splitByInvoiceVat(settledNow, inv);
    const receiptDate = d.receiptDate ?? bangkokDateString();
    const number = await nextDocNumber(tx, 'RC');
    const [row] = await tx
      .insert(arReceipts)
      .values({
        number,
        invoiceId,
        receiptDate,
        method: d.method as ArPayMethod,
        reference: d.reference,
        amountReceived: D(d.amountReceived).toFixed(2),
        whtAmount: D(d.whtAmount).toFixed(2),
        beforeVat: split.beforeVat.toFixed(2),
        vat: split.vat.toFixed(2),
        createdBy: actor.id,
      })
      .returning();
    await refreshInvoiceStatus(tx, inv, receiptDate);
    await logActivity(tx, { entityType: 'AR_INVOICE', entityId: invoiceId, action: 'RECEIPT', userId: actor.id, note: number });
    return { id: row.id, number };
  });
}

export async function voidArReceipt(db: Db, actor: SessionUser, receiptId: string, reason: string): Promise<void> {
  assertCan(actor, 'ar.manage');
  const why = reason.trim();
  if (!why) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ยกเลิก');
  uuidOr404(receiptId, 'ใบเสร็จ');
  await db.transaction(async (tx) => {
    const [rc] = await tx.select().from(arReceipts).where(eq(arReceipts.id, receiptId)).limit(1);
    if (!rc) throw new DomainError('NOT_FOUND', 'ไม่พบใบเสร็จ', 404);
    if (rc.voided) throw new DomainError('INVALID_STATE', 'ใบเสร็จนี้ยกเลิกแล้ว', 409);
    const inv = await lockInvoice(tx, rc.invoiceId);
    await tx.update(arReceipts).set({ voided: true, voidReason: why }).where(eq(arReceipts.id, receiptId));
    await refreshInvoiceStatus(tx, inv, rc.receiptDate);
    await logActivity(tx, { entityType: 'AR_INVOICE', entityId: inv.id, action: 'RECEIPT_VOID', userId: actor.id, note: `${rc.number}: ${why}` });
  });
}

const creditNoteSchema = z.object({
  docDate: isoDate.optional(),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลการลดหนี้').max(1000),
  gross: z.number().finite().positive('ยอดลดหนี้ต้องมากกว่า 0').max(10_000_000_000_000),
});

export async function issueArCreditNote(
  db: Db,
  actor: SessionUser,
  invoiceId: string,
  input: z.input<typeof creditNoteSchema>,
): Promise<{ id: string; number: string }> {
  assertCan(actor, 'ar.manage');
  const d = parse(creditNoteSchema, input);
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== 'ISSUED' && inv.status !== 'PARTIAL') {
      throw new DomainError('INVALID_STATE', 'ลดหนี้ได้เฉพาะใบแจ้งหนี้ที่ยังค้างชำระ', 409);
    }
    const mv = await invoiceMovements(tx, [invoiceId]);
    const balance = invoiceBalance({
      gross: inv.gross,
      credited: mv.credited.get(invoiceId) ?? D(0),
      settled: mv.settled.get(invoiceId) ?? D(0),
    });
    const gross = round2(D(d.gross));
    if (gross.gt(balance)) throw new DomainError('OVER_BALANCE', `ยอดลดหนี้เกินยอดคงค้าง ${balance.toFixed(2)} บาท`, 409);
    const split = splitByInvoiceVat(gross, inv);
    const docDate = d.docDate ?? bangkokDateString();
    const number = await nextDocNumber(tx, 'CN');
    const [row] = await tx
      .insert(arCreditNotes)
      .values({
        number,
        invoiceId,
        docDate,
        reason: d.reason,
        beforeVat: split.beforeVat.toFixed(2),
        vat: split.vat.toFixed(2),
        gross: gross.toFixed(2),
        createdBy: actor.id,
      })
      .returning();
    await refreshInvoiceStatus(tx, inv, docDate);
    await logActivity(tx, { entityType: 'AR_INVOICE', entityId: invoiceId, action: 'CREDIT_NOTE', userId: actor.id, note: number });
    return { id: row.id, number };
  });
}

// ───────────────────────────── Queries ─────────────────────────────

export interface ArInvoiceRow {
  id: string;
  number: string | null;
  status: ArInvoiceStatus;
  customerId: string;
  customerName: string;
  customerTaxId: string | null;
  projectId: string | null;
  projectName: string | null;
  milestoneId: string | null;
  docDate: string;
  dueDate: string;
  beforeVat: number;
  vat: number;
  gross: number;
  retentionAmount: number;
  settled: number;
  wht: number;
  credited: number;
  balance: number;
  aging: AgingBucket;
  daysOverdue: number;
}

export async function listArInvoices(
  db: Db,
  actor: SessionUser,
  today: string = bangkokDateString(),
  onlyId?: string,
): Promise<ArInvoiceRow[]> {
  assertCan(actor, 'ar.manage');
  const rows = await db
    .select({ inv: arInvoices, customer: customers, projectName: projects.name })
    .from(arInvoices)
    .innerJoin(customers, eq(customers.id, arInvoices.customerId))
    .leftJoin(projects, eq(projects.id, arInvoices.projectId))
    .where(onlyId ? eq(arInvoices.id, onlyId) : undefined)
    .orderBy(desc(arInvoices.docDate), desc(arInvoices.createdAt));
  const mv = await invoiceMovements(db, rows.map((r) => r.inv.id));
  return rows.map(({ inv, customer, projectName }) => {
    const settled = mv.settled.get(inv.id) ?? D(0);
    const credited = mv.credited.get(inv.id) ?? D(0);
    const balance = inv.status === 'VOID' || inv.status === 'DRAFT' ? D(0) : invoiceBalance({ gross: inv.gross, credited, settled });
    const aging = balance.gt(0) ? agingBucket(inv.dueDate, today) : { bucket: 'NOT_DUE' as const, daysOverdue: 0 };
    return {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      customerId: customer.id,
      customerName: customer.name,
      customerTaxId: customer.taxId,
      projectId: inv.projectId,
      projectName,
      milestoneId: inv.milestoneId,
      docDate: inv.docDate,
      dueDate: inv.dueDate,
      beforeVat: Number(inv.beforeVat),
      vat: Number(inv.vat),
      gross: Number(inv.gross),
      retentionAmount: Number(inv.retentionAmount),
      settled: settled.toNumber(),
      wht: (mv.wht.get(inv.id) ?? D(0)).toNumber(),
      credited: credited.toNumber(),
      balance: balance.toNumber(),
      aging: aging.bucket,
      daysOverdue: aging.daysOverdue,
    };
  });
}

export async function getArInvoice(db: Db, actor: SessionUser, id: string) {
  assertCan(actor, 'ar.manage');
  uuidOr404(id, 'ใบแจ้งหนี้');
  const [row] = await listArInvoices(db, actor, bangkokDateString(), id);
  if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบใบแจ้งหนี้', 404);
  const [lines, receipts, creditNotes, header] = await Promise.all([
    db.select().from(arInvoiceLines).where(eq(arInvoiceLines.invoiceId, id)).orderBy(asc(arInvoiceLines.sort)),
    db.select().from(arReceipts).where(eq(arReceipts.invoiceId, id)).orderBy(asc(arReceipts.receiptDate)),
    db.select().from(arCreditNotes).where(eq(arCreditNotes.invoiceId, id)).orderBy(asc(arCreditNotes.docDate)),
    db.select({ vatMode: arInvoices.vatMode, note: arInvoices.note }).from(arInvoices).where(eq(arInvoices.id, id)),
  ]);
  return {
    ...row,
    vatMode: header[0].vatMode,
    note: header[0].note,
    lines: lines.map((l) => ({ description: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice), amount: Number(l.amount) })),
    receipts: receipts.map((r) => ({
      id: r.id,
      number: r.number,
      receiptDate: r.receiptDate,
      method: r.method,
      reference: r.reference,
      amountReceived: Number(r.amountReceived),
      whtAmount: Number(r.whtAmount),
      vat: Number(r.vat),
      voided: r.voided,
    })),
    creditNotes: creditNotes.map((c) => ({
      id: c.id,
      number: c.number,
      docDate: c.docDate,
      reason: c.reason,
      gross: Number(c.gross),
      vat: Number(c.vat),
      voided: c.voided,
    })),
  };
}

export interface OutputVatRow {
  date: string;
  number: string;
  /** RC for a receipt against an invoice; otherwise the sales document kind */
  kind: 'RC' | 'TI' | 'STI' | 'DN' | 'INC';
  customerName: string;
  customerTaxId: string | null;
  customerBranch: string;
  projectName: string | null;
  beforeVat: number;
  vat: number;
}

/**
 * รายงานภาษีขาย: receipts (ใบเสร็จรับเงิน/ใบกำกับภาษี) issued in the month.
 * Construction services reach the VAT tax point on payment, and credit notes here can only reduce
 * the unpaid balance, so they never touch VAT already declared and are not listed.
 */
export async function outputVatReport(db: Db, actor: SessionUser, year: number, month: number) {
  assertCan(actor, 'ar.manage');
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const rcs = await db
    .select({ r: arReceipts, c: customers, projectName: projects.name })
    .from(arReceipts)
    .innerJoin(arInvoices, eq(arInvoices.id, arReceipts.invoiceId))
    .innerJoin(customers, eq(customers.id, arInvoices.customerId))
    .leftJoin(projects, eq(projects.id, arInvoices.projectId))
    .where(and(eq(arReceipts.voided, false), gte(arReceipts.receiptDate, from), lte(arReceipts.receiptDate, to)))
    .orderBy(asc(arReceipts.receiptDate), asc(arReceipts.number));

  const rows: OutputVatRow[] = rcs.map(({ r, c, projectName }) => ({
    date: r.receiptDate,
    number: r.number,
    kind: 'RC' as const,
    customerName: c.name,
    customerTaxId: c.taxId,
    customerBranch: c.branch,
    projectName,
    beforeVat: Number(r.beforeVat),
    vat: Number(r.vat),
  }));

  // Sales documents issued on their own carry output VAT too (a quotation does not)
  const docs = await db
    .select({ d: salesDocs, projectName: projects.name })
    .from(salesDocs)
    .leftJoin(projects, eq(projects.id, salesDocs.projectId))
    .where(and(eq(salesDocs.status, 'ISSUED'), inArray(salesDocs.kind, ['RC', 'TI', 'STI', 'DN', 'INC']), gte(salesDocs.docDate, from), lte(salesDocs.docDate, to)));
  for (const { d, projectName } of docs) {
    if (Number(d.vat) === 0) continue;
    rows.push({
      date: d.docDate,
      number: d.number,
      kind: d.kind as OutputVatRow['kind'],
      customerName: d.customerName || 'ลูกค้าทั่วไป',
      customerTaxId: d.customerTaxId || null,
      customerBranch: d.customerBranch,
      projectName,
      beforeVat: Number(d.beforeVat),
      vat: Number(d.vat),
    });
  }
  rows.sort((a, b) => (a.date === b.date ? a.number.localeCompare(b.number) : a.date < b.date ? -1 : 1));

  return {
    rows,
    totalBase: sum(rows.map((r) => D(r.beforeVat))).toNumber(),
    totalVat: sum(rows.map((r) => D(r.vat))).toNumber(),
  };
}
