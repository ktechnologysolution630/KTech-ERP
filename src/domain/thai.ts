const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Returns a Date whose UTC fields (getUTCFullYear, getUTCMonth, getUTCDate, etc.)
 * represent wall-clock time in Asia/Bangkok (UTC+7).
 */
export function toBangkok(d: Date): Date {
  return new Date(d.getTime() + BANGKOK_OFFSET_MS);
}

export function formatThaiDate(d: Date | string): string {
  const dateObj = typeof d === 'string' ? new Date(d.includes('T') ? d : `${d}T00:00:00+07:00`) : d;
  const bkk = toBangkok(dateObj);
  const day = bkk.getUTCDate();
  const month = THAI_MONTHS_SHORT[bkk.getUTCMonth()];
  const beYear = bkk.getUTCFullYear() + 543;
  return `${day} ${month} ${beYear}`;
}

export function docPeriod(d: Date): string {
  const bkk = toBangkok(d);
  const beYear2 = String(bkk.getUTCFullYear() + 543).slice(-2);
  const mm = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  return `${beYear2}${mm}`;
}

export function bangkokDateString(d: Date = new Date()): string {
  const bkk = toBangkok(d);
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bkk.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
