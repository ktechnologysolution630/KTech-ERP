import { D, Decimal, round2, sum } from '@/domain/money';

/** Sales documents kept outside the milestone billing flow */
export type SalesDocKind = 'QT' | 'SO' | 'RC' | 'TI' | 'DN' | 'STI' | 'INC' | 'EXP';
export const SALES_DOC_KINDS: readonly SalesDocKind[] = ['QT', 'SO', 'RC', 'TI', 'DN', 'STI', 'INC', 'EXP'];
/** Money comes in on these; EXP is money going out */
export const MONEY_IN_KINDS: readonly SalesDocKind[] = ['RC', 'INC'];

export const SALES_DOC_META: Record<SalesDocKind, { slug: string; th: string; en: string; hint: string; prefix: 'QT' | 'SO' | 'REC' | 'TI' | 'DN' | 'STI' | 'INC' | 'EXP' }> = {
  QT: { slug: 'quotations', th: 'ใบเสนอราคา', en: 'QUOTATION', hint: 'เสนอราคางานก่อสร้างให้ลูกค้าก่อนเปิดโครงการ', prefix: 'QT' },
  SO: { slug: 'sales-orders', th: 'ใบสั่งขาย', en: 'SALES ORDER', hint: 'ยืนยันคำสั่งซื้อของลูกค้า ยังไม่ลงบัญชีและยังไม่ตัดสต็อก เปิดใบกำกับภาษีจากใบนี้ได้', prefix: 'SO' },
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

/** A category offered on a document, with the VAT and withholding tax its documents usually carry */
export interface CategoryOption {
  label: string;
  /** Absent on the built-in list, which says nothing about tax */
  vatDefault?: 'VAT7' | 'NONE';
  whtRate?: number;
}

export const categoryOptions = (rows: { code: string; name: string; vatDefault: 'VAT7' | 'NONE'; whtRate: string }[]): CategoryOption[] =>
  rows.map((c) => ({ label: `${c.code} ${c.name}`, vatDefault: c.vatDefault, whtRate: Number(c.whtRate) }));

/**
 * แปลงเอกสาร (Express: QT → SO → IV): the kinds a document can be carried into, copying its customer
 * and lines. The tax invoice (TI) is the credit sale that cuts stock and sets up the receivable.
 */
export const CONVERT_TO: Partial<Record<SalesDocKind, readonly SalesDocKind[]>> = {
  QT: ['SO', 'TI'],
  SO: ['TI'],
  // รับชำระ (RE): a receipt against a credit tax invoice collects its receivable
  TI: ['RC'],
};

/**
 * A receipt opened from a tax invoice only collects money the invoice already booked: it clears
 * ลูกหนี้ instead of booking the sale and output VAT a second time.
 */
export const settlesInvoice = (kind: SalesDocKind, sourceKind: SalesDocKind | null | undefined) => kind === 'RC' && sourceKind === 'TI';
export const canConvert = (from: SalesDocKind, to: SalesDocKind) => (CONVERT_TO[from] ?? []).includes(to);

/** Sales that hand goods over: lines tied to a stock item are cut from stock and costed (ต้นทุนขาย) */
export const STOCK_CUT_KINDS: readonly SalesDocKind[] = ['TI', 'STI'];

export interface SalesLineInput {
  isSection?: boolean;
  qty: number;
  unitPrice: number;
  /** ส่วนลดรายบรรทัด in baht, taken off qty × price */
  discount?: number;
}

/** A line's amount: qty × price less its own discount, never below zero */
export function lineAmount(l: SalesLineInput): Decimal {
  if (l.isSection) return D(0);
  const gross = round2(D(l.qty).times(D(l.unitPrice)));
  return round2(gross.minus(Decimal.min(D(l.discount || 0), gross)));
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
 * Totals of a sales document. Each line carries its own discount first; the bill discount is a percent or an amount off the subtotal; VAT is added on
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
  const subtotal = round2(sum(input.lines.filter((l) => !l.isSection).map(lineAmount)));
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
