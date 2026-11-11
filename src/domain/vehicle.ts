/**
 * การใช้รถ: asking for a company vehicle, its approval, taking it out, where it is while out,
 * bringing it back, and what the trip cost.
 */

export const TRIP_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'IN_USE', 'RETURNED', 'CANCELLED'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  REQUESTED: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว รอรับรถ',
  REJECTED: 'ไม่อนุมัติ',
  IN_USE: 'กำลังใช้งาน',
  RETURNED: 'คืนรถแล้ว',
  CANCELLED: 'ยกเลิก',
};

export const TRIP_STATUS_TONE: Record<TripStatus, string> = {
  REQUESTED: 'bg-amber-50 text-amber-800 border-amber-200',
  APPROVED: 'bg-blue-50 text-blue-800 border-blue-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  IN_USE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  RETURNED: 'bg-slate-100 text-slate-700 border-slate-200',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200',
};

/** A trip that holds the vehicle: nobody else may book it for overlapping hours */
export const HOLDING_STATUSES: TripStatus[] = ['REQUESTED', 'APPROVED', 'IN_USE'];

/** Fuel as read off the gauge */
export const FUEL_LEVELS = [
  { value: 100, label: 'เต็มถัง' },
  { value: 75, label: '3/4 ถัง' },
  { value: 50, label: 'ครึ่งถัง' },
  { value: 25, label: '1/4 ถัง' },
  { value: 10, label: 'ใกล้หมด' },
] as const;
export const fuelLabel = (v: number | null | undefined) => FUEL_LEVELS.find((f) => f.value === v)?.label ?? '-';

export const EXPENSE_KINDS = ['FUEL', 'TOLL', 'PARKING', 'REPAIR', 'OTHER'] as const;
export type TripExpenseKind = (typeof EXPENSE_KINDS)[number];
export const EXPENSE_KIND_LABEL: Record<TripExpenseKind, string> = {
  FUEL: 'น้ำมัน',
  TOLL: 'ทางด่วน',
  PARKING: 'ที่จอดรถ',
  REPAIR: 'ซ่อม / ยาง',
  OTHER: 'อื่นๆ',
};

/** Where a position came from. Trackers fitted to vehicles report on their own, outside any trip. */
export type PositionSource = 'PHONE' | 'TRACKER';

/** How long without a position before the map says the signal is lost */
export const SIGNAL_LOST_AFTER_MS = 3 * 60 * 1000;
/** The phone sends at most this often while driving */
export const SEND_EVERY_MS = 15 * 1000;
/** A reading worse than this is noise, not a place */
export const MAX_ACCURACY_M = 200;
/** Points sent in one go after the phone was offline */
export const MAX_POINTS_PER_SEND = 200;

/** Do two bookings of the same vehicle overlap? Touching ends (one returns at 12:00, next leaves at 12:00) do not. */
export function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Straight-line distance in kilometres between two points (haversine) */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of a recorded route, skipping jumps no vehicle could make (a bad GPS fix) */
export function routeKm(points: { lat: number; lng: number; at: Date }[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    const step = distanceKm(points[i - 1]!, points[i]!);
    const hours = Math.max((points[i]!.at.getTime() - points[i - 1]!.at.getTime()) / 3_600_000, 1 / 3600);
    if (step / hours <= 200) km += step;
  }
  return Math.round(km * 10) / 10;
}

export type LiveState = 'MOVING' | 'STOPPED' | 'NO_SIGNAL' | 'WAITING';

/** What the map shows for a vehicle that is out */
export function liveState(lastSeenAt: Date | null, speedKmh: number | null, now = new Date()): LiveState {
  if (!lastSeenAt) return 'WAITING';
  if (now.getTime() - lastSeenAt.getTime() > SIGNAL_LOST_AFTER_MS) return 'NO_SIGNAL';
  return (speedKmh ?? 0) >= 5 ? 'MOVING' : 'STOPPED';
}

export const LIVE_STATE_LABEL: Record<LiveState, string> = {
  MOVING: 'กำลังวิ่ง',
  STOPPED: 'จอดอยู่',
  NO_SIGNAL: 'สัญญาณขาด',
  WAITING: 'ยังไม่ส่งตำแหน่ง',
};

/** Distance and when the next service is due, from the odometer */
export function serviceDue(v: { serviceEveryKm: number | null; lastServiceKm: number | null; odometerKm: number | null }): { dueAtKm: number; remainingKm: number; due: boolean } | null {
  if (!v.serviceEveryKm || v.odometerKm === null) return null;
  const dueAtKm = (v.lastServiceKm ?? 0) + v.serviceEveryKm;
  const remainingKm = Math.round((dueAtKm - v.odometerKm) * 10) / 10;
  return { dueAtKm, remainingKm, due: remainingKm <= 500 };
}

/** Over its booked time and still out */
export const isOverdue = (t: { status: TripStatus; plannedEnd: Date }, now = new Date()) => t.status === 'IN_USE' && t.plannedEnd < now;

/** 11 พ.ย. 2569 14:30, in Bangkok time */
export function formatThaiDateTime(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const date = typeof d === 'string' ? new Date(d) : d;
  const bkk = new Date(date.getTime() + 7 * 3_600_000);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${bkk.getUTCDate()} ${months[bkk.getUTCMonth()]} ${bkk.getUTCFullYear() + 543} ${pad(bkk.getUTCHours())}:${pad(bkk.getUTCMinutes())}`;
}

/** How long ago, for "last seen" on the live map */
export function agoText(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return '-';
  const s = Math.max(0, Math.round((now.getTime() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s} วินาทีที่แล้ว`;
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86_400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
  return formatThaiDateTime(d);
}

/** Value for <input type="datetime-local"> in Bangkok time */
export function toBangkokLocalInput(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> read as Bangkok time, whatever the device's own zone */
export function fromBangkokLocalInput(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
