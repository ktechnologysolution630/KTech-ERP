import Decimal from 'decimal.js';
import { DomainError } from './errors';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type VatMode = 'EXCLUSIVE' | 'INCLUSIVE' | 'NONE';
export const VAT_RATE = 7;
export const WHT_RATES = [0, 1, 2, 3, 5] as const;
export type WhtRate = (typeof WHT_RATES)[number];

export function D(v: Decimal.Value): Decimal {
  return new Decimal(v);
}

export function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sum(ds: Decimal[]): Decimal {
  return ds.reduce((acc, cur) => acc.plus(cur), D(0));
}

/**
 * Largest-remainder allocation to 2 decimal places so results sum to `amount`.
 * When all weights are 0, splits equally.
 */
export function allocate(amount: Decimal, weights: Decimal[]): Decimal[] {
  const target = round2(amount);
  const n = weights.length;
  if (n === 0) return [];
  const totalWeight = sum(weights);
  const effectiveWeights = totalWeight.isZero() ? weights.map(() => D(1)) : weights;
  const effSum = sum(effectiveWeights);

  const sign = target.isNegative() ? -1 : 1;
  const absCents = target.abs().times(100).round().toNumber();

  const exactCents = effectiveWeights.map((w) => w.times(absCents).div(effSum));
  const floored = exactCents.map((x) => x.floor().toNumber());
  const remainders = exactCents.map((x, idx) => ({
    idx,
    rem: x.minus(floored[idx]),
  }));

  const leftover = absCents - floored.reduce((a, b) => a + b, 0);
  remainders.sort((a, b) => {
    const cmp = b.rem.comparedTo(a.rem);
    return cmp !== 0 ? cmp : a.idx - b.idx;
  });

  for (let i = 0; i < leftover; i++) {
    floored[remainders[i].idx] += 1;
  }

  return floored.map((c) => D(c * sign).div(100));
}

export interface DocLineInput {
  qty: Decimal;
  unitPrice: Decimal;
  discount: Decimal;
}

export interface ComputedDocLine {
  amount: Decimal;
  allocatedBeforeVat: Decimal;
  vat: Decimal;
  gross: Decimal;
  unitGross: Decimal;
}

export interface DocTotals {
  subtotal: Decimal;
  billDiscount: Decimal;
  shipping: Decimal;
  beforeVat: Decimal;
  vat: Decimal;
  gross: Decimal;
  lines: ComputedDocLine[];
}

export function computeDocTotals(input: {
  lines: DocLineInput[];
  billDiscount: Decimal;
  shipping: Decimal;
  vatMode: VatMode;
}): DocTotals {
  const billDiscount = round2(input.billDiscount);
  const shipping = round2(input.shipping);

  const lineAmounts = input.lines.map((l) =>
    round2(l.qty.times(l.unitPrice).minus(l.discount)),
  );
  const subtotal = sum(lineAmounts);

  const allocDiscounts = allocate(billDiscount, lineAmounts);
  const allocShippings = allocate(shipping, lineAmounts);

  const computedLines: ComputedDocLine[] = input.lines.map((l, idx) => {
    const amount = lineAmounts[idx];
    const netAllocated = round2(amount.minus(allocDiscounts[idx]).plus(allocShippings[idx]));

    let allocatedBeforeVat: Decimal;
    let vat: Decimal;
    let gross: Decimal;

    if (input.vatMode === 'EXCLUSIVE') {
      allocatedBeforeVat = netAllocated;
      vat = round2(allocatedBeforeVat.times(VAT_RATE).div(100));
      gross = round2(allocatedBeforeVat.plus(vat));
    } else if (input.vatMode === 'INCLUSIVE') {
      gross = netAllocated;
      allocatedBeforeVat = round2(gross.times(100).div(100 + VAT_RATE));
      vat = round2(gross.minus(allocatedBeforeVat));
    } else {
      allocatedBeforeVat = netAllocated;
      vat = D(0);
      gross = netAllocated;
    }

    const unitGross = l.qty.isZero() ? D(0) : gross.div(l.qty);

    return {
      amount,
      allocatedBeforeVat,
      vat,
      gross,
      unitGross,
    };
  });

  const beforeVat = sum(computedLines.map((l) => l.allocatedBeforeVat));
  const vat = sum(computedLines.map((l) => l.vat));
  const gross = sum(computedLines.map((l) => l.gross));

  return {
    subtotal,
    billDiscount,
    shipping,
    beforeVat,
    vat,
    gross,
    lines: computedLines,
  };
}

export function computeWht(beforeVat: Decimal, ratePct: number): Decimal {
  if (!(WHT_RATES as readonly number[]).includes(ratePct)) {
    throw new DomainError('INVALID_WHT_RATE', 'อัตราภาษีหัก ณ ที่จ่ายไม่ถูกต้อง (ต้องเป็น 0, 1, 2, 3 หรือ 5%)');
  }
  if (ratePct === 0) return D(0);
  return round2(beforeVat.times(ratePct).div(100));
}

export type InstallmentPartInput = { percent: Decimal } | { amount: Decimal };

export function splitInstallments(total: Decimal, parts: InstallmentPartInput[]): Decimal[] {
  const target = round2(total);
  if (parts.length === 0) {
    throw new DomainError('INSTALLMENT_SUM', 'ต้องมีอย่างน้อย 1 งวด');
  }

  const isPercentList = parts.map((p) => 'percent' in p);
  const firstIsPercent = isPercentList[0];
  if (isPercentList.some((b) => b !== firstIsPercent)) {
    throw new DomainError('INSTALLMENT_SUM', 'ห้ามปนรูปแบบเปอร์เซ็นต์และจำนวนเงินในตารางงวดเดียวกัน');
  }

  if (firstIsPercent) {
    const percents = (parts as { percent: Decimal }[]).map((p) => p.percent);
    if (percents.some((p) => p.lte(0))) {
      throw new DomainError('INSTALLMENT_SUM', 'เปอร์เซ็นต์แต่ละงวดต้องมากกว่า 0');
    }
    const pctSum = round2(sum(percents));
    if (!pctSum.equals(D(100))) {
      throw new DomainError('INSTALLMENT_SUM', 'ผลรวมเปอร์เซ็นต์ทุกงวดต้องเท่ากับ 100%');
    }
    const amounts = percents.map((p) => round2(target.times(p).div(100)));
    const headSum = sum(amounts.slice(0, -1));
    amounts[amounts.length - 1] = round2(target.minus(headSum));
    return amounts;
  } else {
    const amounts = (parts as { amount: Decimal }[]).map((p) => round2(p.amount));
    if (amounts.some((a) => a.lte(0))) {
      throw new DomainError('INSTALLMENT_SUM', 'จำนวนเงินแต่ละงวดต้องมากกว่า 0');
    }
    const amtSum = round2(sum(amounts));
    if (!amtSum.equals(target)) {
      throw new DomainError('INSTALLMENT_SUM', 'ผลรวมจำนวนเงินทุกงวดต้องเท่ากับยอดสุทธิของ PO');
    }
    return amounts;
  }
}

const THAI_DIGIT_MAP: Record<string, string> = {
  '๐': '0',
  '๑': '1',
  '๒': '2',
  '๓': '3',
  '๔': '4',
  '๕': '5',
  '๖': '6',
  '๗': '7',
  '๘': '8',
  '๙': '9',
};

export function parseDecimalInput(s: string): Decimal | null {
  if (typeof s !== 'string') return null;
  const converted = s
    .trim()
    .replace(/[๐-๙]/g, (ch) => THAI_DIGIT_MAP[ch] ?? ch)
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (!converted || !/^-?\d+(\.\d+)?$/.test(converted)) {
    return null;
  }
  try {
    const d = new Decimal(converted);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** "1234567.5" → "1,234,567.50". Pure, so server pages and client components can both use it. */
export function formatMoneyDisplay(value: string | number | undefined | null, decimals = 2): string {
  if (value === undefined || value === null || value === '') return '';
  // A very small number prints as 2e-8, which input parsing rightly refuses
  const d = typeof value === 'number' && Number.isFinite(value) ? D(value) : parseDecimalInput(String(value));
  if (!d) return String(value);
  const parts = d.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

const THAI_NUM_WORDS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_POS_WORDS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

function readBelowMillion(n: number): string {
  if (n === 0) return '';
  const digits = String(n).split('').map(Number);
  const len = digits.length;
  let out = '';
  for (let i = 0; i < len; i++) {
    const d = digits[i];
    const pos = len - 1 - i;
    if (d === 0) continue;
    if (pos === 1) {
      if (d === 1) out += 'สิบ';
      else if (d === 2) out += 'ยี่สิบ';
      else out += THAI_NUM_WORDS[d] + 'สิบ';
    } else if (pos === 0) {
      if (d === 1 && len > 1) out += 'เอ็ด';
      else out += THAI_NUM_WORDS[d];
    } else {
      out += THAI_NUM_WORDS[d] + THAI_POS_WORDS[pos];
    }
  }
  return out;
}

function readIntegerThai(numStr: string): string {
  const clean = numStr.replace(/^0+/, '');
  if (!clean) return 'ศูนย์';
  const groups: number[] = [];
  for (let end = clean.length; end > 0; end -= 6) {
    const start = Math.max(0, end - 6);
    groups.unshift(Number(clean.slice(start, end)));
  }
  return groups
    .map((g, idx) => {
      const text = readBelowMillion(g);
      const isLast = idx === groups.length - 1;
      if (!isLast) return text + 'ล้าน';
      return text;
    })
    .join('');
}

export function bahtText(d: Decimal): string {
  const rounded = round2(d.abs());
  const [intPart, decPart] = rounded.toFixed(2).split('.');
  const intNum = Number(intPart);
  const satang = Number(decPart);

  const prefix = d.isNegative() && !rounded.isZero() ? 'ลบ' : '';
  if (intNum === 0 && satang === 0) {
    return 'ศูนย์บาทถ้วน';
  }
  const bahtWords = intNum > 0 ? `${readIntegerThai(intPart)}บาท` : '';
  const satangWords = satang === 0 ? 'ถ้วน' : `${readBelowMillion(satang)}สตางค์`;
  return `${prefix}${bahtWords}${satangWords}`;
}
