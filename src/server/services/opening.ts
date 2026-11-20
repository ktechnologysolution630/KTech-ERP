import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  arCreditNotes,
  arInvoiceLines,
  arInvoices,
  arReceipts,
  customers,
  glAccounts,
  journalEntries,
  journalLines,
  payables,
  pvLines,
  vendors,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, round2, sum } from '@/domain/money';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { nextDocNumber } from './numbering';
import { assertPeriodOpen } from './gl-period';

/**
 * ยอดยกมา (Express: บันทึกยอดยกมา): the balances a company brings in when it starts using the system.
 *  - One opening journal entry holds every account's balance on the start date (ยอดบัญชียกมา).
 *  - Customer and supplier detail sits under it: an opening customer bill (ลูกหนี้คงค้างยกมา) can be received
 *    against like any bill, and an opening supplier debt (เจ้าหนี้คงค้างยกมา) is paid by a PV like any bill.
 *    Neither posts on its own, since the opening entry already carries the debt; the page compares the two.
 *  - Stock quantities are brought in from the stock menu (ยอดยกมาเมื่อเพิ่มวัสดุ / ตรวจนับ).
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
const amount = z.number().finite().min(0, 'ยอดต้องไม่ติดลบ').max(10_000_000_000_000);

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('VALIDATION', r.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง', 400);
  return r.data;
}

// ───────────────────────────── Opening journal entry ─────────────────────────────

const openingSchema = z.object({
  date: isoDate,
  lines: z
    .array(z.object({ accountId: z.string().uuid('เลือกบัญชีให้ครบ'), debit: amount, credit: amount }))
    .max(500),
});

export type OpeningEntryInput = z.input<typeof openingSchema>;

export interface OpeningEntryDto {
  id: string;
  number: string;
  date: string;
  lines: { accountId: string; code: string; name: string; debit: number; credit: number }[];
}

export async function getOpeningEntry(db: Db, actor: SessionUser): Promise<OpeningEntryDto | null> {
  assertCan(actor, 'gl.view');
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.sourceType, 'OPENING'), eq(journalEntries.status, 'POSTED')))
    .orderBy(desc(journalEntries.createdAt))
    .limit(1);
  if (!entry) return null;
  const lines = await db
    .select({ l: journalLines, code: glAccounts.code, name: glAccounts.name })
    .from(journalLines)
    .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, entry.id))
    .orderBy(asc(glAccounts.code));
  return {
    id: entry.id,
    number: entry.number,
    date: entry.entryDate,
    lines: lines.map((r) => ({ accountId: r.l.accountId, code: r.code, name: r.name, debit: Number(r.l.debit), credit: Number(r.l.credit) })),
  };
}

/**
 * Saves the opening balances as one entry. Saving again voids the earlier entry and posts the new one, so
 * the history stays readable. Debits must equal credits; an empty list just removes the opening entry.
 */
export async function saveOpeningEntry(db: Db, actor: SessionUser, input: OpeningEntryInput): Promise<string | null> {
  assertCan(actor, 'gl.manage');
  const d = parse(openingSchema, input);
  const merged = new Map<string, { debit: ReturnType<typeof D>; credit: ReturnType<typeof D> }>();
  for (const l of d.lines) {
    const prev = merged.get(l.accountId) ?? { debit: D(0), credit: D(0) };
    merged.set(l.accountId, { debit: prev.debit.plus(l.debit), credit: prev.credit.plus(l.credit) });
  }
  // One side per account, as a balance is either a debit or a credit
  const lines = [...merged.entries()]
    .map(([accountId, v]) => {
      const net = round2(v.debit.minus(v.credit));
      return { accountId, debit: net.isPositive() ? net : D(0), credit: net.isNegative() ? net.abs() : D(0) };
    })
    .filter((l) => !l.debit.isZero() || !l.credit.isZero());
  const debit = round2(sum(lines.map((l) => l.debit)));
  const credit = round2(sum(lines.map((l) => l.credit)));
  if (!debit.eq(credit)) {
    throw new DomainError('GL_UNBALANCED', `ยอดยกมาไม่สมดุล เดบิต ${debit.toFixed(2)} / เครดิต ${credit.toFixed(2)} (ต่าง ${debit.minus(credit).abs().toFixed(2)})`, 400);
  }

  return db.transaction(async (tx) => {
    const [prev] = await tx
      .select({ date: journalEntries.entryDate })
      .from(journalEntries)
      .where(and(eq(journalEntries.sourceType, 'OPENING'), eq(journalEntries.status, 'POSTED')));
    if (prev) await assertPeriodOpen(tx, prev.date);
    await assertPeriodOpen(tx, d.date);
    if (lines.length > 0) {
      const found = await tx.select({ id: glAccounts.id }).from(glAccounts).where(inArray(glAccounts.id, lines.map((l) => l.accountId)));
      if (found.length !== lines.length) throw new DomainError('NOT_FOUND', 'ไม่พบบางบัญชีในผังบัญชี', 404);
    }
    await tx
      .update(journalEntries)
      .set({ status: 'VOID', voidedAt: new Date(), voidReason: 'แก้ไขยอดยกมา' })
      .where(and(eq(journalEntries.sourceType, 'OPENING'), eq(journalEntries.status, 'POSTED')));
    if (lines.length === 0) return null;

    const number = await nextDocNumber(tx, 'JV', new Date(`${d.date}T12:00:00+07:00`));
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        number,
        entryDate: d.date,
        book: 'GL',
        sourceType: 'OPENING',
        sourceNumber: 'ยอดยกมา',
        description: `ยอดยกมา ณ วันที่ ${d.date}`,
        total: debit.toFixed(2),
        createdBy: actor.id,
      })
      .returning();
    await tx.insert(journalLines).values(
      lines.map((l, i) => ({ entryId: entry!.id, accountId: l.accountId, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2), memo: 'ยอดยกมา', sort: i })),
    );
    await logActivity(tx, { entityType: 'ACCOUNTING', entityId: entry!.id, action: 'OPENING_SAVED', userId: actor.id, note: `${number} ยอดยกมา ${debit.toFixed(2)} บาท` });
    return entry!.id;
  });
}

// ───────────────────────────── ลูกหนี้คงค้างยกมา ─────────────────────────────

const arOpeningSchema = z.object({
  customerId: z.string().uuid('เลือกลูกค้า'),
  number: z.string().trim().min(1, 'กรุณาระบุเลขที่เอกสารเดิม').max(60).regex(/^\S+$/, 'เลขที่ต้องไม่มีช่องว่าง'),
  docDate: isoDate,
  dueDate: isoDate,
  gross: z.number().finite().positive('ยอดค้างต้องมากกว่า 0').max(10_000_000_000_000),
  note: z.string().trim().max(500).optional(),
});

export type ArOpeningInput = z.input<typeof arOpeningSchema>;

/** A customer bill from before the system, still owed. Receipts against it work as usual. */
export async function addArOpening(db: Db, actor: SessionUser, input: ArOpeningInput): Promise<string> {
  assertCan(actor, 'gl.manage');
  const d = parse(arOpeningSchema, input);
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, d.customerId));
    if (!c) throw new DomainError('NOT_FOUND', 'ไม่พบลูกค้า', 404);
    const [taken] = await tx.select({ id: arInvoices.id }).from(arInvoices).where(eq(arInvoices.number, d.number)).limit(1);
    if (taken) throw new DomainError('DUPLICATE_NUMBER', `เลขที่ ${d.number} มีอยู่แล้ว`, 409);
    const gross = round2(D(d.gross)).toFixed(2);
    const [inv] = await tx
      .insert(arInvoices)
      .values({
        number: d.number,
        customerId: d.customerId,
        docDate: d.docDate,
        dueDate: d.dueDate,
        vatMode: 'NONE',
        beforeVat: gross,
        vat: '0.00',
        gross,
        status: 'ISSUED',
        isOpening: true,
        note: d.note ? `ยอดยกมา: ${d.note}` : 'ยอดยกมา',
        createdBy: actor.id,
        issuedAt: new Date(),
      })
      .returning();
    await tx.insert(arInvoiceLines).values({ invoiceId: inv!.id, sort: 0, description: 'ลูกหนี้คงค้างยกมา', qty: '1', unitPrice: gross, amount: gross });
    await logActivity(tx, { entityType: 'AR_INVOICE', entityId: inv!.id, action: 'OPENING_CREATED', userId: actor.id, note: `${d.number} ${gross}` });
    return inv!.id;
  });
}

/** Removes an opening customer bill nothing was received or credited against yet */
export async function removeArOpening(db: Db, actor: SessionUser, id: string): Promise<void> {
  assertCan(actor, 'gl.manage');
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(arInvoices).where(and(eq(arInvoices.id, id), eq(arInvoices.isOpening, true))).for('update');
    if (!inv) throw new DomainError('NOT_FOUND', 'ไม่พบลูกหนี้ยกมา', 404);
    const [rc] = await tx.select({ id: arReceipts.id }).from(arReceipts).where(eq(arReceipts.invoiceId, id)).limit(1);
    const [cn] = await tx.select({ id: arCreditNotes.id }).from(arCreditNotes).where(eq(arCreditNotes.invoiceId, id)).limit(1);
    if (rc || cn) throw new DomainError('INVOICE_HAS_MOVEMENTS', 'มีใบเสร็จหรือใบลดหนี้แล้ว ลบไม่ได้', 409);
    await tx.delete(arInvoices).where(eq(arInvoices.id, id));
    await logActivity(tx, { entityType: 'ACCOUNTING', entityId: id, action: 'OPENING_REMOVED', userId: actor.id, note: `ลบลูกหนี้ยกมา ${inv.number}` });
  });
}

// ───────────────────────────── เจ้าหนี้คงค้างยกมา ─────────────────────────────

const apOpeningSchema = z.object({
  vendorId: z.string().uuid('เลือกผู้ขาย'),
  docNo: z.string().trim().min(1, 'กรุณาระบุเลขที่บิลเดิม').max(60),
  dueDate: isoDate,
  gross: z.number().finite().positive('ยอดค้างต้องมากกว่า 0').max(10_000_000_000_000),
  /** VAT inside the amount, so a PV withholds tax on the amount before VAT */
  vat: amount.default(0),
});

export type ApOpeningInput = z.input<typeof apOpeningSchema>;

/** A supplier bill from before the system, still owed: waits in the payment queue for a PV */
export async function addApOpening(db: Db, actor: SessionUser, input: ApOpeningInput): Promise<string> {
  assertCan(actor, 'gl.manage');
  const d = parse(apOpeningSchema, input);
  const gross = round2(D(d.gross));
  const vat = round2(D(d.vat));
  if (vat.gte(gross)) throw new DomainError('VALIDATION', 'VAT ต้องน้อยกว่ายอดรวม', 400);
  return db.transaction(async (tx) => {
    const [v] = await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, d.vendorId));
    if (!v) throw new DomainError('NOT_FOUND', 'ไม่พบผู้ขาย', 404);
    const [p] = await tx
      .insert(payables)
      .values({
        sourceType: 'OPENING',
        vendorId: d.vendorId,
        beforeVat: gross.minus(vat).toFixed(2),
        vat: vat.toFixed(2),
        gross: gross.toFixed(2),
        dueDate: d.dueDate,
        status: 'OPEN',
        requestedBy: actor.id,
        note: `เจ้าหนี้ยกมา ${d.docNo}`,
      })
      .returning();
    await logActivity(tx, { entityType: 'ACCOUNTING', entityId: p!.id, action: 'OPENING_CREATED', userId: actor.id, note: `เจ้าหนี้ยกมา ${d.docNo} ${gross.toFixed(2)}` });
    return p!.id;
  });
}

/** Removes an opening supplier debt no PV took */
export async function removeApOpening(db: Db, actor: SessionUser, id: string): Promise<void> {
  assertCan(actor, 'gl.manage');
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payables).where(and(eq(payables.id, id), eq(payables.sourceType, 'OPENING'))).for('update');
    if (!p) throw new DomainError('NOT_FOUND', 'ไม่พบเจ้าหนี้ยกมา', 404);
    const [onPv] = await tx.select({ id: pvLines.id }).from(pvLines).where(eq(pvLines.payableId, id)).limit(1);
    if (p.status !== 'OPEN' || onPv) throw new DomainError('PAYABLE_IN_USE', 'รายการนี้อยู่ในใบสำคัญจ่ายแล้ว ลบไม่ได้', 409);
    await tx.delete(payables).where(eq(payables.id, id));
    await logActivity(tx, { entityType: 'ACCOUNTING', entityId: id, action: 'OPENING_REMOVED', userId: actor.id, note: p.note });
  });
}

// ───────────────────────────── Overview ─────────────────────────────

export interface OpeningOverview {
  entry: OpeningEntryDto | null;
  ar: { id: string; number: string; customerName: string; docDate: string; dueDate: string; gross: number; status: string }[];
  ap: { id: string; docNo: string; vendorName: string; dueDate: string; gross: number; vat: number; status: string }[];
  /** Detail totals beside what the opening entry carries on the AR and AP control accounts */
  check: { arDetail: number; arLedger: number; apDetail: number; apLedger: number };
}

export async function getOpeningOverview(db: Db, actor: SessionUser): Promise<OpeningOverview> {
  assertCan(actor, 'gl.view');
  const [entry, arRows, apRows, controls] = await Promise.all([
    getOpeningEntry(db, actor),
    db
      .select({ inv: arInvoices, customerName: customers.name })
      .from(arInvoices)
      .innerJoin(customers, eq(customers.id, arInvoices.customerId))
      .where(eq(arInvoices.isOpening, true))
      .orderBy(asc(customers.name), asc(arInvoices.docDate)),
    db
      .select({ p: payables, vendorName: vendors.name })
      .from(payables)
      .innerJoin(vendors, eq(vendors.id, payables.vendorId))
      .where(eq(payables.sourceType, 'OPENING'))
      .orderBy(asc(vendors.name), asc(payables.dueDate)),
    db.select({ id: glAccounts.id, key: glAccounts.systemKey }).from(glAccounts).where(inArray(glAccounts.systemKey, ['AR', 'AP'])),
  ]);
  const arId = controls.find((c) => c.key === 'AR')?.id;
  const apId = controls.find((c) => c.key === 'AP')?.id;
  const ledger = (id: string | undefined, side: 'debit' | 'credit') => {
    const l = entry?.lines.find((x) => x.accountId === id);
    return l ? round2(D(l[side]).minus(side === 'debit' ? l.credit : l.debit)).toNumber() : 0;
  };
  const ar = arRows
    .filter((r) => r.inv.status !== 'VOID')
    .map((r) => ({ id: r.inv.id, number: r.inv.number ?? '', customerName: r.customerName, docDate: r.inv.docDate, dueDate: r.inv.dueDate, gross: Number(r.inv.gross), status: r.inv.status }));
  const ap = apRows
    .filter((r) => r.p.status !== 'CANCELLED')
    .map((r) => ({ id: r.p.id, docNo: r.p.note.replace(/^เจ้าหนี้ยกมา /, ''), vendorName: r.vendorName, dueDate: r.p.dueDate, gross: Number(r.p.gross), vat: Number(r.p.vat), status: r.p.status }));
  return {
    entry,
    ar,
    ap,
    check: {
      arDetail: round2(sum(ar.map((r) => D(r.gross)))).toNumber(),
      arLedger: ledger(arId, 'debit'),
      apDetail: round2(sum(ap.map((r) => D(r.gross)))).toNumber(),
      apLedger: ledger(apId, 'credit'),
    },
  };
}
