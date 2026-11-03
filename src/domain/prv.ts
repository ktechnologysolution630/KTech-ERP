import { D, Decimal, round2, sum } from './money';

export interface PrvLineAmountInput {
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
  /** Share of the line claimed in this request (payment certificate progress), 0–100 */
  progressPercent: Decimal.Value;
}

export interface PrvTotals {
  lineAmounts: Decimal[];
  /** Value of work claimed this time */
  total: Decimal;
  retention: Decimal;
  /** Amount actually paid now, before VAT (total − retention); WHT is withheld on this */
  payableBeforeVat: Decimal;
  wht: Decimal;
  /** VAT is charged on the full claimed value */
  vat: Decimal;
  /** total − retention − WHT + VAT */
  net: Decimal;
}

/**
 * Payment certificate maths. Retention is held back from this payment; WHT is withheld on
 * what is paid now (before VAT), matching how the PV later computes it from the payable.
 */
export function computePrvTotals(
  lines: PrvLineAmountInput[],
  rates: { retentionPercent: Decimal.Value; whtRate: Decimal.Value; vatRate: Decimal.Value },
): PrvTotals {
  const lineAmounts = lines.map((l) => round2(D(l.quantity).times(l.unitPrice).times(l.progressPercent).div(100)));
  const total = sum(lineAmounts);
  const retention = round2(total.times(rates.retentionPercent).div(100));
  const payableBeforeVat = total.minus(retention);
  const wht = round2(payableBeforeVat.times(rates.whtRate).div(100));
  const vat = round2(total.times(rates.vatRate).div(100));
  return { lineAmounts, total, retention, payableBeforeVat, wht, vat, net: payableBeforeVat.minus(wht).plus(vat) };
}

export const PRV_CATEGORY_LABELS: Record<string, string> = {
  CONTRACTOR_PROGRESS: 'งวดงานผู้รับเหมา',
  EXPENSE: 'ค่าใช้จ่ายทั่วไปของโครงการ',
  PETTY_CASH: 'เบิกชดเชยเงินสดย่อย',
  // Legacy categories (PO payments go through the PO / invoice flow instead)
  PO_ADVANCE: 'มัดจำล่วงหน้า PO',
  PO_CREDIT: 'ค่าของเครดิต PO',
};

/** Categories that can be raised now; PO-related payments are handled by the PO flow. */
export const PRV_NEW_CATEGORIES = ['CONTRACTOR_PROGRESS', 'EXPENSE', 'PETTY_CASH'] as const;
