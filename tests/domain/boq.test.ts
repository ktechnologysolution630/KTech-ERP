import { describe, expect, test } from 'vitest';
import { computeBoqLine, computeBoqTotals } from '@/domain/boq';

describe('boq totals', () => {
  test('category rows and empty cells contribute nothing', () => {
    expect(computeBoqLine({ isCategory: true, qty: 5, materialRate: 10, laborRate: 1 }).total.toFixed(2)).toBe(
      '0.00',
    );
    expect(computeBoqLine({ isCategory: false, qty: '', materialRate: 10, laborRate: 1 }).total.toFixed(2)).toBe(
      '0.00',
    );
  });

  test('line amounts round to satang before summing', () => {
    // 0.333 × 10.01 = 3.33333 → 3.33 per line; three lines → 9.99, not 10.00
    const row = { isCategory: false, qty: 0.333, materialRate: 10.01, laborRate: '' as const };
    const t = computeBoqTotals({
      rows: [row, row, row],
      overheadPercent: 0,
      discountAmount: 0,
      vatPercent: 0,
    });
    expect(t.materialTotal.toFixed(2)).toBe('9.99');
  });

  test('overhead, discount and VAT apply in order', () => {
    const t = computeBoqTotals({
      rows: [
        { isCategory: true, qty: '', materialRate: '', laborRate: '' },
        { isCategory: false, qty: 84, materialRate: 18500, laborRate: 4500 },
      ],
      overheadPercent: 10,
      discountAmount: 32_000,
      vatPercent: 7,
    });
    expect(t.directCost.toFixed(2)).toBe('1932000.00');
    expect(t.overheadAmount.toFixed(2)).toBe('193200.00');
    expect(t.subtotal.toFixed(2)).toBe('2125200.00');
    expect(t.afterDiscount.toFixed(2)).toBe('2093200.00');
    expect(t.vatAmount.toFixed(2)).toBe('146524.00');
    expect(t.grandTotal.toFixed(2)).toBe('2239724.00');
  });

  test('discount larger than subtotal floors at zero', () => {
    const t = computeBoqTotals({
      rows: [{ isCategory: false, qty: 1, materialRate: 100, laborRate: 0 }],
      overheadPercent: 0,
      discountAmount: 500,
      vatPercent: 7,
    });
    expect(t.afterDiscount.toFixed(2)).toBe('0.00');
    expect(t.grandTotal.toFixed(2)).toBe('0.00');
  });
});
