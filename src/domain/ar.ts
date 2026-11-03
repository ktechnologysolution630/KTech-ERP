import { computeDocTotals, D, Decimal, round2, type VatMode } from './money';

export const AR_INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIAL', 'PAID', 'VOID'] as const;
export type ArInvoiceStatus = (typeof AR_INVOICE_STATUSES)[number];

export const AR_INVOICE_STATUS_LABELS: Record<ArInvoiceStatus, string> = {
  DRAFT: 'ร่าง',
  ISSUED: 'วางบิลแล้ว',
  PARTIAL: 'รับชำระบางส่วน',
  PAID: 'ชำระครบ',
  VOID: 'ยกเลิก',
};

export const PAY_METHODS = ['TRANSFER', 'CHEQUE', 'CASH'] as const;
export type ArPayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABELS: Record<ArPayMethod, string> = {
  TRANSFER: 'โอนเงิน',
  CHEQUE: 'เช็ค',
  CASH: 'เงินสด',
};

export interface ArLineInput {
  qty: Decimal.Value;
  unitPrice: Decimal.Value;
}

export interface ArInvoiceTotals {
  beforeVat: Decimal;
  vat: Decimal;
  gross: Decimal;
  lineAmounts: Decimal[];
}

export function computeArInvoiceTotals(lines: ArLineInput[], vatMode: VatMode): ArInvoiceTotals {
  const t = computeDocTotals({
    vatMode,
    billDiscount: D(0),
    shipping: D(0),
    lines: lines.map((l) => ({ qty: D(l.qty), unitPrice: D(l.unitPrice), discount: D(0) })),
  });
  return { beforeVat: t.beforeVat, vat: t.vat, gross: t.gross, lineAmounts: t.lines.map((l) => l.amount) };
}

/**
 * Splits an amount of the invoice's gross into base and VAT in the invoice's own ratio.
 * Construction services hit the VAT tax point when paid, so each receipt (and each credit note)
 * carries its proportional share of the invoice VAT; the last one absorbs rounding.
 */
export function splitByInvoiceVat(
  amountGross: Decimal.Value,
  invoice: { vat: Decimal.Value; gross: Decimal.Value },
): { beforeVat: Decimal; vat: Decimal } {
  const amount = D(amountGross);
  const gross = D(invoice.gross);
  const vat = gross.isZero() ? D(0) : round2(amount.times(invoice.vat).div(gross));
  return { beforeVat: amount.minus(vat), vat };
}

/** What the customer still owes on an invoice (retention included until it is received). */
export function invoiceBalance(input: {
  gross: Decimal.Value;
  credited: Decimal.Value;
  settled: Decimal.Value;
}): Decimal {
  return D(input.gross).minus(input.credited).minus(input.settled);
}

export type AgingBucket = 'NOT_DUE' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

export const AGING_LABELS: Record<AgingBucket, string> = {
  NOT_DUE: 'ยังไม่ถึงกำหนด',
  D1_30: '1–30 วัน',
  D31_60: '31–60 วัน',
  D61_90: '61–90 วัน',
  D90_PLUS: 'เกิน 90 วัน',
};

/** Days past due on `today` (ISO dates); not-yet-due and due-today are NOT_DUE. */
export function agingBucket(dueDate: string, today: string): { bucket: AgingBucket; daysOverdue: number } {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return { bucket: 'NOT_DUE', daysOverdue: 0 };
  if (days <= 30) return { bucket: 'D1_30', daysOverdue: days };
  if (days <= 60) return { bucket: 'D31_60', daysOverdue: days };
  if (days <= 90) return { bucket: 'D61_90', daysOverdue: days };
  return { bucket: 'D90_PLUS', daysOverdue: days };
}

/** Invoice status after money or credits move against it. Drafts and voided invoices are not touched. */
export function settledStatus(current: ArInvoiceStatus, balance: Decimal, settledOrCredited: Decimal): ArInvoiceStatus {
  if (current === 'DRAFT' || current === 'VOID') return current;
  if (balance.lte(0)) return 'PAID';
  return settledOrCredited.gt(0) ? 'PARTIAL' : 'ISSUED';
}
