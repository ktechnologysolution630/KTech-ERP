import { D, Decimal, round2, sum } from '@/domain/money';

/** Sales documents kept outside the milestone billing flow */
export type SalesDocKind = 'QT' | 'RC' | 'TI' | 'DN' | 'STI' | 'INC' | 'EXP';
export const SALES_DOC_KINDS: readonly SalesDocKind[] = ['QT', 'RC', 'TI', 'DN', 'STI', 'INC', 'EXP'];
/** Money comes in on these; EXP is money going out */
export const MONEY_IN_KINDS: readonly SalesDocKind[] = ['RC', 'INC'];

export const SALES_DOC_META: Record<SalesDocKind, { slug: string; th: string; en: string; hint: string; prefix: 'QT' | 'REC' | 'TI' | 'DN' | 'STI' | 'INC' | 'EXP' }> = {
  QT: { slug: 'quotations', th: 'ใบเสนอราคา', en: 'QUOTATION', hint: 'เสนอราคางานก่อสร้างให้ลูกค้าก่อนเปิดโครงการ', prefix: 'QT' },
  RC: { slug: 'receipts', th: 'ใบเสร็จรับเงิน', en: 'RECEIPT', hint: 'บันทึกการรับชำระเงินและออกใบเสร็จ', prefix: 'REC' },
  TI: { slug: 'tax-invoices', th: 'ใบกำกับภาษี', en: 'TAX INVOICE', hint: 'ออกใบกำกับภาษีขายให้ลูกค้า', prefix: 'TI' },
  DN: { slug: 'debit-notes', th: 'ใบเพิ่มหนี้', en: 'DEBIT NOTE', hint: 'เรียกเก็บเพิ่มจากใบกำกับภาษีที่ออกไปแล้ว', prefix: 'DN' },
  STI: { slug: 'abbreviated-tax-invoices', th: 'ใบกำกับภาษีอย่างย่อ', en: 'ABBREVIATED TAX INVOICE', hint: 'ใบกำกับภาษีอย่างย่อสำหรับขายปลีก ราคารวม VAT', prefix: 'STI' },
  INC: { slug: 'income', th: 'ใบสำคัญรับ', en: 'RECEIPT VOUCHER', hint: 'รายรับอื่นนอกจากงวดงาน เช่น ขายเศษวัสดุ ดอกเบี้ย ค่าเช่า', prefix: 'INC' },
  EXP: { slug: 'expense', th: 'ใบสำคัญจ่าย', en: 'PAYMENT VOUCHER', hint: 'ค่าวัสดุ ค่าแรง ค่าเช่า และค่าใช้จ่ายโครงการที่จ่ายตรง ไม่ผ่านใบสั่งซื้อ', prefix: 'EXP' },
};

export const kindFromSlug = (slug: string): SalesDocKind | null => SALES_DOC_KINDS.find((k) => SALES_DOC_META[k].slug === slug) ?? null;

export type SalesVatMode = 'EXCLUSIVE' | 'INCLUSIVE' | 'INCLUSIVE_HIDDEN' | 'NONE' | 'EXEMPT';
export const SALES_VAT_LABEL: Record<SalesVatMode, string> = {
  EXCLUSIVE: 'VAT 7% (แยก VAT)',
  INCLUSIVE: 'ราคารวม VAT 7%',
  INCLUSIVE_HIDDEN: 'ราคารวม VAT 7% (ไม่แสดงยอด VAT)',
  NONE: 'ไม่มี VAT',
  EXEMPT: 'ยกเว้น VAT',
};

export const ACCOUNT_CATEGORIES = ['รายได้ค่าก่อสร้าง', 'รายได้ค่าบริการ', 'รายได้ค่าออกแบบ', 'รายได้จากการขาย', 'รายได้อื่น'] as const;
export const EXPENSE_CATEGORIES = ['ค่าวัสดุ', 'ค่าแรง', 'ค่าผู้รับเหมาช่วง', 'ค่าเช่าเครื่องจักร', 'ค่าขนส่ง', 'ค่าสาธารณูปโภค', 'ค่าใช้จ่ายสำนักงาน', 'ค่าใช้จ่ายอื่น'] as const;

export interface SalesLineInput {
  isSection?: boolean;
  qty: number;
  unitPrice: number;
}

export interface SalesTotals {
  subtotal: Decimal;
  discount: Decimal;
  afterDiscount: Decimal;
  beforeVat: Decimal;
  vat: Decimal;
  total: Decimal;
  wht: Decimal;
  retention: Decimal;
  payable: Decimal;
}

const RATE = D('0.07');

/**
 * Totals of a sales document. Discount is a percent or an amount off the subtotal; VAT is added on
 * top (แยก VAT) or taken out of the price (ราคารวม VAT); withholding tax is on the amount before VAT.
 */
export function computeSalesTotals(input: {
  lines: SalesLineInput[];
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: number;
  vatMode: SalesVatMode;
  whtRate: number;
  /** หักประกันผลงาน, percent of the amount before VAT */
  retentionRate?: number;
}): SalesTotals {
  const subtotal = round2(sum(input.lines.filter((l) => !l.isSection).map((l) => round2(D(l.qty).times(D(l.unitPrice))))));
  const rawDiscount = input.discountType === 'PERCENT' ? subtotal.times(D(input.discountValue || 0)).div(100) : D(input.discountValue || 0);
  const discount = round2(Decimal.min(rawDiscount, subtotal));
  const afterDiscount = round2(subtotal.minus(discount));
  let beforeVat = afterDiscount;
  let vat = D(0);
  let total = afterDiscount;
  if (input.vatMode === 'EXCLUSIVE') {
    vat = round2(afterDiscount.times(RATE));
    total = round2(afterDiscount.plus(vat));
  } else if (input.vatMode === 'INCLUSIVE' || input.vatMode === 'INCLUSIVE_HIDDEN') {
    vat = round2(afterDiscount.times(RATE).div(D(1).plus(RATE)));
    beforeVat = round2(afterDiscount.minus(vat));
  }
  const wht = round2(beforeVat.times(D(input.whtRate || 0)).div(100));
  const retention = round2(beforeVat.times(D(input.retentionRate || 0)).div(100));
  return { subtotal, discount, afterDiscount, beforeVat, vat, total, wht, retention, payable: round2(total.minus(wht).minus(retention)) };
}
