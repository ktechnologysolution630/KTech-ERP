import { D, round2 } from './money';

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

export const needsInspection = (due: InspectionDue): boolean => due === 'NEVER' || due === 'OVERDUE' || due === 'DUE_SOON';

export type AssetCheckState = 'ACTIVE' | 'PROBLEM' | 'AWAITING_CHECK' | 'RETIRED';

export const ASSET_CHECK_STATE_LABELS: Record<AssetCheckState, string> = {
  ACTIVE: 'Active',
  PROBLEM: 'มีปัญหา',
  AWAITING_CHECK: 'รอตรวจยืนยัน',
  RETIRED: 'ปลดระวาง',
};

/** An asset is Active once its latest check found it in order, until that check runs out. */
export function assetCheckState(status: AssetStatus, lastResult: InspectionResult | null, due: InspectionDue): AssetCheckState {
  if (status === 'RETIRED') return 'RETIRED';
  if (hasProblem(status, lastResult)) return 'PROBLEM';
  return due === 'NEVER' || due === 'OVERDUE' ? 'AWAITING_CHECK' : 'ACTIVE';
}

export interface CheckLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

const latLng = ({ latitude, longitude }: Pick<CheckLocation, 'latitude' | 'longitude'>) =>
  `${latitude.toFixed(6)},${longitude.toFixed(6)}`;

/** Google Maps embed with a pin; this form needs no API key. */
export function mapEmbedUrl(location: Pick<CheckLocation, 'latitude' | 'longitude'>): string {
  return `https://maps.google.com/maps?q=${latLng(location)}&z=17&output=embed`;
}

/** Opens Google Maps (the app on phones) pinned at the check location. */
export function mapLinkUrl(location: Pick<CheckLocation, 'latitude' | 'longitude'>): string {
  return `https://www.google.com/maps/search/?api=1&query=${latLng(location)}`;
}

/** Location accuracy for people: metres with separators, kilometres once it is that far off. */
export function accuracyText(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toLocaleString('th-TH', { maximumFractionDigits: 1 })} กม.`;
  return `${Math.round(meters).toLocaleString('th-TH')} เมตร`;
}

/** Identifies one due period; moving from "coming up" to "overdue" is a new one, so people are reminded once more. */
export const dueNoticeKey = (due: InspectionDue, nextDueOn: string | null): string => (nextDueOn ? `${nextDueOn}:${due}` : due);

export interface Depreciation {
  perYear: number;
  /** Charged since 1 January of the current year */
  thisYear: number;
  accumulated: number;
  bookValue: number;
  fullyDepreciated: boolean;
}

const dayNumber = (isoDate: string): number => Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000;

/** Straight line, by the day, from the purchase date until the useful life ends or the asset is retired. */
export function computeDepreciation(
  asset: { purchaseValue: string | number; salvageValue: string | number; usefulLifeYears: number | null; purchaseDate: string | null; retiredOn: string | null },
  today: string,
): Depreciation | null {
  const { usefulLifeYears: years, purchaseDate, retiredOn } = asset;
  if (!years || !purchaseDate) return null;
  const cost = D(asset.purchaseValue);
  const base = cost.minus(asset.salvageValue);
  const start = dayNumber(purchaseDate);
  const [y, m, d] = purchaseDate.split('-').map(Number) as [number, number, number];
  // Date.UTC rolls 29 February over to 1 March when the life ends in a common year
  const end = Date.UTC(y + years, m - 1, d) / 86_400_000;
  const accumulatedOn = (date: string) => {
    const elapsed = Math.min(Math.max(dayNumber(date) - start, 0), end - start);
    return round2(base.times(elapsed).div(end - start));
  };
  const asOf = retiredOn && retiredOn < today ? retiredOn : today;
  const accumulated = accumulatedOn(asOf);
  const lastYearEnd = `${Number(today.slice(0, 4)) - 1}-12-31`;
  return {
    perYear: round2(base.div(years)).toNumber(),
    thisYear: accumulated.minus(accumulatedOn(lastYearEnd < asOf ? lastYearEnd : asOf)).toNumber(),
    accumulated: accumulated.toNumber(),
    bookValue: cost.minus(accumulated).toNumber(),
    fullyDepreciated: dayNumber(asOf) >= end,
  };
}

/** Column headers of the import file; the template is built from these too. */
export const ASSET_IMPORT_COLUMNS = {
  name: 'ชื่อทรัพย์สิน',
  category: 'หมวด',
  serialNo: 'หมายเลขเครื่อง/ทะเบียน',
  projectCode: 'รหัสโครงการ',
  custodian: 'ผู้ดูแล',
  purchaseDate: 'วันที่ซื้อ',
  purchaseValue: 'มูลค่า',
  salvageValue: 'มูลค่าซาก',
  usefulLifeYears: 'อายุการใช้งาน(ปี)',
  inspectEveryDays: 'รอบการตรวจ(วัน)',
  note: 'หมายเหตุ',
} as const;

