import { D, Decimal, round2, sum } from './money';

/** A BOQ sheet row as edited in the UI. Empty numeric cells are `''`. */
export interface BoqRowInput {
  isCategory: boolean;
  qty: number | '';
  materialRate: number | '';
  laborRate: number | '';
}

export interface BoqLineAmounts {
  material: Decimal;
  labor: Decimal;
  total: Decimal;
}

export interface BoqTotals {
  materialTotal: Decimal;
  laborTotal: Decimal;
  directCost: Decimal;
  overheadAmount: Decimal;
  subtotal: Decimal;
  afterDiscount: Decimal;
  vatAmount: Decimal;
  grandTotal: Decimal;
}

function num(v: number | ''): Decimal {
  return v === '' ? D(0) : D(v);
}

export function computeBoqLine(row: BoqRowInput): BoqLineAmounts {
  if (row.isCategory) {
    return { material: D(0), labor: D(0), total: D(0) };
  }
  const qty = num(row.qty);
  const material = round2(qty.times(num(row.materialRate)));
  const labor = round2(qty.times(num(row.laborRate)));
  return { material, labor, total: material.plus(labor) };
}

/**
 * Sheet footer: direct cost → + overhead % → − discount (floored at 0) → + VAT %.
 * Each line amount is rounded to satang before summing, as on a printed BOQ.
 */
export function computeBoqTotals(input: {
  rows: BoqRowInput[];
  overheadPercent: number;
  discountAmount: number;
  vatPercent: number;
}): BoqTotals {
  const lines = input.rows.map(computeBoqLine);
  const materialTotal = sum(lines.map((l) => l.material));
  const laborTotal = sum(lines.map((l) => l.labor));
  const directCost = materialTotal.plus(laborTotal);
  const overheadAmount = round2(directCost.times(input.overheadPercent).div(100));
  const subtotal = directCost.plus(overheadAmount);
  const afterDiscount = Decimal.max(D(0), subtotal.minus(input.discountAmount));
  const vatAmount = round2(afterDiscount.times(input.vatPercent).div(100));
  return {
    materialTotal,
    laborTotal,
    directCost,
    overheadAmount,
    subtotal,
    afterDiscount,
    vatAmount,
    grandTotal: afterDiscount.plus(vatAmount),
  };
}
