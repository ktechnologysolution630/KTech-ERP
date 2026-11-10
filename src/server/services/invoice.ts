import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  invoicePayableMatches,
  invoices,
  payables,
  poInstallments,
  poLines,
  pos,
  pvLines,
  pvs,
  receiptLines,
  receipts,
  vendors,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, round2, sum, type Decimal } from '@/domain/money';
import { summarizePo, type PoSummary } from '@/domain/po-summary';
import { computeDueDate } from '@/domain/payment-terms';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { lockPo, registerPoHasPayablesResolver } from './po';
import { registerPoAutoCompleteHook, triggerPoAutoComplete } from './receipt';

// Register PO has non-cancelled payables resolver for cancelPo check
registerPoHasPayablesResolver(async (tx, poId) => {
  const rows = await tx
    .select({ id: payables.id })
    .from(payables)
    .where(and(eq(payables.poId, poId), ne(payables.status, 'CANCELLED')))
    .limit(1);
  return rows.length > 0;
});

/** What has arrived on a PO so far: the latest delivery date and its value incl. VAT */
async function receivedSoFar(tx: Db, poId: string): Promise<{ lastDate: string | null; value: Decimal }> {
  const rows = await tx
    .select({ receivedAt: receipts.receivedAt, qty: receiptLines.qty, unitGross: poLines.unitGross })
    .from(receiptLines)
    .innerJoin(receipts, and(eq(receipts.id, receiptLines.receiptId), eq(receipts.poId, poId), eq(receipts.status, 'CONFIRMED')))
    .innerJoin(poLines, eq(poLines.id, receiptLines.poLineId));
  let lastDate: string | null = null;
  for (const r of rows) if (!lastDate || r.receivedAt > lastDate) lastDate = r.receivedAt;
  return { lastDate, value: round2(sum(rows.map((r) => D(r.qty).times(D(r.unitGross))))) };
}

/** Rounding between line VAT and the bill's VAT may differ by a few satang */
const RECEIVED_TOLERANCE = D(1);

export interface CreateInvoiceInput {
  poId: string;
  invoiceNo: string;
  invoiceDate: string;
  isTaxInvoice?: boolean;
  beforeVat: Decimal | string | number;
  vat: Decimal | string | number;
  gross?: Decimal | string | number;
  dueDate?: string | null;
}

export async function createInvoice(
  db: Db,
  actor: SessionUser,
  input: CreateInvoiceInput,
): Promise<{ id: string; warnings: string[] }> {
  assertCan(actor, 'invoice.manage');

  const invoiceNo = input.invoiceNo.trim();
  if (!invoiceNo) {
    throw new DomainError('INVALID_INPUT', 'กรุณาระบุเลขที่ใบแจ้งหนี้/ใบกำกับภาษี', 400);
  }
  if (!input.invoiceDate) {
    throw new DomainError('INVALID_INPUT', 'กรุณาระบุวันที่เอกสาร', 400);
  }

  const beforeVat = round2(D(input.beforeVat));
  const vat = round2(D(input.vat));
  const computedGross = round2(beforeVat.plus(vat));
  const gross = input.gross !== undefined ? round2(D(input.gross)) : computedGross;

  if (!gross.eq(computedGross)) {
    throw new DomainError(
      'INVALID_TOTAL',
      'ยอดรวม (gross) ต้องเท่ากับยอดก่อน VAT บวก VAT',
      400,
    );
  }
  if (gross.lte(0)) {
    throw new DomainError('INVALID_TOTAL', 'ยอดใบแจ้งหนี้ต้องมากกว่า 0', 400);
  }

  return db.transaction(async (tx) => {
    const po = await lockPo(tx, input.poId);
    if (po.status === 'CANCELLED' || po.status === 'DRAFT' || po.status === 'PENDING_APPROVAL') {
      throw new DomainError('INVALID_STATUS', 'ใบสั่งซื้อยังไม่ได้รับอนุมัติหรือถูกยกเลิกแล้ว', 409);
    }

    // Check unique (vendorId, invoiceNo) among ACTIVE invoices
    const [dup] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.vendorId, po.vendorId),
          eq(invoices.invoiceNo, invoiceNo),
          eq(invoices.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (dup) {
      throw new DomainError(
        'DUPLICATE_INVOICE',
        `เลขที่ใบแจ้งหนี้ ${invoiceNo} ของผู้ขายรายนี้มีอยู่ในระบบแล้ว`,
        409,
      );
    }

    let dueDate: string | null = input.dueDate ?? null;
    let billingDate: string | null = null;
    if (po.paymentType === 'CREDIT') {
      // A credit bill is placed against goods that have arrived, and never for more than they are worth
      const received = await receivedSoFar(tx, po.id);
      if (!received.lastDate) {
        throw new DomainError('NOT_RECEIVED', 'ยังไม่มีการรับของในใบสั่งซื้อนี้ วางบิลได้หลังรับของแล้วเท่านั้น', 409);
      }
      const [billed] = await tx
        .select({ gross: sql<string>`coalesce(sum(${invoices.gross}), 0)` })
        .from(invoices)
        .where(and(eq(invoices.poId, po.id), eq(invoices.status, 'ACTIVE')));
      const afterThis = D(billed?.gross ?? 0).plus(gross);
      if (afterThis.gt(received.value.plus(RECEIVED_TOLERANCE))) {
        throw new DomainError(
          'INVOICE_EXCEEDS_RECEIVED',
          `ยอดวางบิลรวม ฿${afterThis.toFixed(2)} เกินมูลค่าของที่รับแล้ว ฿${received.value.toFixed(2)}`,
          409,
        );
      }
      const computed = computeDueDate({
        invoiceDate: input.invoiceDate,
        receivedDate: received.lastDate,
        terms: {
          billingSchedule: po.billingSchedule,
          creditBasis: po.creditBasis,
          creditDays: po.creditDays ?? 0,
          chequeSchedule: po.chequeSchedule,
        },
      });
      billingDate = computed.billingDate;
      if (!dueDate) dueDate = computed.dueDate;
    }

    const [created] = await tx
      .insert(invoices)
      .values({
        poId: po.id,
        vendorId: po.vendorId,
        invoiceNo,
        invoiceDate: input.invoiceDate,
        isTaxInvoice: input.isTaxInvoice ?? true,
        beforeVat: beforeVat.toFixed(2),
        vat: vat.toFixed(2),
        gross: gross.toFixed(2),
        billingDate,
        dueDate,
        status: 'ACTIVE',
        createdBy: actor.id,
      })
      .returning();

    if (po.paymentType === 'CREDIT') {
      const [payable] = await tx
        .insert(payables)
        .values({
          sourceType: 'CREDIT_INVOICE',
          poId: po.id,
          projectId: po.projectId,
          vendorId: po.vendorId,
          invoiceId: created!.id,
          beforeVat: beforeVat.toFixed(2),
          vat: vat.toFixed(2),
          gross: gross.toFixed(2),
          dueDate: dueDate ?? input.invoiceDate,
          status: 'OPEN',
          requestedBy: actor.id,
          note: `ใบแจ้งหนี้ ${invoiceNo}`,
        })
        .returning();

      await tx.insert(invoicePayableMatches).values({
        invoiceId: created!.id,
        payableId: payable!.id,
        gross: gross.toFixed(2),
      });
    }

    // Check cumulative active invoices vs PO gross
    const activeInvs = await tx
      .select({ gross: invoices.gross })
      .from(invoices)
      .where(and(eq(invoices.poId, po.id), eq(invoices.status, 'ACTIVE')));
    const totalInvGross = sum(activeInvs.map((r) => D(r.gross)));

    const warnings: string[] = [];
    if (totalInvGross.gt(D(po.gross))) {
      warnings.push('INVOICE_EXCEEDS_PO');
    }

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PO',
      entityId: po.id,
      action: 'INVOICE_CREATED',
      data: {
        invoiceId: created!.id,
        invoiceNo,
        gross: gross.toFixed(2),
        warnings,
      },
    });

    await triggerPoAutoComplete(tx, po.id);

    return { id: created!.id, warnings };
  });
}

export async function matchInvoice(
  db: Db,
  actor: SessionUser,
  invoiceId: string,
  matches: { payableId: string; gross: Decimal | string | number }[],
) {
  assertCan(actor, 'invoice.manage');

  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    if (!inv) throw new DomainError('NOT_FOUND', 'ไม่พบใบแจ้งหนี้/ใบกำกับภาษี', 404);
    if (inv.status !== 'ACTIVE') {
      throw new DomainError('INVALID_STATUS', 'ใบแจ้งหนี้ถูกยกเลิกแล้ว', 409);
    }

    const totalMatchForInvoice = sum(matches.map((m) => round2(D(m.gross))));
    if (totalMatchForInvoice.gt(D(inv.gross))) {
      throw new DomainError(
        'MATCH_EXCEEDS_INVOICE',
        'ยอดจับคู่รวมเกินยอดใบกำกับภาษี',
        400,
      );
    }

    // Clear existing matches for this invoice first so re-matching works cleanly
    await tx
      .delete(invoicePayableMatches)
      .where(eq(invoicePayableMatches.invoiceId, invoiceId));

    for (const m of matches) {
      const matchGross = round2(D(m.gross));
      if (matchGross.lte(0)) continue;

      const [p] = await tx
        .select()
        .from(payables)
        .where(eq(payables.id, m.payableId))
        .limit(1);
      if (!p || p.status === 'CANCELLED') {
        throw new DomainError('NOT_FOUND', 'ไม่พบรายการตั้งหนี้ที่เลือก', 404);
      }
      if (p.poId !== inv.poId) {
        throw new DomainError(
          'PO_MISMATCH',
          'รายการตั้งหนี้ไม่ได้อยู่ในใบสั่งซื้อเดียวกันกับใบกำกับภาษี',
          400,
        );
      }

      // Check existing matches on this payable from other active invoices
      const existingMatches = await tx
        .select({ gross: invoicePayableMatches.gross })
        .from(invoicePayableMatches)
        .innerJoin(
          invoices,
          and(
            eq(invoices.id, invoicePayableMatches.invoiceId),
            eq(invoices.status, 'ACTIVE'),
          ),
        )
        .where(eq(invoicePayableMatches.payableId, p.id));

      const matchedSoFar = sum(existingMatches.map((r) => D(r.gross)));
      if (matchedSoFar.plus(matchGross).gt(D(p.gross))) {
        throw new DomainError(
          'MATCH_EXCEEDS_PAYABLE',
          'ยอดจับคู่รวมเกินยอดตั้งหนี้',
          400,
        );
      }

      await tx.insert(invoicePayableMatches).values({
        invoiceId: inv.id,
        payableId: p.id,
        gross: matchGross.toFixed(2),
      });
    }

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PO',
      entityId: inv.poId,
      action: 'INVOICE_MATCHED',
      data: { invoiceId: inv.id, invoiceNo: inv.invoiceNo },
    });

    await triggerPoAutoComplete(tx, inv.poId);
  });
}

export async function cancelInvoice(
  db: Db,
  actor: SessionUser,
  id: string,
  reason: string,
) {
  assertCan(actor, 'invoice.manage');
  if (!reason.trim()) {
    throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลในการยกเลิกใบแจ้งหนี้', 400);
  }

  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) throw new DomainError('NOT_FOUND', 'ไม่พบใบแจ้งหนี้', 404);
    if (inv.status === 'CANCELLED') return;

    // Check if there is a CREDIT_INVOICE payable linked to this invoice
    const linkedPayables = await tx
      .select()
      .from(payables)
      .where(and(eq(payables.invoiceId, inv.id), ne(payables.status, 'CANCELLED')));

    for (const p of linkedPayables) {
      if (p.status === 'IN_PV' || p.status === 'PAID') {
        throw new DomainError(
          'PAYABLE_IN_USE',
          'ไม่สามารถยกเลิกใบแจ้งหนี้ที่อยู่ในใบสำคัญจ่ายหรือจ่ายเงินแล้วได้',
          409,
        );
      }
      await tx
        .update(payables)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(eq(payables.id, p.id));
    }

    await tx
      .delete(invoicePayableMatches)
      .where(eq(invoicePayableMatches.invoiceId, inv.id));

    await tx
      .update(invoices)
      .set({
        status: 'CANCELLED',
        cancelReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PO',
      entityId: inv.poId,
      action: 'INVOICE_CANCELLED',
      note: reason.trim(),
      data: { invoiceId: inv.id, invoiceNo: inv.invoiceNo },
    });
  });
}

export interface PoMoneyFacts {
  poGross: Decimal;
  payablesGross: Decimal;
  taxInvoiceGross: Decimal;
  matchedGross: Decimal;
  pvPendingGross: Decimal;
  pvApprovedGross: Decimal;
  paidGross: Decimal;
  receivedGross: Decimal;
}

export async function poMoneyFacts(db: Db, poId: string): Promise<PoMoneyFacts> {
  const [po] = await db.select().from(pos).where(eq(pos.id, poId)).limit(1);
  if (!po) throw new DomainError('NOT_FOUND', 'ไม่พบใบสั่งซื้อ', 404);

  const activePayables = await db
    .select()
    .from(payables)
    .where(and(eq(payables.poId, poId), ne(payables.status, 'CANCELLED')));

  const payablesGross = sum(activePayables.map((p) => D(p.gross)));

  const activeTaxInvs = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.poId, poId),
        eq(invoices.status, 'ACTIVE'),
        eq(invoices.isTaxInvoice, true),
      ),
    );
  const taxInvoiceGross = sum(activeTaxInvs.map((i) => D(i.gross)));

  const matches = await db
    .select({ gross: invoicePayableMatches.gross })
    .from(invoicePayableMatches)
    .innerJoin(
      invoices,
      and(
        eq(invoices.id, invoicePayableMatches.invoiceId),
        eq(invoices.poId, poId),
        eq(invoices.status, 'ACTIVE'),
      ),
    );
  const matchedGross = sum(matches.map((m) => D(m.gross)));

  // PV amounts by status for this PO's payables
  const pvRows = await db
    .select({
      status: pvs.status,
      gross: pvLines.gross,
    })
    .from(pvLines)
    .innerJoin(payables, and(eq(payables.id, pvLines.payableId), eq(payables.poId, poId)))
    .innerJoin(pvs, and(eq(pvs.id, pvLines.pvId), ne(pvs.status, 'CANCELLED')));

  const pvPendingGross = sum(
    pvRows.filter((r) => r.status === 'PENDING_APPROVAL').map((r) => D(r.gross)),
  );
  const pvApprovedGross = sum(
    pvRows
      .filter((r) => r.status === 'APPROVED' || r.status === 'PAID')
      .map((r) => D(r.gross)),
  );
  const paidGross = sum(pvRows.filter((r) => r.status === 'PAID').map((r) => D(r.gross)));

  // Received gross = Σ over lines (receivedQty × unitGross), round2
  const lines = await db.select().from(poLines).where(eq(poLines.poId, poId));
  const recRows = await db
    .select({
      poLineId: receiptLines.poLineId,
      qty: receiptLines.qty,
    })
    .from(receiptLines)
    .innerJoin(
      receipts,
      and(
        eq(receipts.id, receiptLines.receiptId),
        eq(receipts.poId, poId),
        eq(receipts.status, 'CONFIRMED'),
      ),
    );

  const recByLine = new Map<string, Decimal>();
  for (const r of recRows) {
    recByLine.set(r.poLineId, (recByLine.get(r.poLineId) ?? D(0)).plus(D(r.qty)));
  }

  let receivedGross = D(0);
  for (const l of lines) {
    const recQty = recByLine.get(l.id) ?? D(0);
    const orderedQty = D(l.qty);
    if (orderedQty.gt(0) && recQty.eq(orderedQty)) {
      receivedGross = receivedGross.plus(D(l.gross));
    } else if (recQty.gt(0)) {
      receivedGross = receivedGross.plus(round2(recQty.times(D(l.unitGross))));
    }
  }
  receivedGross = round2(receivedGross);

  return {
    poGross: D(po.gross),
    payablesGross,
    taxInvoiceGross,
    matchedGross,
    pvPendingGross,
    pvApprovedGross,
    paidGross,
    receivedGross,
  };
}

export async function getPoSummary(db: Db, poId: string): Promise<PoSummary> {
  const [po] = await db.select().from(pos).where(eq(pos.id, poId)).limit(1);
  if (!po) throw new DomainError('NOT_FOUND', 'ไม่พบใบสั่งซื้อ', 404);

  const facts = await poMoneyFacts(db, poId);
  const lines = await db.select().from(poLines).where(eq(poLines.poId, poId));
  const recRows = await db
    .select({
      poLineId: receiptLines.poLineId,
      qty: receiptLines.qty,
    })
    .from(receiptLines)
    .innerJoin(
      receipts,
      and(
        eq(receipts.id, receiptLines.receiptId),
        eq(receipts.poId, poId),
        eq(receipts.status, 'CONFIRMED'),
      ),
    );

  const orderedQtyTotal = sum(lines.map((l) => D(l.qty)));
  const receivedQtyTotal = sum(recRows.map((r) => D(r.qty)));

  const insts = await db
    .select()
    .from(poInstallments)
    .where(eq(poInstallments.poId, poId));

  const refundDue = po.closedShort && facts.paidGross.gt(facts.poGross)
    ? round2(facts.paidGross.minus(facts.poGross))
    : D(0);

  return summarizePo({
    ...facts,
    orderedQtyTotal,
    receivedQtyTotal,
    paymentType: po.paymentType,
    installments: insts.map((i) => ({
      name: i.name,
      amount: D(i.amount),
      status: i.status,
    })),
    refundDue,
  });
}

// Register auto-complete hook: when PO is APPROVED or ORDERED and receiveStatus === FULL and payStatus === PAID, transition to COMPLETED
registerPoAutoCompleteHook(async (tx, poId) => {
  const [po] = await tx.select().from(pos).where(eq(pos.id, poId)).limit(1);
  if (!po || (po.status !== 'APPROVED' && po.status !== 'ORDERED')) return;

  const summary = await getPoSummary(tx, poId);
  if (
    summary.receiveStatus === 'FULL' &&
    summary.payStatus === 'PAID' &&
    summary.refundDue.lte(0)
  ) {
    await tx
      .update(pos)
      .set({ status: 'COMPLETED', updatedAt: new Date() })
      .where(eq(pos.id, poId));
  }
});

export async function listInvoices(
  db: Db,
  actor: SessionUser,
  filters?: { poId?: string; vendorId?: string },
) {
  assertCan(actor, 'invoice.manage');
  const rows = await db
    .select({
      invoice: invoices,
      poNumber: pos.number,
      poPaymentType: pos.paymentType,
      vendorName: vendors.name,
    })
    .from(invoices)
    .innerJoin(pos, eq(pos.id, invoices.poId))
    .innerJoin(vendors, eq(vendors.id, invoices.vendorId))
    .orderBy(desc(invoices.invoiceDate), desc(invoices.createdAt));

  return rows
    .filter((r) => {
      if (filters?.poId && r.invoice.poId !== filters.poId) return false;
      if (filters?.vendorId && r.invoice.vendorId !== filters.vendorId) return false;
      return true;
    })
    .map((r) => ({
      ...r.invoice,
      poNumber: r.poNumber,
      poPaymentType: r.poPaymentType,
      vendorName: r.vendorName,
    }));
}

export async function getInvoice(db: Db, actor: SessionUser, id: string) {
  assertCan(actor, 'invoice.manage');
  const [row] = await db
    .select({
      invoice: invoices,
      poNumber: pos.number,
      poPaymentType: pos.paymentType,
      vendorName: vendors.name,
    })
    .from(invoices)
    .innerJoin(pos, eq(pos.id, invoices.poId))
    .innerJoin(vendors, eq(vendors.id, invoices.vendorId))
    .where(eq(invoices.id, id))
    .limit(1);

  if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบใบแจ้งหนี้', 404);

  const matches = await db
    .select({
      match: invoicePayableMatches,
      payable: payables,
    })
    .from(invoicePayableMatches)
    .innerJoin(payables, eq(payables.id, invoicePayableMatches.payableId))
    .where(eq(invoicePayableMatches.invoiceId, id));

  const poPayables = await db
    .select()
    .from(payables)
    .where(and(eq(payables.poId, row.invoice.poId), ne(payables.status, 'CANCELLED')));

  return {
    ...row.invoice,
    poNumber: row.poNumber,
    poPaymentType: row.poPaymentType,
    vendorName: row.vendorName,
    matches: matches.map((m) => ({
      ...m.match,
      payable: m.payable,
    })),
    poPayables,
  };
}

export interface PoBillingInfo {
  poId: string;
  paymentType: string;
  creditDays: number | null;
  billingSchedule: string;
  creditBasis: 'INVOICE' | 'BILLING' | 'RECEIPT';
  chequeSchedule: string;
  /** Latest confirmed delivery; null when nothing has arrived */
  lastReceivedDate: string | null;
}

/** What the bill form needs to show the billing and due dates before saving */
export async function listPoBillingInfo(db: Db, actor: SessionUser, poIds: string[]): Promise<PoBillingInfo[]> {
  assertCan(actor, 'invoice.manage');
  if (poIds.length === 0) return [];
  const [terms, received] = await Promise.all([
    db
      .select({
        poId: pos.id,
        paymentType: pos.paymentType,
        creditDays: pos.creditDays,
        billingSchedule: pos.billingSchedule,
        creditBasis: pos.creditBasis,
        chequeSchedule: pos.chequeSchedule,
      })
      .from(pos)
      .where(inArray(pos.id, poIds)),
    db
      .select({ poId: receipts.poId, last: sql<string | null>`max(${receipts.receivedAt})` })
      .from(receipts)
      .where(and(inArray(receipts.poId, poIds), eq(receipts.status, 'CONFIRMED')))
      .groupBy(receipts.poId),
  ]);
  const lastByPo = new Map(received.map((r) => [r.poId, r.last ? String(r.last).slice(0, 10) : null]));
  return terms.map((t) => ({ ...t, lastReceivedDate: lastByPo.get(t.poId) ?? null }));
}
