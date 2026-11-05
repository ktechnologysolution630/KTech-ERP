import { parseDecimalInput } from './money';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from './project';
import { parseDateText } from './thai';

/** The fields of the new project form, and nothing else a document may contain. */
export interface ProjectDetailsFromPdf {
  name?: string;
  code?: string;
  clientName?: string;
  projectGroup?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  budget?: string;
  status?: ProjectStatus;
}

export type ProjectPdfField = keyof ProjectDetailsFromPdf;

export const PROJECT_PDF_FIELD_LABELS: Record<ProjectPdfField, string> = {
  name: 'ชื่อโครงการ',
  code: 'รหัสโครงการ',
  clientName: 'ลูกค้า',
  projectGroup: 'กลุ่มโปรเจค',
  location: 'สถานที่',
  startDate: 'วันเริ่ม',
  endDate: 'วันสิ้นสุด',
  budget: 'งบประมาณ',
  status: 'สถานะ',
};

/** Most specific first: a later page may replace a value only by matching a label higher up its list. */
const FIELD_LABELS: Record<ProjectPdfField, string[]> = {
  name: ['ชื่อโครงการ', 'ชื่อโปรเจค', 'ชื่อโปรเจกต์', 'ชื่องาน', 'project name', 'โครงการ', 'project'],
  code: ['รหัสโครงการ', 'เลขที่โครงการ', 'รหัสโปรเจค', 'รหัสงาน', 'project code', 'project no.'],
  clientName: ['ชื่อลูกค้า', 'ลูกค้า', 'ผู้ว่าจ้าง', 'เจ้าของโครงการ', 'เจ้าของงาน', 'client', 'customer', 'owner'],
  projectGroup: ['กลุ่มโปรเจค', 'กลุ่มโปรเจกต์', 'กลุ่มโครงการ', 'ประเภทโครงการ', 'project group'],
  location: ['สถานที่ก่อสร้าง', 'สถานที่ตั้งโครงการ', 'ที่ตั้งโครงการ', 'สถานที่ตั้ง', 'สถานที่', 'ที่ตั้ง', 'location', 'site'],
  startDate: ['วันเริ่มต้นสัญญา', 'วันที่เริ่มสัญญา', 'วันเริ่มสัญญา', 'เริ่มสัญญา', 'วันที่เริ่มงาน', 'วันเริ่มงาน', 'วันที่เริ่มต้น', 'วันเริ่มต้น', 'วันที่เริ่ม', 'วันเริ่ม', 'start date', 'เริ่มงาน', 'เริ่มต้น'],
  endDate: ['วันสิ้นสุดสัญญา', 'วันที่สิ้นสุดสัญญา', 'สิ้นสุดสัญญา', 'วันที่สิ้นสุด', 'วันสิ้นสุด', 'กำหนดแล้วเสร็จ', 'วันแล้วเสร็จ', 'end date', 'finish date', 'สิ้นสุด'],
  budget: ['งบประมาณโครงการ', 'งบประมาณ', 'มูลค่าโครงการ', 'มูลค่าสัญญา', 'ราคาตามสัญญา', 'มูลค่างาน', 'วงเงิน', 'contract value', 'budget'],
  status: ['สถานะโครงการ', 'สถานะ', 'status'],
};

const FIELDS = Object.keys(FIELD_LABELS) as ProjectPdfField[];
const MAX_TEXT_VALUE = 300;
const TONE_MARK = /[่-๋]/;

/** Thai fonts draw a tone mark above an upper vowel with a glyph of its own, which many PDFs leave without a character code. */
const LOST_MARK = /[\u0000�]/;
/**
 * The file cannot say which mark was lost. Mai ek is by far the most common, and these frequent words take mai tho
 * (โดยไม่มีวรรณยุกต์: นี้ ขึ้น สิ้น ชิ้น ทิ้ง ซื้อ มื้อ พื้น ยิ้ม ลิ้น ดิ้น ปิ้ง ผึ้ง รื้อ ดื้อ หิ้ว จิ้ม ชี้).
 * Not after เ, where the same letters are เมื่อ or เรื่อง.
 */
const MAI_THO_WORDS = ['นี', 'ขึน', 'สิน', 'ชิน', 'ทิง', 'ซือ', 'มือ', 'พืน', 'ยิม', 'ลิน', 'ดิน', 'ปิง', 'ผึง', 'รือ', 'ดือ', 'หิว', 'จิม', 'ชี'].map(
  (w) => new RegExp(`(?<!เ)(${w.slice(0, 2)})[\\u0000\\uFFFD](?=${w.slice(2)})`, 'g'),
);

function restoreLostMarks(line: string): string {
  return MAI_THO_WORDS.reduce((text, word) => text.replace(word, '$1้'), line).replace(/[\u0000�]/g, '่');
}

/** Older Thai fonts keep shifted vowels and tone marks in the private use area instead of the Thai block. */
const PRIVATE_USE_THAI: Record<string, string> = {
  '': 'ฐ', '': 'ญ',
  '': 'ิ', '': 'ี', '': 'ึ', '': 'ื',
  '': '่', '': '้', '': '๊', '': '๋', '': '์',
  '': '่', '': '้', '': '๊', '': '๋', '': '์',
  '': 'ั', '': 'ํ', '': '็',
  '': '่', '': '้', '': '๊', '': '๋', '': '์',
  '': 'ุ', '': 'ู', '': 'ฺ',
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** PDF text often comes out with stray spaces between Thai letters, and with tone marks lost or guessed wrong */
const labelPattern = (label: string) => [...label].map((ch) => (TONE_MARK.test(ch) ? `${TONE_MARK.source}?` : `${escapeRegExp(ch)}\\s*${TONE_MARK.source}?`)).join('\\s*');
const ALL_LABELS = FIELDS.flatMap((f) => FIELD_LABELS[f]).sort((a, b) => b.length - a.length);
/** A label starts a line or follows a space, so โครงการ does not match inside เจ้าของโครงการ */
const NEXT_LABEL = new RegExp(`\\s(?:${ALL_LABELS.map(labelPattern).join('|')})\\s*[:：]?(?=\\s|$)`, 'i');
const STARTS_WITH_LABEL = new RegExp(`^(?:${ALL_LABELS.map(labelPattern).join('|')})\\s*[:：]?(?=\\s|$)`, 'i');

export function normalizeLine(line: string): string {
  return restoreLostMarks(line.replace(/[-]/g, (ch) => PRIVATE_USE_THAI[ch] ?? ch))
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ํา/g, 'ำ')
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A PDF stores text as loose pieces placed on the page; this puts them back into lines, top to bottom. */
export function linesFromTextItems(items: PdfTextItem[]): string[] {
  const sorted = items.filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(item.height, 1) * 0.5;
    if (row && Math.abs(row[0]!.y - item.y) <= tolerance) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => {
    let line = '';
    let end: number | null = null;
    for (const item of [...row].sort((a, b) => a.x - b.x)) {
      // A real gap separates columns; touching pieces are one word split up
      if (end !== null && item.x - end > Math.max(item.height, 1) * 0.2) line += ' ';
      line += item.str;
      end = item.x + item.width;
    }
    // Left as extracted: the collector needs to see whether marks were lost
    return line.trim();
  });
}

const THAI_MONTHS: [RegExp, number][] = [
  [/^(มกราคม|ม\.?ค\.?)$/, 1],
  [/^(กุมภาพันธ์|ก\.?พ\.?)$/, 2],
  [/^(มีนาคม|มี\.?ค\.?)$/, 3],
  [/^(เมษายน|เม\.?ย\.?)$/, 4],
  [/^(พฤษภาคม|พ\.?ค\.?)$/, 5],
  [/^(มิถุนายน|มิ\.?ย\.?)$/, 6],
  [/^(กรกฎาคม|ก\.?ค\.?)$/, 7],
  [/^(สิงหาคม|ส\.?ค\.?)$/, 8],
  [/^(กันยายน|ก\.?ย\.?)$/, 9],
  [/^(ตุลาคม|ต\.?ค\.?)$/, 10],
  [/^(พฤศจิกายน|พ\.?ย\.?)$/, 11],
  [/^(ธันวาคม|ธ\.?ค\.?)$/, 12],
];
const NUMERIC_DATE = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{1,2}-\d{1,2})\b/g;
const THAI_DATE = /(\d{1,2})\s*([ก-๛.]+?)\s*(?:พ\.?\s*ศ\.?\s*)?(\d{4}|\d{2})(?!\d)/g;

/** Every date in the text, in order, as ISO. Written Thai dates use the Buddhist year, in full or as its last two digits. */
export function findDates(text: string): string[] {
  const found: { at: number; iso: string }[] = [];
  for (const m of text.matchAll(NUMERIC_DATE)) {
    const iso = parseDateText(m[1]!);
    if (iso) found.push({ at: m.index, iso });
  }
  for (const m of text.matchAll(THAI_DATE)) {
    const month = THAI_MONTHS.find(([pattern]) => pattern.test(m[2]!))?.[1];
    if (!month) continue;
    const year = m[3]!.length === 2 ? 2500 + Number(m[3]) : Number(m[3]);
    const iso = parseDateText(`${m[1]}/${month}/${year}`);
    if (iso) found.push({ at: m.index, iso });
  }
  return found.sort((a, b) => a.at - b.at).map((d) => d.iso);
}

function cleanValue(field: ProjectPdfField, raw: string): string | undefined {
  if (field === 'startDate' || field === 'endDate') return findDates(raw)[0];
  if (field === 'budget') {
    const amount = /\d[\d,]*(?:\.\d+)?/.exec(raw);
    const value = amount && parseDecimalInput(amount[0]);
    return value && value.gt(0) ? value.toFixed(2) : undefined;
  }
  if (field === 'status') {
    return PROJECT_STATUSES.find((s) => normalizeLine(raw).startsWith(PROJECT_STATUS_LABELS[s]));
  }
  const text = raw.replace(/^[\s:：\-–]+/, '').trim();
  return text && text.length <= MAX_TEXT_VALUE ? text : undefined;
}

/** What follows a label: on its own line, up to the next label, or else the next line if that is not a label too. */
function valueAfter(lines: string[], index: number, afterLabel: string): string {
  const onLine = afterLabel.replace(/^\s*[:：\-–]?\s*/, '');
  const cut = NEXT_LABEL.exec(` ${onLine}`);
  const value = cut ? onLine.slice(0, Math.max(cut.index - 1, 0)).trim() : onLine.trim();
  if (value) return value;
  const next = lines[index + 1];
  return next && !STARTS_WITH_LABEL.test(next) ? next : '';
}

export class ProjectDetailsCollector {
  private readonly found = new Map<ProjectPdfField, { value: string; rank: number }>();
  private pagesWithoutNews = 0;
  private marksGuessed = false;

  /** Keeps only what belongs in the form; the rest of the page is dropped here. */
  addPage(lines: string[]): void {
    this.marksGuessed ||= lines.some((l) => LOST_MARK.test(l));
    const normalized = lines.map(normalizeLine).filter(Boolean);
    let news = false;
    normalized.forEach((line, index) => {
      for (const field of FIELDS) {
        FIELD_LABELS[field].some((label, rank) => {
          const known = this.found.get(field);
          if (known && known.rank <= rank) return true;
          // A scan often garbles the first letters of a line. Dates can do without the boundary, since a real date must still follow
          const start = field === 'startDate' || field === 'endDate' ? '' : '(?:^|\\s)';
          const m = new RegExp(`${start}${labelPattern(label)}(?=[\\s:：]|$)`, 'i').exec(line);
          if (!m) return false;
          const value = cleanValue(field, valueAfter(normalized, index, line.slice(m.index + m[0].length)));
          if (!value) return false;
          this.found.set(field, { value, rank });
          news = true;
          return true;
        });
      }
      this.addPeriod(line);
    });
    this.pagesWithoutNews = news ? 0 : this.pagesWithoutNews + 1;
  }

  /** "ระยะเวลา 1 ม.ค. 2569 ถึง 31 ธ.ค. 2569" names both ends at once; a labelled date still takes priority. */
  private addPeriod(line: string): void {
    if (!/(^|\s)(ระยะเวลา|ตั้งแต่)/.test(line)) return;
    const [start, end] = findDates(line);
    if (!start || !end) return;
    const lowest = Number.MAX_SAFE_INTEGER;
    if (!this.found.has('startDate')) this.found.set('startDate', { value: start, rank: lowest });
    if (!this.found.has('endDate')) this.found.set('endDate', { value: end, rank: lowest });
  }

  /** Project details sit together near the front; after that, a long file only offers false matches. */
  canStop(pagesWithoutNews: number): boolean {
    return this.found.size > 0 && this.pagesWithoutNews >= pagesWithoutNews;
  }

  /** The file lost some tone marks and they were filled in by best guess, so names need a closer look. */
  get toneMarksGuessed(): boolean {
    return this.marksGuessed;
  }

  get details(): ProjectDetailsFromPdf {
    return Object.fromEntries([...this.found].map(([field, { value }]) => [field, value])) as ProjectDetailsFromPdf;
  }
}
