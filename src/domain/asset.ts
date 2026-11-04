export const ASSET_STATUSES = ['ACTIVE', 'RETIRED'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  ACTIVE: 'ใช้งาน',
  RETIRED: 'ปลดระวาง',
};

export const ASSET_CATEGORIES = ['เครื่องจักร', 'ยานพาหนะ', 'เครื่องมือช่าง', 'เครื่องมือวัด', 'อุปกรณ์สำนักงาน', 'อื่นๆ'];

export const INSPECTION_RESULTS = ['GOOD', 'DAMAGED', 'REPAIR', 'MISSING'] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const INSPECTION_RESULT_LABELS: Record<InspectionResult, string> = {
  GOOD: 'ปกติ',
  DAMAGED: 'ชำรุด',
  REPAIR: 'ส่งซ่อม',
  MISSING: 'สูญหาย',
};

export const DEFAULT_INSPECT_EVERY_DAYS = 90;
/** How far ahead an inspection counts as coming up */
export const DUE_SOON_DAYS = 7;

export type InspectionDue = 'NEVER' | 'OVERDUE' | 'DUE_SOON' | 'OK' | 'RETIRED';

export const INSPECTION_DUE_LABELS: Record<InspectionDue, string> = {
  NEVER: 'ยังไม่เคยตรวจ',
  OVERDUE: 'เกินกำหนดตรวจ',
  DUE_SOON: 'ใกล้ถึงกำหนด',
  OK: 'ตามกำหนด',
  RETIRED: 'ปลดระวาง',
};

const addDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function nextInspectionDate(lastInspectedOn: string | null, everyDays: number): string | null {
  return lastInspectedOn ? addDays(lastInspectedOn, everyDays) : null;
}

export function inspectionDue(status: AssetStatus, nextDueOn: string | null, today: string): InspectionDue {
  if (status === 'RETIRED') return 'RETIRED';
  if (!nextDueOn) return 'NEVER';
  if (nextDueOn < today) return 'OVERDUE';
  return nextDueOn <= addDays(today, DUE_SOON_DAYS) ? 'DUE_SOON' : 'OK';
}

/** A result other than GOOD needs someone to act on it, so the asset stays flagged until it is checked again. */
export const hasProblem = (status: AssetStatus, lastResult: InspectionResult | null): boolean =>
  status === 'ACTIVE' && lastResult !== null && lastResult !== 'GOOD';
