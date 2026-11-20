import { randomUUID } from 'node:crypto';
import { and, count, eq, inArray, isNotNull, like, ne, or, type SQL } from 'drizzle-orm';
import { type PgTable } from 'drizzle-orm/pg-core';
import { type Db } from '@/db/client';
import {
  accountCategories,
  advanceExpenses,
  advances,
  arCreditNotes,
  arInvoices,
  arReceipts,
  companyAccounts,
  customers,
  invoices,
  journalEntries,
  journalLines,
  milestones,
  notifications,
  payables,
  poInstallments,
  pos,
  projects,
  pvLines,
  pvs,
  receiptSubstitutes,
  salesDocs,
  vehicleTripExpenses,
  whtCerts,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { SALES_DOC_KINDS, SALES_DOC_META } from '@/domain/sales-doc';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { getPoSummary } from './invoice';
import { deletedNumbersData } from './numbering';
import { guarded, logDeletes, MUST_CANCEL_FIRST, notFound, outcome, parseIds, removeTraces, split, type DeleteOutcome } from './record-delete';

/**
 * Permanent deletes of accounting documents, e.g. test data or a document keyed in wrongly, and the wipe of all of
 * them. A document still in force is never removed: it has to be cancelled first, which undoes what it did through
 * the usual cancel. Files, comments and notifications go with it; the activity log keeps the record, and the numbers
 * that went are never handed out again.
 */

export type { DeleteOutcome };
export { MUST_CANCEL_FIRST };

// ───────────────────────────── Sales documents ─────────────────────────────

/** Quotations, receipts, tax invoices, debit notes, abbreviated tax invoices, income and expense vouchers */
export async function deleteSalesDocs(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'accounting.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const targets = await tx
        .select({ id: salesDocs.id, number: salesDocs.number, status: salesDocs.status, kind: salesDocs.kind })
        .from(salesDocs)
        .where(inArray(salesDocs.id, picked))
        .for('update');
      if (targets.length === 0) throw notFound('เอกสาร');
      const { go, kept } = split(targets, (t) => (t.status === 'CANCELLED' ? null : MUST_CANCEL_FIRST));
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        await removeTraces(tx, goIds, go.map((t) => `/sales/${SALES_DOC_META[t.kind].slug}/${t.id}`));
        // Lines go with the document (on delete cascade)
        await tx.delete(salesDocs).where(inArray(salesDocs.id, goIds));
        await logDeletes(tx, actor, 'SALES_DOC', go.map((t) => ({ ...t, note: `ลบ${SALES_DOC_META[t.kind].th} ${t.number}`, numbers: [t.number] })));
      }
      return outcome(go, kept);
    }),
  );
}

// ───────────────────────────── Receivables ─────────────────────────────

/** A draft, or a voided invoice with its voided receipts and credit notes */
export async function deleteArInvoices(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'accounting.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: arInvoices.id, number: arInvoices.number, status: arInvoices.status })
        .from(arInvoices)
        .where(inArray(arInvoices.id, picked))
        .for('update');
      if (rows.length === 0) throw notFound('ใบแจ้งหนี้');
      const targets = rows.map((r) => ({ ...r, number: r.number ?? 'ร่าง (ยังไม่มีเลขที่)' }));
      const rowIds = targets.map((t) => t.id);
      const [receiptRows, creditRows] = await Promise.all([
        tx.select({ invoiceId: arReceipts.invoiceId, number: arReceipts.number, voided: arReceipts.voided }).from(arReceipts).where(inArray(arReceipts.invoiceId, rowIds)),
        tx.select({ invoiceId: arCreditNotes.invoiceId, number: arCreditNotes.number, voided: arCreditNotes.voided }).from(arCreditNotes).where(inArray(arCreditNotes.invoiceId, rowIds)),
      ]);
      const movements = [...receiptRows, ...creditRows];
      const { go, kept } = split(targets, (t) => {
        if (t.status !== 'DRAFT' && t.status !== 'VOID') return MUST_CANCEL_FIRST;
        const live = movements.filter((m) => m.invoiceId === t.id && !m.voided).map((m) => m.number);
        return live.length > 0 ? `มีใบเสร็จหรือใบลดหนี้ที่ยังไม่ยกเลิก: ${live.join(', ')}` : null;
      });
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        await removeTraces(tx, goIds, goIds.map((id) => `/ar/invoices/${id}`));
        await tx.delete(arCreditNotes).where(inArray(arCreditNotes.invoiceId, goIds));
        await tx.delete(arReceipts).where(inArray(arReceipts.invoiceId, goIds));
        // Lines go with the invoice (on delete cascade)
        await tx.delete(arInvoices).where(inArray(arInvoices.id, goIds));
        await logDeletes(
          tx,
          actor,
          'AR_INVOICE',
          go.map((t) => {
            const own = rows.find((r) => r.id === t.id)!.number;
            const withIt = movements.filter((m) => m.invoiceId === t.id).map((m) => m.number);
            return { ...t, note: `ลบใบแจ้งหนี้ ${t.number}${withIt.length > 0 ? ` พร้อม ${withIt.join(', ')}` : ''}`, numbers: [...(own ? [own] : []), ...withIt] };
          }),
        );
      }
      return outcome(go, kept);
    }),
  );
}

/** Voided credit notes; the invoice they reduced stays */
export async function deleteArCreditNotes(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'accounting.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const targets = await tx
        .select({ id: arCreditNotes.id, number: arCreditNotes.number, voided: arCreditNotes.voided, invoiceId: arCreditNotes.invoiceId })
        .from(arCreditNotes)
        .where(inArray(arCreditNotes.id, picked))
        .for('update');
      if (targets.length === 0) throw notFound('ใบลดหนี้');
      const { go, kept } = split(targets, (t) => (t.voided ? null : MUST_CANCEL_FIRST));
      if (go.length > 0) {
        await tx.delete(arCreditNotes).where(inArray(arCreditNotes.id, go.map((t) => t.id)));
        // Shown in the history of the invoice it reduced
        await logDeletes(tx, actor, 'AR_INVOICE', go.map((t) => ({ ...t, logEntityId: t.invoiceId, action: 'CREDIT_NOTE_DELETE', note: `ลบใบลดหนี้ ${t.number}`, numbers: [t.number] })));
      }
      return outcome(go, kept);
    }),
  );
}

/** Customers no invoice is made out to; quotations and receipts keep the name printed on them */
export async function deleteCustomers(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'accounting.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const rows = await tx.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(inArray(customers.id, picked)).for('update');
      if (rows.length === 0) throw notFound('ลูกค้า');
      const targets = rows.map((r) => ({ id: r.id, number: `${r.code} ${r.name}` }));
      const billed = await tx
        .select({ customerId: arInvoices.customerId, n: count() })
        .from(arInvoices)
        .where(inArray(arInvoices.customerId, targets.map((t) => t.id)))
        .groupBy(arInvoices.customerId);
      const { go, kept } = split(targets, (t) => {
        const n = billed.find((b) => b.customerId === t.id)?.n ?? 0;
        return n > 0 ? `มีใบแจ้งหนี้ลูกค้า ${n} ใบออกให้ลูกค้านี้ ลบใบแจ้งหนี้ก่อน หรือปิดการใช้งานลูกค้าแทน` : null;
      });
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        await tx.update(projects).set({ customerId: null }).where(inArray(projects.customerId, goIds));
        // Sales documents keep their copy of the name; their link is cleared (on delete set null)
        await tx.delete(customers).where(inArray(customers.id, goIds));
        await logDeletes(tx, actor, 'CUSTOMER', go.map((t) => ({ ...t, note: `ลบลูกค้า ${t.number}` })));
      }
      return outcome(go, kept);
    }),
  );
}

// ───────────────────────────── Payables side ─────────────────────────────

/** Cancelled vendor bills; the payables they raised (cancelled with them) go too */
export async function deleteApInvoices(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'accounting.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: invoices.id, number: invoices.invoiceNo, status: invoices.status, poId: invoices.poId })
        .from(invoices)
        .where(inArray(invoices.id, picked))
        .for('update');
      if (rows.length === 0) throw notFound('ใบแจ้งหนี้ผู้ขาย');
      const linked = await tx
        .select({ id: payables.id, invoiceId: payables.invoiceId, status: payables.status })
        .from(payables)
        .where(inArray(payables.invoiceId, rows.map((r) => r.id)));
      const onPvs = linked.length
        ? await tx
            .select({ payableId: pvLines.payableId, pvNumber: pvs.number })
            .from(pvLines)
            .innerJoin(pvs, eq(pvs.id, pvLines.pvId))
            .where(inArray(pvLines.payableId, linked.map((p) => p.id)))
        : [];
      const { go, kept } = split(rows, (t) => {
        if (t.status !== 'CANCELLED') return MUST_CANCEL_FIRST;
        const own = linked.filter((p) => p.invoiceId === t.id);
        if (own.some((p) => p.status !== 'CANCELLED')) return 'มีรายการตั้งจ่ายของใบนี้ที่ยังใช้งานอยู่';
        const pvNumbers = [...new Set(onPvs.filter((l) => own.some((p) => p.id === l.payableId)).map((l) => l.pvNumber))];
        return pvNumbers.length > 0 ? `เคยอยู่ในใบสำคัญจ่าย ${pvNumbers.join(', ')} ลบใบสำคัญจ่ายนั้นก่อน` : null;
      });
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        const payableIds = linked.filter((p) => p.invoiceId && goIds.includes(p.invoiceId)).map((p) => p.id);
        await removeTraces(tx, [...goIds, ...payableIds], goIds.map((id) => `/invoices/${id}`));
        // Matches to payables go with either side (on delete cascade)
        if (payableIds.length > 0) await tx.delete(payables).where(inArray(payables.id, payableIds));
        await tx.delete(invoices).where(inArray(invoices.id, goIds));
        // In the history of the PO, as the bill's other steps are
        await logDeletes(tx, actor, 'PO', go.map((t) => ({ ...t, logEntityId: t.poId, action: 'INVOICE_DELETED', note: `ลบใบแจ้งหนี้ผู้ขาย ${t.number}` })));
      }
      return outcome(go, kept);
    }),
  );
}

const PV_REMOVABLE = new Set(['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'CANCELLED']);

/**
 * A payment voucher not yet approved, or a cancelled one. One that is still open puts its bills back in the queue,
 * as cancelling it would; a voided withholding-tax certificate goes with it.
 */
export async function deletePvs(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'accounting.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const targets = await tx.select({ id: pvs.id, number: pvs.number, status: pvs.status }).from(pvs).where(inArray(pvs.id, picked)).for('update');
      if (targets.length === 0) throw notFound('ใบสำคัญจ่าย');
      const certs = await tx
        .select({ pvId: whtCerts.pvId, number: whtCerts.number, status: whtCerts.status })
        .from(whtCerts)
        .where(inArray(whtCerts.pvId, targets.map((t) => t.id)));
      const { go, kept } = split(targets, (t) => {
        if (t.status === 'PAID') return 'จ่ายเงินแล้ว ต้องยกเลิกการจ่าย (เช็ค) และยกเลิกใบนี้ก่อน';
        if (!PV_REMOVABLE.has(t.status)) return 'อนุมัติแล้ว กด "ยกเลิก" ที่ใบสำคัญจ่ายก่อนจึงลบได้';
        return certs.some((c) => c.pvId === t.id && c.status === 'ACTIVE') ? 'มีหนังสือรับรองหัก ณ ที่จ่ายที่ยังใช้งานอยู่' : null;
      });
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        // Bills on an open voucher wait in it; a cancelled one gave them back already, maybe to another voucher since
        const open = go.filter((t) => t.status !== 'CANCELLED').map((t) => t.id);
        if (open.length > 0) {
          const held = (await tx.select({ payableId: pvLines.payableId }).from(pvLines).where(inArray(pvLines.pvId, open))).map((l) => l.payableId);
          if (held.length > 0) {
            await tx
              .update(payables)
              .set({ status: 'OPEN', updatedAt: new Date() })
              .where(and(inArray(payables.id, held), eq(payables.status, 'IN_PV')));
          }
        }
        await removeTraces(tx, goIds, goIds.map((id) => `/pv/${id}`));
        await tx.delete(whtCerts).where(inArray(whtCerts.pvId, goIds));
        // Lines go with the voucher (on delete cascade)
        await tx.delete(pvs).where(inArray(pvs.id, goIds));
        await logDeletes(
          tx,
          actor,
          'PV',
          go.map((t) => {
            const certNumbers = certs.filter((c) => c.pvId === t.id).map((c) => c.number);
            return { ...t, note: `ลบใบสำคัญจ่าย ${t.number}${certNumbers.length > 0 ? ` พร้อม ${certNumbers.join(', ')}` : ''}`, numbers: [t.number, ...certNumbers] };
          }),
        );
      }
      return outcome(go, kept);
    }),
  );
}

/** Advance requests no money was paid on: pending, refused or cancelled */
export async function deleteAdvances(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'accounting.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const targets = await tx.select({ id: advances.id, number: advances.number, status: advances.status }).from(advances).where(inArray(advances.id, picked)).for('update');
      if (targets.length === 0) throw notFound('ใบขอเงินทดรองจ่าย');
      const substitutes = await tx
        .select({ advanceId: receiptSubstitutes.advanceId, number: receiptSubstitutes.number })
        .from(receiptSubstitutes)
        .where(inArray(receiptSubstitutes.advanceId, targets.map((t) => t.id)));
      const { go, kept } = split(targets, (t) => {
        if (t.status === 'APPROVED') return 'อนุมัติแล้ว กด "ยกเลิก" ก่อนจึงลบได้';
        if (t.status !== 'PENDING' && t.status !== 'REJECTED' && t.status !== 'CANCELLED') return 'จ่ายเงินแล้ว ลบทีละใบไม่ได้';
        const rs = substitutes.filter((s) => s.advanceId === t.id).map((s) => s.number ?? 'ร่าง');
        return rs.length > 0 ? `มีใบรับรองแทนใบเสร็จอ้างถึง: ${rs.join(', ')} ลบใบนั้นก่อน` : null;
      });
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        // Trip costs put on the claim can be claimed again
        await tx.update(vehicleTripExpenses).set({ claimId: null }).where(inArray(vehicleTripExpenses.claimId, goIds));
        await removeTraces(tx, goIds, goIds.map((id) => `/advances/${id}`));
        // Expenses go with the advance (on delete cascade)
        await tx.delete(advances).where(inArray(advances.id, goIds));
        await logDeletes(tx, actor, 'ADVANCE', go.map((t) => ({ ...t, note: `ลบใบขอเงินทดรองจ่าย ${t.number}`, numbers: [t.number] })));
      }
      return outcome(go, kept);
    }),
  );
}

/** Receipt substitutes not approved, or cancelled ones */
export async function deleteReceiptSubstitutes(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'accounting.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: receiptSubstitutes.id, number: receiptSubstitutes.number, status: receiptSubstitutes.status })
        .from(receiptSubstitutes)
        .where(inArray(receiptSubstitutes.id, picked))
        .for('update');
      if (rows.length === 0) throw notFound('ใบรับรองแทนใบเสร็จ');
      const targets = rows.map((r) => ({ ...r, number: r.number ?? 'ร่าง (ยังไม่มีเลขที่)' }));
      const used = await tx
        .select({ substituteId: advanceExpenses.substituteId, advanceNumber: advances.number })
        .from(advanceExpenses)
        .innerJoin(advances, eq(advances.id, advanceExpenses.advanceId))
        .where(inArray(advanceExpenses.substituteId, targets.map((t) => t.id)));
      const { go, kept } = split(targets, (t) => {
        const by = [...new Set(used.filter((u) => u.substituteId === t.id).map((u) => u.advanceNumber))];
        if (by.length > 0) return `ถูกใช้เคลียร์เงินทดรอง ${by.join(', ')}`;
        return t.status === 'APPROVED' ? 'อนุมัติแล้ว กด "ยกเลิก" ก่อนจึงลบได้' : null;
      });
      if (go.length > 0) {
        const goIds = go.map((t) => t.id);
        await removeTraces(tx, goIds, goIds.map((id) => `/receipt-substitutes/${id}`));
        // Lines go with it (on delete cascade)
        await tx.delete(receiptSubstitutes).where(inArray(receiptSubstitutes.id, goIds));
        await logDeletes(
          tx,
          actor,
          'RECEIPT_SUBSTITUTE',
          go.map((t) => {
            const own = rows.find((r) => r.id === t.id)!.number;
            return { ...t, note: `ลบใบรับรองแทนใบเสร็จ ${t.number}`, numbers: own ? [own] : [] };
          }),
        );
      }
      return outcome(go, kept);
    }),
  );
}

// ───────────────────────────── Master data ─────────────────────────────

/** Bank and cash accounts no document records money against */
export async function deleteCompanyAccounts(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'accounting.delete');
  const picked = parseIds(ids);
  return guarded(() =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: companyAccounts.id, bank: companyAccounts.bank, accountNo: companyAccounts.accountNo, accountName: companyAccounts.accountName })
        .from(companyAccounts)
        .where(inArray(companyAccounts.id, picked))
        .for('update');
      if (rows.length === 0) throw notFound('บัญชี');
      const targets = rows.map((r) => ({ id: r.id, number: [r.bank, r.accountNo, r.accountName].filter(Boolean).join(' ') }));
      const usedBy = await tx
        .select({ accountId: salesDocs.accountId, n: count() })
        .from(salesDocs)
        .where(inArray(salesDocs.accountId, targets.map((t) => t.id)))
        .groupBy(salesDocs.accountId);
      const { go, kept } = split(targets, (t) => {
        const n = usedBy.find((u) => u.accountId === t.id)?.n ?? 0;
        return n > 0 ? `มีเอกสาร ${n} ใบบันทึกรับ-จ่ายผ่านบัญชีนี้ ลบเอกสารเหล่านั้นก่อน` : null;
      });
      if (go.length > 0) {
        await tx.delete(companyAccounts).where(inArray(companyAccounts.id, go.map((t) => t.id)));
        await logDeletes(tx, actor, 'COMPANY_ACCOUNT', go.map((t) => ({ ...t, note: `ลบบัญชี ${t.number}` })));
      }
      return outcome(go, kept);
    }),
  );
}

/** Income and expense categories; documents keep the category name they were saved with */
export async function deleteAccountCategories(db: Db, actor: SessionUser, ids: string[]): Promise<DeleteOutcome> {
  assertCan(actor, 'accounting.delete');
  const picked = parseIds(ids);
  return db.transaction(async (tx) => {
    const rows = await tx.select({ id: accountCategories.id, code: accountCategories.code, name: accountCategories.name }).from(accountCategories).where(inArray(accountCategories.id, picked)).for('update');
    if (rows.length === 0) throw notFound('หมวดบัญชี');
    const go = rows.map((r) => ({ id: r.id, number: `${r.code} ${r.name}` }));
    await tx.delete(accountCategories).where(inArray(accountCategories.id, go.map((t) => t.id)));
    await logDeletes(tx, actor, 'ACCOUNT_CATEGORY', go.map((t) => ({ ...t, note: `ลบหมวดบัญชี ${t.number}` })));
    return outcome(go, []);
  });
}

// ───────────────────────────── Wipe of all accounting documents ─────────────────────────────

/** Typed by the person wiping, so it cannot happen by a stray click */
export const ACCOUNTING_WIPE_CONFIRM = 'ลบข้อมูลบัญชีทั้งหมด';

export interface AccountingWipePreview {
  /** Documents that go; kinds with none are left out */
  documents: { label: string; count: number }[];
  /** Purchasing and project records set back so they can be paid or billed again */
  resets: { label: string; count: number }[];
}

async function countOf(db: Db, table: PgTable, where?: SQL) {
  const [row] = await db.select({ n: count() }).from(table).where(where);
  return row?.n ?? 0;
}

/** Payables that only exist because a vendor bill was keyed in go with the bill */
const BILL_PAYABLE = eq(payables.sourceType, 'CREDIT_INVOICE');
/** What a payment left on the payables that stay */
const PAID_OR_HELD = and(ne(payables.sourceType, 'CREDIT_INVOICE'), inArray(payables.status, ['IN_PV', 'PAID']));
/** Milestones marked paid by the customer's settled invoice */
const paidByBilling = (db: Db) =>
  and(eq(milestones.status, 'PAID'), inArray(milestones.id, db.select({ id: arInvoices.milestoneId }).from(arInvoices).where(isNotNull(arInvoices.milestoneId))));

export async function previewAccountingWipe(db: Db, actor: SessionUser): Promise<AccountingWipePreview> {
  assertCan(actor, 'accounting.delete');
  const salesCounts = await db.select({ kind: salesDocs.kind, n: count() }).from(salesDocs).groupBy(salesDocs.kind);
  const [arInv, arRc, arCn, apInv, pvCount, whtCount, advCount, rsCount, heldPayables, paidInstallments, billedMilestones, claimedTrips, journalCount] = await Promise.all([
    countOf(db, arInvoices),
    countOf(db, arReceipts),
    countOf(db, arCreditNotes),
    countOf(db, invoices),
    countOf(db, pvs),
    countOf(db, whtCerts),
    countOf(db, advances),
    countOf(db, receiptSubstitutes),
    countOf(db, payables, PAID_OR_HELD),
    countOf(db, poInstallments, eq(poInstallments.status, 'PAID')),
    countOf(db, milestones, paidByBilling(db)),
    countOf(db, vehicleTripExpenses, isNotNull(vehicleTripExpenses.claimId)),
    countOf(db, journalEntries),
  ]);
  const documents = [
    ...SALES_DOC_KINDS.map((k) => ({ label: SALES_DOC_META[k].th, count: salesCounts.find((s) => s.kind === k)?.n ?? 0 })),
    { label: 'ใบแจ้งหนี้/วางบิล (ลูกค้า)', count: arInv },
    { label: 'ใบเสร็จรับชำระจากใบแจ้งหนี้', count: arRc },
    { label: 'ใบลดหนี้', count: arCn },
    { label: 'ใบแจ้งหนี้ผู้ขาย (AP)', count: apInv },
    { label: 'ใบสำคัญจ่าย (PV)', count: pvCount },
    { label: 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)', count: whtCount },
    { label: 'ใบขอเงินทดรองจ่าย', count: advCount },
    { label: 'ใบรับรองแทนใบเสร็จ', count: rsCount },
    { label: 'สมุดรายวัน (รายการบัญชีอัตโนมัติ)', count: journalCount },
  ].filter((d) => d.count > 0);
  const resets = [
    { label: 'รายการในคิวตั้งจ่ายที่กลับเป็น "รอตั้งจ่าย"', count: heldPayables },
    { label: 'งวดผ่อนชำระ PO ที่กลับไปรอจ่าย', count: paidInstallments },
    { label: 'งวดงานรับเงินที่วางบิลใหม่ได้', count: billedMilestones },
    { label: 'ค่าใช้จ่ายรถที่เบิกใหม่ได้', count: claimedTrips },
  ].filter((r) => r.count > 0);
  return { documents, resets };
}

/**
 * Removes every accounting document at once, e.g. after testing, and sets what they changed on the purchasing and
 * project side back: bills wait to be paid again, PO instalments and milestones can be paid or billed again. Customers,
 * bank accounts and categories stay, and so do the number counters, so no number is handed out twice.
 */
export async function wipeAccounting(db: Db, actor: SessionUser, confirm: string): Promise<AccountingWipePreview> {
  assertCan(actor, 'accounting.delete');
  if (confirm.trim() !== ACCOUNTING_WIPE_CONFIRM) {
    throw new DomainError('INVALID_CONFIRMATION', `พิมพ์ "${ACCOUNTING_WIPE_CONFIRM}" ให้ตรงก่อน จึงจะล้างข้อมูลได้`);
  }
  const summary = await previewAccountingWipe(db, actor);
  return guarded(() =>
    db.transaction(async (tx) => {
      const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
      const numbersOf = async (rows: Promise<{ number: string | null }[]>) => (await rows).map((r) => r.number).filter((n): n is string => Boolean(n));

      const salesIds = ids(await tx.select({ id: salesDocs.id }).from(salesDocs));
      const arIds = ids(await tx.select({ id: arInvoices.id }).from(arInvoices));
      const apIds = ids(await tx.select({ id: invoices.id }).from(invoices));
      const billPayableIds = ids(await tx.select({ id: payables.id }).from(payables).where(BILL_PAYABLE));
      const pvIds = ids(await tx.select({ id: pvs.id }).from(pvs));
      const advanceIds = ids(await tx.select({ id: advances.id }).from(advances));
      const substituteIds = ids(await tx.select({ id: receiptSubstitutes.id }).from(receiptSubstitutes));
      const numbers = [
        ...(await numbersOf(tx.select({ number: salesDocs.number }).from(salesDocs))),
        ...(await numbersOf(tx.select({ number: arInvoices.number }).from(arInvoices))),
        ...(await numbersOf(tx.select({ number: arReceipts.number }).from(arReceipts))),
        ...(await numbersOf(tx.select({ number: arCreditNotes.number }).from(arCreditNotes))),
        ...(await numbersOf(tx.select({ number: pvs.number }).from(pvs))),
        ...(await numbersOf(tx.select({ number: whtCerts.number }).from(whtCerts))),
        ...(await numbersOf(tx.select({ number: advances.number }).from(advances))),
        ...(await numbersOf(tx.select({ number: receiptSubstitutes.number }).from(receiptSubstitutes))),
        ...(await numbersOf(tx.select({ number: journalEntries.number }).from(journalEntries))),
      ];
      // Picked up before the invoices go: the milestones their settlement marked paid
      const billedMilestoneIds = ids(await tx.select({ id: milestones.id }).from(milestones).where(paidByBilling(tx)));

      await removeTraces(tx, [...salesIds, ...arIds, ...apIds, ...billPayableIds, ...pvIds, ...advanceIds, ...substituteIds]);
      await tx
        .delete(notifications)
        .where(
          or(
            like(notifications.href, '/pv/%'),
            like(notifications.href, '/ar/invoices/%'),
            like(notifications.href, '/sales/%'),
            like(notifications.href, '/invoices/%'),
            like(notifications.href, '/advances/%'),
            like(notifications.href, '/receipt-substitutes/%'),
          ),
        );

      // The books: every entry came from the documents going now; the chart of accounts stays
      await tx.delete(journalLines);
      await tx.delete(journalEntries);

      // Advances and the receipt substitutes that cleared them
      await tx.update(vehicleTripExpenses).set({ claimId: null }).where(isNotNull(vehicleTripExpenses.claimId));
      await tx.delete(advanceExpenses);
      await tx.delete(receiptSubstitutes);
      await tx.delete(advances);

      // Receivables: what the customer was billed and paid
      await tx.delete(arCreditNotes);
      await tx.delete(arReceipts);
      await tx.delete(arInvoices);
      if (billedMilestoneIds.length > 0) {
        await tx.update(milestones).set({ status: 'APPROVED', paidAt: null, updatedAt: new Date() }).where(inArray(milestones.id, billedMilestoneIds));
      }
      await tx.delete(salesDocs);

      // Payables: vouchers and bills go; what was asked to be paid waits in the queue again
      await tx.delete(whtCerts);
      await tx.delete(pvs);
      await tx.update(payables).set({ status: 'OPEN', updatedAt: new Date() }).where(PAID_OR_HELD);
      await tx.update(payables).set({ invoiceId: null, updatedAt: new Date() }).where(and(ne(payables.sourceType, 'CREDIT_INVOICE'), isNotNull(payables.invoiceId)));
      await tx.update(poInstallments).set({ status: 'REQUESTED' }).where(eq(poInstallments.status, 'PAID'));
      await tx.delete(payables).where(BILL_PAYABLE);
      await tx.delete(invoices);

      // A PO closed because it was received and paid in full is open again until it is paid
      const completed = await tx.select({ id: pos.id }).from(pos).where(eq(pos.status, 'COMPLETED'));
      for (const po of completed) {
        const s = await getPoSummary(tx, po.id);
        if (s.payStatus !== 'PAID') await tx.update(pos).set({ status: 'ORDERED', updatedAt: new Date() }).where(eq(pos.id, po.id));
      }

      await logActivity(tx, {
        entityType: 'ACCOUNTING',
        entityId: randomUUID(),
        action: 'WIPE',
        userId: actor.id,
        note: `ล้างข้อมูลบัญชีทั้งหมด: ${summary.documents.map((d) => `${d.label} ${d.count}`).join(', ') || 'ไม่มีเอกสาร'}`,
        data: { ...deletedNumbersData(numbers), documents: summary.documents, resets: summary.resets },
      });
      return summary;
    }),
  );
}

