import { D, Decimal, round2, sum } from './money';

export const VO_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type VoStatus = (typeof VO_STATUSES)[number];

export const VO_STATUS_LABELS: Record<VoStatus, string> = {
  DRAFT: 'ร่าง',
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

export const VO_TYPES = ['ADD', 'DEDUCT', 'ADD_DEDUCT'] as const;
export type VoType = (typeof VO_TYPES)[number];

export const VO_TYPE_LABELS: Record<VoType, string> = {
  ADD: 'งานเพิ่ม',
  DEDUCT: 'งานลด',
  ADD_DEDUCT: 'งานเพิ่ม-ลด',
};

export const VO_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type VoPriority = (typeof VO_PRIORITIES)[number];

export const VO_PRIORITY_LABELS: Record<VoPriority, string> = {
  LOW: 'ต่ำ',
  NORMAL: 'ปกติ',
  HIGH: 'สูง',
  URGENT: 'เร่งด่วน',
};

/** Which amount fields a VO type allows: งานเพิ่ม has no deduction, งานลด has no additional work. */
export function voTypeAllows(type: VoType): { add: boolean; deduct: boolean } {
  return { add: type !== 'DEDUCT', deduct: type !== 'ADD' };
}

export interface VoCostImpact {
  net: Decimal;
  vat: Decimal;
  netWithVat: Decimal;
}

/** มูลค่าสุทธิ = งานเพิ่ม − งานลด (before VAT); VAT follows the sign of the net change. */
export function voCostImpact(add: Decimal.Value, deduct: Decimal.Value, vatPercent: Decimal.Value): VoCostImpact {
  const net = D(add).minus(deduct);
  const vat = round2(net.times(vatPercent).div(100));
  return { net, vat, netWithVat: net.plus(vat) };
}

/** Contract days changed by a VO; zero unless the VO is marked as affecting the schedule. */
export function voDaysImpact(scheduleImpact: boolean, daysAdded: number, daysReduced: number): number {
  return scheduleImpact ? daysAdded - daysReduced : 0;
}

/** Add/deduct amounts and days can only change while the VO is still being prepared. */
export function isVoEditable(status: VoStatus): boolean {
  return status === 'DRAFT' || status === 'REJECTED';
}

export function voTypeLabel(add: Decimal.Value, deduct: Decimal.Value): string {
  const a = D(add).greaterThan(0);
  const d = D(deduct).greaterThan(0);
  if (a && d) return 'งานเพิ่ม-ลด';
  if (d) return 'งานลด';
  return 'งานเพิ่ม';
}

export interface VoForSummary {
  addAmount: Decimal.Value;
  deductAmount: Decimal.Value;
  daysImpact: number;
  status: VoStatus;
}

export interface ContractSummary {
  original: Decimal;
  approvedAdd: Decimal;
  approvedDeduct: Decimal;
  current: Decimal;
  pendingCount: number;
  extensionDays: number;
}

/** มูลค่าสัญญาปัจจุบัน = original contract + approved additions − approved deductions. */
export function summarizeContract(originalContract: Decimal.Value, vos: VoForSummary[]): ContractSummary {
  const approved = vos.filter((v) => v.status === 'APPROVED');
  const approvedAdd = sum(approved.map((v) => D(v.addAmount)));
  const approvedDeduct = sum(approved.map((v) => D(v.deductAmount)));
  const original = D(originalContract);
  return {
    original,
    approvedAdd,
    approvedDeduct,
    current: original.plus(approvedAdd).minus(approvedDeduct),
    pendingCount: vos.filter((v) => v.status === 'PENDING').length,
    extensionDays: approved.reduce((acc, v) => acc + v.daysImpact, 0),
  };
}

/** Contract end date shifted by approved extension days (ISO yyyy-mm-dd), or null without an end date. */
export function revisedEndDate(endDate: string | null, extensionDays: number): string | null {
  if (!endDate) return null;
  const d = new Date(`${endDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + extensionDays);
  return d.toISOString().slice(0, 10);
}
