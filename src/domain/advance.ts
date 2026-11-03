import { D, Decimal, sum } from './money';

/**
 * เงินทดรองจ่าย lifecycle. A request is submitted on creation; once paid it waits to be cleared
 * with actual expenses and any cash returned.
 */
export const ADVANCE_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PAID',
  'PARTIALLY_CLEARED',
  'CLEARED',
  'CANCELLED',
] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  PAID: 'รอเคลียร์',
  PARTIALLY_CLEARED: 'เคลียร์บางส่วน',
  CLEARED: 'เคลียร์ครบ',
  CANCELLED: 'ยกเลิก',
};

export const EXPENSE_EVIDENCE = ['RECEIPT', 'SUBSTITUTE', 'NONE'] as const;
export type ExpenseEvidence = (typeof EXPENSE_EVIDENCE)[number];
export const EXPENSE_EVIDENCE_LABELS: Record<ExpenseEvidence, string> = {
  RECEIPT: 'มีใบเสร็จ',
  SUBSTITUTE: 'ใบรับรองแทนใบเสร็จ',
  NONE: 'ไม่มีหลักฐาน',
};

export interface AdvanceBalance {
  spent: Decimal;
  returned: Decimal;
  /** Still to be accounted for by the payee (never negative) */
  outstanding: Decimal;
  /** Company owes the payee when expenses exceed the advance */
  reimbursable: Decimal;
}

export function advanceBalance(amount: Decimal.Value, expenses: Decimal.Value[], returned: Decimal.Value): AdvanceBalance {
  const spent = sum(expenses.map((e) => D(e)));
  const ret = D(returned);
  const accounted = spent.plus(ret);
  const diff = D(amount).minus(accounted);
  return {
    spent,
    returned: ret,
    outstanding: Decimal.max(D(0), diff),
    reimbursable: Decimal.max(D(0), diff.negated()),
  };
}

/** Status after expenses or returned cash are recorded against a paid advance. */
export function clearingStatus(balance: AdvanceBalance): AdvanceStatus {
  if (balance.outstanding.lte(0)) return 'CLEARED';
  return balance.spent.plus(balance.returned).gt(0) ? 'PARTIALLY_CLEARED' : 'PAID';
}

export const RECEIPT_SUBSTITUTE_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ReceiptSubstituteStatus = (typeof RECEIPT_SUBSTITUTE_STATUSES)[number];
export const RECEIPT_SUBSTITUTE_STATUS_LABELS: Record<ReceiptSubstituteStatus, string> = {
  DRAFT: 'ร่าง',
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};
