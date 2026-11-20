import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { apCreditNotes, invoices, payables, pos, vendors, type SessionUser } from '@/db/schema';
import { splitByInvoiceVat } from '@/domain/ar';
import { DomainError } from '@/domain/errors';
import { D, round2, sum, type Decimal } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { syncJournal } from './gl';
import { nextDocNumber } from './numbering';

/**
 * ใบลดหนี้ผู้ขาย / ส่งคืนสินค้า (Express: RRGR). A vendor takes back part of a bill we recorded: goods
 * sent back, or a price cut. The note
 *  - leaves a negative payable for the vendor, which the next payment voucher nets against their bills,
 *  - reverses the bill's cost and input VAT in the books (ลงบัญชีอัตโนมัติ),
 *  - shows as a negative line on the input VAT report when the bill was a tax invoice.
 * Goods physically returned leave stock through the stock menu (เบิก › คืนผู้ขาย), at the average cost.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');

const issueSchema = z.object({
  docDate: isoDate.optional(),
  vendorDocNo: z.string().trim().max(60).optional(),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลการลดหนี้').max(1000),
  gross: z.number().finite().positive('ยอดลดหนี้ต้องมากกว่า 0').max(10_000_000_000_000),
});

export type IssueApCreditNoteInput = z.input<typeof issueSchema>;

/** What the live credit notes of a bill already took back */
async function creditedOn(tx: Db, invoiceId: string): Promise<Decimal> {
  const rows = await tx
    .select({ gross: apCreditNotes.gross })
    .from(apCreditNotes)
    .where(and(eq(apCreditNotes.invoiceId, invoiceId), eq(apCreditNotes.voided, false)));
  return round2(sum(rows.map((r) => D(r.gross))));
}

export async function issueApCreditNote(
  db: Db,
  actor: SessionUser,
  invoiceId: string,
  input: IssueApCreditNoteInput,
): Promise<{ id: string; number: string }> {
  assertCan(actor, 'invoice.manage');
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION', parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง', 400);
  const d = parsed.data;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ inv: invoices, projectId: pos.projectId })
      .from(invoices)
      .innerJoin(pos, eq(pos.id, invoices.poId))
      .where(eq(invoices.id, invoiceId))
      .for('update');
    if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบใบแจ้งหนี้ผู้ขาย', 404);
    const inv = row.inv;
    if (inv.status !== 'ACTIVE') throw new DomainError('INVALID_STATE', 'ลดหนี้ได้เฉพาะใบแจ้งหนี้ที่ยังใช้งานอยู่', 409);

    const gross = round2(D(d.gross));
    const room = round2(D(inv.gross).minus(await creditedOn(tx, invoiceId)));
    if (gross.gt(room)) {
      throw new DomainError('OVER_BALANCE', `ยอดลดหนี้เกินยอดใบแจ้งหนี้ที่ยังลดได้ ${room.toFixed(2)} บาท`, 409);
    }
    const split = splitByInvoiceVat(gross, inv);
    const docDate = d.docDate ?? bangkokDateString();
    const number = await nextDocNumber(tx, 'PCN', new Date(`${docDate}T12:00:00+07:00`));
    const vendorDocNo = d.vendorDocNo ?? '';

    const [payable] = await tx
      .insert(payables)
      .values({
        sourceType: 'CREDIT_NOTE',
        poId: inv.poId,
        projectId: row.projectId,
        vendorId: inv.vendorId,
        invoiceId: inv.id,
        beforeVat: split.beforeVat.neg().toFixed(2),
        vat: split.vat.neg().toFixed(2),
        gross: gross.neg().toFixed(2),
        dueDate: docDate,
        status: 'OPEN',
        requestedBy: actor.id,
        note: `ใบลดหนี้ ${number}${vendorDocNo ? ` (ผู้ขาย ${vendorDocNo})` : ''} ของใบแจ้งหนี้ ${inv.invoiceNo}`,
      })
      .returning();

    const [cn] = await tx
      .insert(apCreditNotes)
      .values({
        number,
        invoiceId: inv.id,
        vendorId: inv.vendorId,
        docDate,
        vendorDocNo,
        reason: d.reason,
        beforeVat: split.beforeVat.toFixed(2),
        vat: split.vat.toFixed(2),
        gross: gross.toFixed(2),
        payableId: payable!.id,
        createdBy: actor.id,
      })
      .returning();

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PO',
      entityId: inv.poId,
      action: 'AP_CREDIT_NOTE',
      note: `${number} ลดหนี้ใบแจ้งหนี้ ${inv.invoiceNo} ${gross.toFixed(2)} บาท: ${d.reason}`,
      data: { invoiceId: inv.id, creditNoteId: cn!.id },
    });
    await syncJournal(tx, 'AP_CREDIT_NOTE', cn!.id, actor.id);
    return { id: cn!.id, number };
  });
}

/**
 * Cancels a vendor credit note while its amount is still waiting in the payment queue. Once a payment
 * voucher took it, cancel that voucher first.
 */
export async function voidApCreditNote(db: Db, actor: SessionUser, creditNoteId: string, reason: string): Promise<void> {
  assertCan(actor, 'invoice.manage');
  const why = reason.trim();
  if (!why) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ยกเลิก', 400);
  if (!z.string().uuid().safeParse(creditNoteId).success) throw new DomainError('NOT_FOUND', 'ไม่พบใบลดหนี้', 404);
  await db.transaction(async (tx) => {
    const [cn] = await tx.select().from(apCreditNotes).where(eq(apCreditNotes.id, creditNoteId)).for('update');
    if (!cn) throw new DomainError('NOT_FOUND', 'ไม่พบใบลดหนี้', 404);
    if (cn.voided) throw new DomainError('INVALID_STATE', 'ใบลดหนี้นี้ยกเลิกแล้ว', 409);
    if (cn.payableId) {
      const [p] = await tx.select().from(payables).where(eq(payables.id, cn.payableId));
      if (p && (p.status === 'IN_PV' || p.status === 'PAID')) {
        throw new DomainError('PAYABLE_IN_USE', 'ใบลดหนี้นี้ถูกนำไปหักในใบสำคัญจ่ายแล้ว ให้ยกเลิกใบสำคัญจ่ายนั้นก่อน', 409);
      }
      if (p) await tx.update(payables).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(payables.id, p.id));
    }
    await tx.update(apCreditNotes).set({ voided: true, voidReason: why }).where(eq(apCreditNotes.id, cn.id));
    const [inv] = await tx.select({ poId: invoices.poId }).from(invoices).where(eq(invoices.id, cn.invoiceId));
    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PO',
      entityId: inv!.poId,
      action: 'AP_CREDIT_NOTE_VOID',
      note: `${cn.number}: ${why}`,
      data: { invoiceId: cn.invoiceId, creditNoteId: cn.id },
    });
    await syncJournal(tx, 'AP_CREDIT_NOTE', cn.id, actor.id);
  });
}

export interface ApCreditNoteRow {
  id: string;
  number: string;
  invoiceId: string;
  invoiceNo: string;
  vendorName: string;
  docDate: string;
  vendorDocNo: string;
  reason: string;
  beforeVat: string;
  vat: string;
  gross: string;
  voided: boolean;
  voidReason: string | null;
  /** Where its amount is in the payment queue: OPEN waits, IN_PV/PAID was netted on a voucher */
  payableStatus: string | null;
}

/** Credit notes, newest first; of one bill when invoiceId is given */
export async function listApCreditNotes(db: Db, actor: SessionUser, opts: { invoiceId?: string } = {}): Promise<ApCreditNoteRow[]> {
  assertCan(actor, 'invoice.manage');
  const rows = await db
    .select({ cn: apCreditNotes, invoiceNo: invoices.invoiceNo, vendorName: vendors.name })
    .from(apCreditNotes)
    .innerJoin(invoices, eq(invoices.id, apCreditNotes.invoiceId))
    .innerJoin(vendors, eq(vendors.id, apCreditNotes.vendorId))
    .where(opts.invoiceId ? eq(apCreditNotes.invoiceId, opts.invoiceId) : undefined)
    .orderBy(desc(apCreditNotes.docDate), desc(apCreditNotes.createdAt));
  const payableIds = rows.map((r) => r.cn.payableId).filter((x): x is string => Boolean(x));
  const statuses = payableIds.length
    ? new Map((await db.select({ id: payables.id, status: payables.status }).from(payables).where(inArray(payables.id, payableIds))).map((p) => [p.id, p.status]))
    : new Map<string, string>();
  return rows.map((r) => ({
    id: r.cn.id,
    number: r.cn.number,
    invoiceId: r.cn.invoiceId,
    invoiceNo: r.invoiceNo,
    vendorName: r.vendorName,
    docDate: r.cn.docDate,
    vendorDocNo: r.cn.vendorDocNo,
    reason: r.cn.reason,
    beforeVat: r.cn.beforeVat,
    vat: r.cn.vat,
    gross: r.cn.gross,
    voided: r.cn.voided,
    voidReason: r.cn.voidReason,
    payableStatus: r.cn.payableId ? (statuses.get(r.cn.payableId) ?? null) : null,
  }));
}

/** What a bill can still be credited: its gross less live credit notes */
export async function apCreditRoom(db: Db, invoiceId: string): Promise<string> {
  const [inv] = await db.select({ gross: invoices.gross }).from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return '0.00';
  return round2(D(inv.gross).minus(await creditedOn(db, invoiceId))).toFixed(2);
}
