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

/** 2026-11-04 → 04/11/2026; anything that is not an ISO date gives an empty string. */
export function formatDateText(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Accepts 2026-11-04 or 4/11/2026, with the year in either calendar; null when it is not a real date. */
export function parseDateText(raw: string): string | null {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  const parts = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  if (!parts) return null;
  const [rawYear, month, day] = parts.map(Number) as [number, number, number];
  const year = rawYear >= 2400 ? rawYear - 543 : rawYear;
  // A mistyped year such as 0026 would otherwise be read as 1926
  if (year < 1900) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // An impossible date such as 31 February rolls over into the next month
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Keeps what is being typed in dd/mm/yyyy shape: adds the slashes, and pads "4/" to "04". */
export function maskDateText(raw: string): string {
  const pastedIso = /^\s*\d{4}-\d{1,2}-\d{1,2}\s*$/.test(raw) ? parseDateText(raw) : null;
  if (pastedIso) return formatDateText(pastedIso);
  const parts = raw.replace(/[-.]/g, '/').split('/').map((p) => p.replace(/\D/g, ''));
  const digits = parts
    .map((p, i) => (p && i < parts.length - 1 && i < 2 ? p.padStart(2, '0').slice(-2) : p))
    .join('')
    .slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

/** What is wrong with a date field, in words people can act on; null when it is fine. */
export function dateFieldProblem(field: { text: string; iso: string; min?: string; max?: string; required?: boolean }): string | null {
  const { text, iso, min, max, required } = field;
  if (text.trim() && !parseDateText(text)) return 'วันที่ไม่ถูกต้อง กรุณากรอกเป็น วว/ดด/ปปปป';
  if (!iso) return required ? 'กรุณาระบุวันที่' : null;
  if (min && iso < min) return `วันที่ต้องไม่ก่อน ${formatDateText(min)}`;
  if (max && iso > max) return `วันที่ต้องไม่เกิน ${formatDateText(max)}`;
  return null;
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
