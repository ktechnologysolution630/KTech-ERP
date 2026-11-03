export const HANDOVER_STATUSES = ['SCHEDULED', 'HANDED_OVER', 'ACCEPTED'] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  SCHEDULED: 'นัดส่งมอบ',
  HANDED_OVER: 'ส่งมอบแล้ว รอตรวจรับ',
  ACCEPTED: 'ลูกค้าตรวจรับแล้ว',
};

export const DEFECT_STATUSES = ['OPEN', 'IN_PROGRESS', 'FIXED', 'REJECTED'] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

export const DEFECT_STATUS_LABELS: Record<DefectStatus, string> = {
  OPEN: 'รับแจ้ง',
  IN_PROGRESS: 'กำลังซ่อม',
  FIXED: 'ซ่อมเสร็จ',
  REJECTED: 'ไม่อยู่ในเงื่อนไขประกัน',
};

/** Same day `months` later; clamps to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + months;
  const d = Number(iso.slice(8, 10));
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

export type WarrantyState = 'ACTIVE' | 'STRUCTURAL_ONLY' | 'EXPIRED';

export const WARRANTY_STATE_LABELS: Record<WarrantyState, string> = {
  ACTIVE: 'อยู่ในระยะประกัน',
  STRUCTURAL_ONLY: 'เหลือประกันโครงสร้าง',
  EXPIRED: 'หมดประกัน',
};

/** Warranty runs from the handover date up to (not including) the end date. */
export function warrantyState(start: string, months: number, structuralMonths: number, today: string): {
  endDate: string;
  structuralEndDate: string;
  state: WarrantyState;
} {
  const endDate = addMonths(start, months);
  const structuralEndDate = addMonths(start, Math.max(months, structuralMonths));
  const state: WarrantyState = today < endDate ? 'ACTIVE' : today < structuralEndDate ? 'STRUCTURAL_ONLY' : 'EXPIRED';
  return { endDate, structuralEndDate, state };
}
