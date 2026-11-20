import { D, Decimal, round2, sum } from './money';
import { DomainError } from './errors';

/**
 * The general ledger: the chart of accounts, and the rules that turn each approved document into a
 * double-entry journal (Auto-GL), as in Express. The rules are pure so they can be read and tested
 * on their own; the service resolves the account keys to the company's accounts and stores them.
 */

export type GlAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export const GL_ACCOUNT_TYPES: readonly GlAccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
export const GL_ACCOUNT_TYPE_LABEL: Record<GlAccountType, string> = {
  ASSET: 'สินทรัพย์',
  LIABILITY: 'หนี้สิน',
  EQUITY: 'ส่วนของเจ้าของ',
  INCOME: 'รายได้',
  EXPENSE: 'ค่าใช้จ่าย',
};
/** Accounts whose balance is normally on the debit side */
export const isDebitNature = (t: GlAccountType) => t === 'ASSET' || t === 'EXPENSE';

/** สมุดรายวัน the entry belongs to, as Express keeps them */
export type GlBook = 'PU' | 'SA' | 'RV' | 'PS' | 'GL';
export const GL_BOOK_LABEL: Record<GlBook, string> = {
  PU: 'สมุดรายวันซื้อ',
  SA: 'สมุดรายวันขาย',
  RV: 'สมุดรายวันรับเงิน',
  PS: 'สมุดรายวันจ่ายเงิน',
  GL: 'สมุดรายวันทั่วไป',
};

/** The document a journal entry was made from */
export type JournalSource = 'AP_INVOICE' | 'AP_CREDIT_NOTE' | 'PV' | 'AR_INVOICE' | 'AR_RECEIPT' | 'AR_CREDIT_NOTE' | 'SALES_DOC' | 'STOCK_ADJUST' | 'OPENING' | 'YEAR_CLOSE' | 'MANUAL';
export const JOURNAL_SOURCE_LABEL: Record<JournalSource, string> = {
  AP_INVOICE: 'ซื้อเชื่อ/รับสินค้า (RR)',
  AP_CREDIT_NOTE: 'ใบลดหนี้ผู้ขาย/ส่งคืนสินค้า',
  PV: 'ใบสำคัญจ่าย (PV)',
  AR_INVOICE: 'ขายเชื่อ/ใบแจ้งหนี้ (IV)',
  AR_RECEIPT: 'ใบเสร็จรับเงิน (RE)',
  AR_CREDIT_NOTE: 'ใบลดหนี้',
  SALES_DOC: 'เอกสารขาย/รับ-จ่าย',
  STOCK_ADJUST: 'ปรับปรุงสต็อก (AJ)',
  OPENING: 'ยอดยกมา',
  YEAR_CLOSE: 'ปิดบัญชีสิ้นปี',
  MANUAL: 'บันทึกด้วยมือ',
};

/** The accounts the automatic postings use; each maps to one account of the chart */
export type SystemAccountKey =
  | 'CASH'
  | 'BANK'
  | 'AR'
  | 'RETENTION_AR'
  | 'VAT_INPUT'
  | 'VAT_INPUT_UNDUE'
  | 'WHT_RECEIVABLE'
  | 'INVENTORY'
  | 'AP'
  | 'VAT_OUTPUT'
  | 'VAT_OUTPUT_UNDUE'
  | 'WHT_PAYABLE'
  | 'SALES'
  | 'SALES_RETURN'
  | 'OTHER_INCOME'
  | 'PURCHASE'
  | 'COGS'
  | 'LABOR_COST'
  | 'EXPENSE'
  | 'STOCK_ADJUST'
  | 'RETAINED_EARNINGS';

export const SYSTEM_ACCOUNT_LABEL: Record<SystemAccountKey, string> = {
  CASH: 'เงินสด',
  BANK: 'เงินฝากธนาคาร',
  AR: 'ลูกหนี้การค้า',
  RETENTION_AR: 'ลูกหนี้เงินประกันผลงาน',
  VAT_INPUT: 'ภาษีซื้อ',
  VAT_INPUT_UNDUE: 'ภาษีซื้อยังไม่ถึงกำหนด',
  WHT_RECEIVABLE: 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย',
  INVENTORY: 'สินค้าคงเหลือ',
  AP: 'เจ้าหนี้การค้า',
  VAT_OUTPUT: 'ภาษีขาย',
  VAT_OUTPUT_UNDUE: 'ภาษีขายยังไม่ถึงกำหนด',
  WHT_PAYABLE: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย',
  SALES: 'รายได้จากการขาย/บริการ',
  SALES_RETURN: 'รับคืนสินค้า/ส่วนลดจ่าย',
  OTHER_INCOME: 'รายได้อื่น',
  PURCHASE: 'ซื้อสินค้า/ต้นทุนวัสดุ',
  COGS: 'ต้นทุนขาย',
  LABOR_COST: 'ค่าแรงและผู้รับเหมาช่วง',
  EXPENSE: 'ค่าใช้จ่ายทั่วไป',
  STOCK_ADJUST: 'กำไร(ขาดทุน)จากการปรับปรุงสต็อก',
  RETAINED_EARNINGS: 'กำไร(ขาดทุน)สะสม',
};

/** The chart a new company starts with (Thai standard numbering); seeded by the migration */
export const DEFAULT_CHART: { code: string; name: string; type: GlAccountType; systemKey?: SystemAccountKey }[] = [
  { code: '1110', name: 'เงินสด', type: 'ASSET', systemKey: 'CASH' },
  { code: '1120', name: 'เงินฝากธนาคาร', type: 'ASSET', systemKey: 'BANK' },
  { code: '1130', name: 'ลูกหนี้การค้า', type: 'ASSET', systemKey: 'AR' },
  { code: '1135', name: 'ลูกหนี้เงินประกันผลงาน', type: 'ASSET', systemKey: 'RETENTION_AR' },
  { code: '1140', name: 'ภาษีซื้อ', type: 'ASSET', systemKey: 'VAT_INPUT' },
  { code: '1141', name: 'ภาษีซื้อยังไม่ถึงกำหนด', type: 'ASSET', systemKey: 'VAT_INPUT_UNDUE' },
  { code: '1145', name: 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย', type: 'ASSET', systemKey: 'WHT_RECEIVABLE' },
  { code: '1150', name: 'สินค้าคงเหลือ', type: 'ASSET', systemKey: 'INVENTORY' },
  { code: '1160', name: 'เงินจ่ายล่วงหน้า', type: 'ASSET' },
  { code: '1210', name: 'อุปกรณ์และเครื่องมือ', type: 'ASSET' },
  { code: '2110', name: 'เจ้าหนี้การค้า', type: 'LIABILITY', systemKey: 'AP' },
  { code: '2120', name: 'ภาษีขาย', type: 'LIABILITY', systemKey: 'VAT_OUTPUT' },
  { code: '2121', name: 'ภาษีขายยังไม่ถึงกำหนด', type: 'LIABILITY', systemKey: 'VAT_OUTPUT_UNDUE' },
  { code: '2130', name: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', type: 'LIABILITY', systemKey: 'WHT_PAYABLE' },
  { code: '2140', name: 'ค่าใช้จ่ายค้างจ่าย', type: 'LIABILITY' },
  { code: '3100', name: 'ทุนจดทะเบียน', type: 'EQUITY' },
  { code: '3200', name: 'กำไร(ขาดทุน)สะสม', type: 'EQUITY', systemKey: 'RETAINED_EARNINGS' },
  { code: '4100', name: 'รายได้จากการขาย/บริการ', type: 'INCOME', systemKey: 'SALES' },
  { code: '4110', name: 'รับคืนสินค้า/ส่วนลดจ่าย', type: 'INCOME', systemKey: 'SALES_RETURN' },
  { code: '4900', name: 'รายได้อื่น', type: 'INCOME', systemKey: 'OTHER_INCOME' },
  { code: '5100', name: 'ซื้อสินค้า/ต้นทุนวัสดุ', type: 'EXPENSE', systemKey: 'PURCHASE' },
  { code: '5110', name: 'ต้นทุนขาย', type: 'EXPENSE', systemKey: 'COGS' },
  { code: '5200', name: 'ค่าแรงและผู้รับเหมาช่วง', type: 'EXPENSE', systemKey: 'LABOR_COST' },
  { code: '5300', name: 'ค่าใช้จ่ายทั่วไป', type: 'EXPENSE', systemKey: 'EXPENSE' },
  { code: '5310', name: 'กำไร(ขาดทุน)จากการปรับปรุงสต็อก', type: 'EXPENSE', systemKey: 'STOCK_ADJUST' },
];

export interface DraftLine {
  account: SystemAccountKey;
  debit: Decimal;
  credit: Decimal;
  memo?: string;
}

export interface EntryDraft {
  date: string;
  book: GlBook;
  sourceNumber: string;
  description: string;
  partyName: string;
  projectId: string | null;
  lines: DraftLine[];
}

const dr = (account: SystemAccountKey, amount: Decimal.Value, memo?: string): DraftLine => ({ account, debit: round2(D(amount)), credit: D(0), memo });
const cr = (account: SystemAccountKey, amount: Decimal.Value, memo?: string): DraftLine => ({ account, debit: D(0), credit: round2(D(amount)), memo });

/**
 * Drops empty lines, turns a negative amount into the other side, and checks debits equal credits.
 * An entry that does not balance is a bug in a rule, never something to store.
 */
export function finishLines(lines: DraftLine[]): DraftLine[] {
  const out = lines
    .map((l) => {
      const net = l.debit.minus(l.credit);
      return net.isNegative() ? { ...l, debit: D(0), credit: net.abs() } : { ...l, debit: net, credit: D(0) };
    })
    .filter((l) => !l.debit.isZero() || !l.credit.isZero());
  const debit = sum(out.map((l) => l.debit));
  const credit = sum(out.map((l) => l.credit));
  if (!debit.eq(credit)) {
    throw new DomainError('GL_UNBALANCED', `รายการบัญชีไม่สมดุล (เดบิต ${debit.toFixed(2)} / เครดิต ${credit.toFixed(2)})`, 409);
  }
  return out;
}

const cashOrBank = (method: string | null | undefined): SystemAccountKey => (method === 'CASH' ? 'CASH' : 'BANK');

/**
 * ซื้อเชื่อ (RR): a supplier's bill against a PO.
 * Dr สินค้าคงเหลือ (goods into stock) or ซื้อ/ต้นทุนวัสดุ, Dr ภาษีซื้อ / Cr เจ้าหนี้การค้า.
 * A bill that is not a tax invoice has no VAT to claim, so its VAT is part of the cost.
 */
export function apInvoiceLines(input: { beforeVat: Decimal.Value; vat: Decimal.Value; gross: Decimal.Value; isTaxInvoice: boolean; toInventory: boolean }): DraftLine[] {
  const cost: SystemAccountKey = input.toInventory ? 'INVENTORY' : 'PURCHASE';
  return finishLines([
    dr(cost, input.beforeVat),
    input.isTaxInvoice ? dr('VAT_INPUT', input.vat) : dr(cost, input.vat),
    cr('AP', input.gross),
  ]);
}

/**
 * ใบลดหนี้ผู้ขาย / ส่งคืนสินค้า: the reverse of the bill it reduces.
 * Dr เจ้าหนี้การค้า / Cr สินค้าคงเหลือ or ซื้อ, Cr ภาษีซื้อ (a bill with no tax invoice had its VAT in the cost).
 */
export function apCreditNoteLines(input: { beforeVat: Decimal.Value; vat: Decimal.Value; gross: Decimal.Value; isTaxInvoice: boolean; toInventory: boolean }): DraftLine[] {
  const cost: SystemAccountKey = input.toInventory ? 'INVENTORY' : 'PURCHASE';
  return finishLines([
    dr('AP', input.gross),
    cr(cost, input.beforeVat),
    input.isTaxInvoice ? cr('VAT_INPUT', input.vat) : cr(cost, input.vat),
  ]);
}

/** Bills whose debt was already booked to เจ้าหนี้การค้า (by the RR, or to be offset by a later bill) */
const AP_SOURCES = new Set(['CREDIT_INVOICE', 'PREPAID_REQUEST', 'INSTALLMENT', 'CREDIT_NOTE', 'OPENING']);

/**
 * ใบสำคัญจ่าย (PV), when it is paid. Purchase bills clear เจ้าหนี้การค้า; labour, contractor claims and
 * direct expenses never went through a bill, so they are expensed here with their VAT.
 * Cr เงินฝาก/เงินสด for the money paid and ภาษีหัก ณ ที่จ่ายค้างจ่าย for what was withheld.
 */
export function pvLines(input: {
  payMethod: string | null;
  lines: { sourceType: string; beforeVat: Decimal.Value; vat: Decimal.Value; gross: Decimal.Value; wht: Decimal.Value }[];
}): DraftLine[] {
  const out: DraftLine[] = [];
  for (const l of input.lines) {
    if (AP_SOURCES.has(l.sourceType)) {
      out.push(dr('AP', l.gross));
    } else {
      out.push(dr(l.sourceType === 'EXPENSE' ? 'EXPENSE' : 'LABOR_COST', l.beforeVat));
      out.push(dr('VAT_INPUT', l.vat));
    }
  }
  const debits = sum(out.map((l) => l.debit));
  const wht = round2(sum(input.lines.map((l) => D(l.wht))));
  out.push(cr('WHT_PAYABLE', wht));
  out.push(cr(cashOrBank(input.payMethod), debits.minus(wht)));
  return finishLines(merge(out));
}

/**
 * ขายเชื่อ (IV): an invoice issued to a customer. Services reach their VAT tax point when paid, so
 * the VAT waits in ภาษีขายยังไม่ถึงกำหนด until the receipt.
 */
export function arInvoiceLines(input: { beforeVat: Decimal.Value; vat: Decimal.Value; gross: Decimal.Value }): DraftLine[] {
  return finishLines([dr('AR', input.gross), cr('SALES', input.beforeVat), cr('VAT_OUTPUT_UNDUE', input.vat)]);
}

/**
 * ใบเสร็จรับเงิน (RE) against an invoice: the money (and the tax the customer withheld) clears the
 * debt, and the receipt's share of VAT moves from not-yet-due to ภาษีขาย.
 */
export function arReceiptLines(input: { method: string; amountReceived: Decimal.Value; whtAmount: Decimal.Value; vat: Decimal.Value }): DraftLine[] {
  const settled = D(input.amountReceived).plus(D(input.whtAmount));
  return finishLines([
    dr(cashOrBank(input.method), input.amountReceived),
    dr('WHT_RECEIVABLE', input.whtAmount),
    cr('AR', settled),
    dr('VAT_OUTPUT_UNDUE', input.vat),
    cr('VAT_OUTPUT', input.vat),
  ]);
}

/** ใบลดหนี้: takes back part of an invoice */
export function arCreditNoteLines(input: { beforeVat: Decimal.Value; vat: Decimal.Value; gross: Decimal.Value }): DraftLine[] {
  return finishLines([dr('SALES_RETURN', input.beforeVat), dr('VAT_OUTPUT_UNDUE', input.vat), cr('AR', input.gross)]);
}

/**
 * Sales and money documents kept outside the invoice flow.
 * Cash sales (ใบเสร็จ, ใบกำกับภาษีอย่างย่อ, ใบสำคัญรับ): Dr เงิน + ภาษีถูกหัก + ประกันผลงาน / Cr รายได้ + ภาษีขาย.
 * Credit (ใบกำกับภาษี, ใบเพิ่มหนี้): Dr ลูกหนี้ / Cr รายได้ + ภาษีขาย.
 * ใบสำคัญจ่าย: Dr ค่าใช้จ่าย + ภาษีซื้อ / Cr เงิน + ภาษีหัก ณ ที่จ่ายค้างจ่าย. A quotation is not posted.
 */
export function salesDocLines(input: {
  kind: string;
  payMethod: string | null;
  beforeVat: Decimal.Value;
  vat: Decimal.Value;
  total: Decimal.Value;
  wht: Decimal.Value;
  retention: Decimal.Value;
  payable: Decimal.Value;
}): DraftLine[] | null {
  const money = cashOrBank(input.payMethod);
  switch (input.kind) {
    case 'RC':
    case 'STI':
    case 'INC':
      return finishLines([
        dr(money, input.payable),
        dr('WHT_RECEIVABLE', input.wht),
        dr('RETENTION_AR', input.retention),
        cr(input.kind === 'INC' ? 'OTHER_INCOME' : 'SALES', input.beforeVat),
        cr('VAT_OUTPUT', input.vat),
      ]);
    case 'TI':
    case 'DN':
      return finishLines([dr('AR', input.total), cr('SALES', input.beforeVat), cr('VAT_OUTPUT', input.vat)]);
    case 'EXP':
      return finishLines([
        dr('EXPENSE', input.beforeVat),
        dr('VAT_INPUT', input.vat),
        cr(money, input.payable),
        cr('WHT_PAYABLE', input.wht),
        cr('AP', input.retention),
      ]);
    default:
      return null;
  }
}

/** One line per account and side, so a PV of ten bills reads as a short entry */
function merge(lines: DraftLine[]): DraftLine[] {
  const byKey = new Map<string, DraftLine>();
  for (const l of lines) {
    const side = l.debit.gt(0) ? 'D' : 'C';
    const k = `${l.account}|${side}`;
    const prev = byKey.get(k);
    byKey.set(k, prev ? { ...prev, debit: prev.debit.plus(l.debit), credit: prev.credit.plus(l.credit) } : l);
  }
  return [...byKey.values()];
}

/** A stable fingerprint of an entry, to tell whether a document's posting changed */
export function entryFingerprint(e: { date: string; lines: { accountId: string; debit: Decimal.Value; credit: Decimal.Value }[] }): string {
  const rows = e.lines.map((l) => `${l.accountId}:${D(l.debit).toFixed(2)}:${D(l.credit).toFixed(2)}`).sort();
  return `${e.date}|${rows.join(',')}`;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: GlAccountType;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

/** Puts a net balance on its side: positive is a debit balance */
export function sideOf(net: Decimal): { debit: number; credit: number } {
  return net.isNegative() ? { debit: 0, credit: net.abs().toNumber() } : { debit: net.toNumber(), credit: 0 };
}
