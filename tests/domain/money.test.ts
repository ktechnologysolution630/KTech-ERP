import { describe, expect, test } from 'vitest';
import {
  D,
  round2,
  sum,
  allocate,
  computeDocTotals,
  computeWht,
  splitInstallments,
  parseDecimalInput,
  bahtText,
} from '@/domain/money';
import { DomainError } from '@/domain/errors';

describe('money domain', () => {
  test('exclusive VAT per line', () => {
    const t = computeDocTotals({
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        { qty: D(10), unitPrice: D(100), discount: D(0) },
        { qty: D(3), unitPrice: D('33.33'), discount: D(0) },
      ],
    });
    expect(t.beforeVat.toFixed(2)).toBe('1099.99');
    expect(t.vat.toFixed(2)).toBe('77.00'); // 70.00 + 7.00 (6.9993 → 7.00)
    expect(t.gross.toFixed(2)).toBe('1176.99');
  });

  test('inclusive VAT', () => {
    const t = computeDocTotals({
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ qty: D(1), unitPrice: D(107), discount: D(0) }],
    });
    expect([t.beforeVat.toFixed(2), t.vat.toFixed(2), t.gross.toFixed(2)]).toEqual([
      '100.00',
      '7.00',
      '107.00',
    ]);
  });

  test('bill discount and shipping allocated by amount', () => {
    const t = computeDocTotals({
      vatMode: 'NONE',
      billDiscount: D(10),
      shipping: D(4),
      lines: [
        { qty: D(1), unitPrice: D(300), discount: D(0) },
        { qty: D(1), unitPrice: D(100), discount: D(0) },
      ],
    });
    expect(t.lines.map((l) => l.gross.toFixed(2))).toEqual(['295.50', '98.50']);
    expect(t.gross.toFixed(2)).toBe('394.00');
  });

  test('allocate largest remainder', () => {
    expect(allocate(D(100), [D(1), D(1), D(1)]).map((x) => x.toFixed(2))).toEqual([
      '33.34',
      '33.33',
      '33.33',
    ]);
    expect(allocate(D(100), [D(0), D(0)]).map((x) => x.toFixed(2))).toEqual(['50.00', '50.00']);
  });

  test('wht on before-vat', () => {
    expect(computeWht(D(1000), 3).toFixed(2)).toBe('30.00');
    expect(computeWht(D('333.33'), 3).toFixed(2)).toBe('10.00');
    expect(round2(sum([D('1.005'), D('2.00')])).toFixed(2)).toBe('3.01');
  });

  test('wht rejects 4%', () => {
    expect(() => computeWht(D(100), 4)).toThrow(DomainError);
  });

  test('installments 20/30/40/10 last absorbs', () => {
    expect(
      splitInstallments(
        D('1000.01'),
        [20, 30, 40, 10].map((p) => ({ percent: D(p) })),
      ).map((x) => x.toFixed(2)),
    ).toEqual(['200.00', '300.00', '400.00', '100.01']);
  });

  test('installments must sum 100', () => {
    expect(() => splitInstallments(D(100), [{ percent: D(50) }])).toThrow(DomainError);
    expect(() =>
      splitInstallments(D(100), [{ amount: D(40) }, { amount: D(50) }]),
    ).toThrow(DomainError);
  });

  test('parse thai input', () => {
    expect(parseDecimalInput(' 1,234.50 ')!.toFixed(2)).toBe('1234.50');
    expect(parseDecimalInput('๑๒')!.toNumber()).toBe(12);
    expect(parseDecimalInput('abc')).toBeNull();
    expect(parseDecimalInput('')).toBeNull();
  });

  test('baht text', () => {
    expect(bahtText(D('1176.99'))).toBe('หนึ่งพันหนึ่งร้อยเจ็ดสิบหกบาทเก้าสิบเก้าสตางค์');
    expect(bahtText(D(21))).toBe('ยี่สิบเอ็ดบาทถ้วน');
    expect(bahtText(D(0))).toBe('ศูนย์บาทถ้วน');
    expect(bahtText(D(101))).toBe('หนึ่งร้อยเอ็ดบาทถ้วน');
  });
});
