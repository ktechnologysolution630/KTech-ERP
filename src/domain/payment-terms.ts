/**
 * Billing and cheque-collection terms: when a vendor accepts bills, what the credit period counts
 * from and which days cheques are handed over. Together they give the date a bill is actually paid.
 *
 * A schedule is stored as text: '' = any day, 'M:5,20' = those days of the month (a day past the
 * month's end means its last day), 'W:1,5' = those weekdays (0 = Sunday … 6 = Saturday).
 */

export type CreditBasis = 'INVOICE' | 'BILLING' | 'RECEIPT';
export const CREDIT_BASES: readonly CreditBasis[] = ['BILLING', 'INVOICE', 'RECEIPT'];
export const CREDIT_BASIS_LABEL: Record<CreditBasis, string> = {
  BILLING: 'นับจากวันวางบิล',
  INVOICE: 'นับจากวันที่ใบแจ้งหนี้',
  RECEIPT: 'นับจากวันรับของ',
};

export const WEEKDAY_LABEL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'] as const;

export type Schedule = { kind: 'ANY' } | { kind: 'MONTH_DAYS'; days: number[] } | { kind: 'WEEKDAYS'; days: number[] };

function uniqSorted(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

export function parseSchedule(text: string | null | undefined): Schedule {
  const t = (text ?? '').trim();
  const m = /^([MW]):(.*)$/.exec(t);
  if (!m) return { kind: 'ANY' };
  const nums = m[2]!
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
  if (m[1] === 'M') {
    const days = uniqSorted(nums.filter((n) => n >= 1 && n <= 31));
    return days.length ? { kind: 'MONTH_DAYS', days } : { kind: 'ANY' };
  }
  const days = uniqSorted(nums.filter((n) => n >= 0 && n <= 6));
  return days.length ? { kind: 'WEEKDAYS', days } : { kind: 'ANY' };
}

export function formatSchedule(s: Schedule): string {
  if (s.kind === 'MONTH_DAYS') return `M:${s.days.join(',')}`;
  if (s.kind === 'WEEKDAYS') return `W:${s.days.join(',')}`;
  return '';
}

/** Normalises user input; throws a readable message when it cannot be understood */
export function normaliseSchedule(text: string | null | undefined): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  const s = parseSchedule(t);
  if (s.kind === 'ANY') throw new Error('รูปแบบรอบวันไม่ถูกต้อง');
  return formatSchedule(s);
}

export function describeSchedule(text: string | null | undefined, anyLabel = 'ทุกวัน'): string {
  const s = parseSchedule(text);
  if (s.kind === 'MONTH_DAYS') return `ทุกวันที่ ${s.days.join(', ')} ของเดือน`;
  if (s.kind === 'WEEKDAYS') return `ทุกวัน${s.days.map((d) => WEEKDAY_LABEL[d]).join(', ')}`;
  return anyLabel;
}

// ---- ISO date helpers (UTC arithmetic on yyyy-mm-dd, no time zone drift) ----

function toUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
}
function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}
function lastDayOfMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** The first date on or after `iso` that falls on the schedule */
export function nextOnSchedule(iso: string, scheduleText: string | null | undefined): string {
  const s = parseSchedule(scheduleText);
  if (s.kind === 'ANY') return iso;
  const start = toUtc(iso);
  if (s.kind === 'WEEKDAYS') {
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      if (s.days.includes(d.getUTCDay())) return toIso(d);
    }
    return iso;
  }
  // Month days: try this month, then the next
  for (let k = 0; k < 2; k++) {
    const y = start.getUTCFullYear();
    const m0 = start.getUTCMonth() + k;
    const yy = y + Math.floor(m0 / 12);
    const mm = ((m0 % 12) + 12) % 12;
    const last = lastDayOfMonth(yy, mm);
    const candidates = uniqSorted(s.days.map((d) => Math.min(d, last)));
    for (const day of candidates) {
      const c = new Date(Date.UTC(yy, mm, day));
      if (c >= start) return toIso(c);
    }
  }
  return iso;
}

/** Saturday or Sunday moves to the following Monday */
export function nextWorkingDay(iso: string): string {
  const dow = toUtc(iso).getUTCDay();
  if (dow === 6) return addDays(iso, 2);
  if (dow === 0) return addDays(iso, 1);
  return iso;
}

export interface PaymentTerms {
  billingSchedule: string;
  creditBasis: CreditBasis;
  creditDays: number;
  chequeSchedule: string;
}

/**
 * The billing date and the date the bill falls due.
 * 1. Billing is the next billing day on or after both the invoice and the goods arriving.
 * 2. Credit counts from the chosen basis.
 * 3. The due date moves to the next cheque day, then off a weekend.
 */
export function computeDueDate(input: {
  invoiceDate: string;
  /** Latest confirmed receipt; null when nothing has arrived yet */
  receivedDate: string | null;
  terms: PaymentTerms;
}): { billingDate: string; dueDate: string } {
  const { invoiceDate, receivedDate, terms } = input;
  const ready = receivedDate && receivedDate > invoiceDate ? receivedDate : invoiceDate;
  const billingDate = nextOnSchedule(ready, terms.billingSchedule);
  const base = terms.creditBasis === 'INVOICE' ? invoiceDate : terms.creditBasis === 'RECEIPT' ? (receivedDate ?? invoiceDate) : billingDate;
  const credited = addDays(base, Math.max(0, terms.creditDays));
  const dueDate = nextWorkingDay(nextOnSchedule(credited, terms.chequeSchedule));
  return { billingDate, dueDate };
}

export type PayMethod = 'TRANSFER' | 'CHEQUE' | 'CASH' | 'PROMPTPAY' | 'CARD';
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { TRANSFER: 'โอนเงิน', CASH: 'เงินสด', CHEQUE: 'เช็ค', PROMPTPAY: 'พร้อมเพย์', CARD: 'บัตรเครดิต' };
/** In the order the PO form offers them */
export const PAY_METHODS: readonly PayMethod[] = ['TRANSFER', 'CASH', 'CHEQUE', 'PROMPTPAY', 'CARD'];

export type ChequeStatus = 'ISSUED' | 'COLLECTED' | 'CLEARED' | 'VOID';
export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = {
  ISSUED: 'ออกเช็คแล้ว รอผู้ขายรับ',
  COLLECTED: 'ผู้ขายรับเช็คแล้ว',
  CLEARED: 'เช็คผ่านแล้ว',
  VOID: 'ยกเลิกเช็ค',
};
