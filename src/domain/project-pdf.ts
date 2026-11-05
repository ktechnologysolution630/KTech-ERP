import { bahtText, D, parseDecimalInput } from './money';
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
  startDate: ['วันเริ่มต้นสัญญา', 'วันที่เริ่มสัญญา', 'วันเริ่มสัญญา', 'เริ่มสัญญา', 'วันที่เริ่มงาน', 'วันเริ่มงาน', 'วันที่เริ่มต้น', 'วันเริ่มต้น', 'วันที่เริ่ม', 'วันเริ่ม', 'start date', 'เริ่มงาน', 'เริ่มต้น', 'เริ่มทำงานที่รับจ้างภายในวันที่'],
  endDate: ['วันสิ้นสุดสัญญา', 'วันที่สิ้นสุดสัญญา', 'สิ้นสุดสัญญา', 'วันที่สิ้นสุด', 'วันสิ้นสุด', 'กำหนดแล้วเสร็จ', 'วันแล้วเสร็จ', 'end date', 'finish date', 'สิ้นสุด', 'แล้วเสร็จบริบูรณ์ภายในวันที่'],
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

/** How a clause carries on after naming a party; "ผู้ว่าจ้าง ตกลงจ่าย..." is a sentence, not someone's name. */
const PROSE_START = /^(ตกลง|จะ|ได้|มี|ให้|และ|ต้อง|ไม่|เป็น|ซึ่ง|โดย|ที่|ของ|ตาม|เมื่อ|หาก|กับ|ใน|นั้น|นี้|ฝ่าย|อาจ|ยอม|รับ|เพื่อ|แล้ว|ด้วย|ก่อน|หรือ|ทั้ง|ทราบ|นับ|ถือ|แจ้ง|เห็น|อนุมัติ|เรียก)/;
/** Without a colon, a client must look like one */
const ORGANISATION_START = /^(บริษัท|บจก|ห้าง|หจก|กรม|กระทรวง|สำนัก|องค์การ|องค์กร|เทศบาล|มหาวิทยาลัย|โรงเรียน|โรงพยาบาล|ศาล|ธนาคาร|การไฟฟ้า|การประปา|การท่า|การรถไฟ|จังหวัด|อำเภอ|วัด|คุณ|นาย|นาง|น\.ส\.|ดร\.|[A-Za-z])/;

function cleanValue(field: ProjectPdfField, raw: string, hasColon: boolean): string | undefined {
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
  if (!text || text.length > MAX_TEXT_VALUE) return undefined;
  if (!hasColon && (PROSE_START.test(text) || (field === 'clientName' && !ORGANISATION_START.test(text)))) return undefined;
  return text;
}

const NUMBER_WORDS: [string, number][] = [
  ['หนึง', 1], ['เอด', 1], ['สอง', 2], ['ยี', 2], ['สาม', 3], ['สี', 4], ['หา', 5], ['หก', 6], ['เจด', 7], ['แปด', 8], ['เกา', 9],
];
const UNIT_WORDS: [string, number][] = [['สิบ', 10], ['รอย', 100], ['พัน', 1000], ['หมืน', 10_000], ['แสน', 100_000]];

/** Reads Thai number words, without their tone marks; null unless every letter is accounted for. */
function numberFromWords(words: string): number | null {
  let rest = words;
  let total = 0;
  let group = 0;
  let digit: number | null = null;
  while (rest) {
    const number = NUMBER_WORDS.find(([w]) => rest.startsWith(w));
    if (number) {
      if (digit !== null) return null;
      digit = number[1];
      rest = rest.slice(number[0].length);
      continue;
    }
    const unit = UNIT_WORDS.find(([w]) => rest.startsWith(w));
    if (unit) {
      // Only สิบ may stand alone, as in สิบเอ็ด
      if (digit === null && unit[1] !== 10) return null;
      group += (digit ?? 1) * unit[1];
      digit = null;
      rest = rest.slice(unit[0].length);
      continue;
    }
    if (!rest.startsWith('ลาน')) return null;
    total = (total + group + (digit ?? 0)) * 1_000_000;
    group = 0;
    digit = null;
    rest = rest.slice(3);
  }
  return total + group + (digit ?? 0);
}

/** "สี่สิบแปดล้านบาทถ้วน" → "48000000.00". OCR reads Thai letters far better than Thai digits, so this is the reliable form of an amount. */
export function parseThaiAmount(text: string): string | null {
  const plain = text.replace(/\s/g, '').replace(/[็-์]/g, '');
  const m = /^(.+?)บาท(?:ถวน|(.+?)สตางค)?$/.exec(plain);
  if (!m) return null;
  const baht = numberFromWords(m[1]!);
  const satang = m[2] ? numberFromWords(m[2]) : 0;
  if (baht === null || satang === null || satang > 99) return null;
  const amount = baht + satang / 100;
  return amount > 0 ? amount.toFixed(2) : null;
}

/** The first amount written in brackets, which in a contract follows the figure it spells out. */
function amountInBrackets(text: string): string | null {
  for (const m of text.matchAll(/\(([^()]*บาท[^()]*)\)/g)) {
    const amount = parseThaiAmount(m[1]!);
    if (amount) return amount;
  }
  return null;
}

/** A scan leaves specks that OCR turns into stray marks; these would break up a sentence running across lines. */
function isOcrNoise(line: string): boolean {
  const visible = line.replace(/\s/g, '');
  const thaiLetters = visible.replace(/[^ก-ฮะ-ๅ]/g, '').length;
  return visible.length < 4 || thaiLetters / visible.length < 0.5;
}

const withoutVowels = (s: string) => s.replace(/ำ/g, 'า').replace(/[\sัิ-ฺ็-๎]/g, '');

const MIN_CONTRACT_TITLE = 10;
const CONTRACT_TITLE = /^สัญญาจ้าง(?:เหมา)?\s*(.+)$/;
const CONTRACT_PARTY = new RegExp(`${labelPattern('ระหว่าง')}\\s+(.{3,120}?)\\s+${labelPattern('โดย')}\\s`);
const CALLED_HIRER = new RegExp(`${labelPattern('เรียกว่า')}\\s*["“”']*\\s*${labelPattern('ผู้ว่าจ้าง')}`);
const CALLED_CONTRACTOR = new RegExp(`${labelPattern('เรียกว่า')}\\s*["“”']*\\s*${labelPattern('ผู้รับจ้าง')}`);
const CONTRACT_SITE = new RegExp(`${labelPattern('ตกลงรับจ้าง')}.{0,500}?\\s${labelPattern('ณ')}\\s+(.{3,200}?)\\s+${labelPattern('ตามข้อกำหนด')}`);

/** What follows a label: on its own line, up to the next label, or else the next line if that is not a label too. */
function valueAfter(lines: string[], index: number, afterLabel: string): string {
  const onLine = afterLabel.replace(/^\s*[:：\-–]?\s*/, '');
  const cut = NEXT_LABEL.exec(` ${onLine}`);
  const value = cut ? onLine.slice(0, Math.max(cut.index - 1, 0)).trim() : onLine.trim();
  if (value) return value;
  const next = lines[index + 1];
  return next && !STARTS_WITH_LABEL.test(next) ? next : '';
}

/** Contract amounts are usually also written out in words, which gives an independent check on the digits. */
export function amountMatchesWords(amount: string, text: string): boolean {
  const squeeze = (s: string) => s.replace(/\s/g, '').replace(/[\u0E48-\u0E4B]/g, '').replace(/\u0E4D\u0E32/g, '\u0E33');
  return squeeze(text).includes(squeeze(bahtText(D(amount))).replace(/ถวน$/, ''));
}

interface FoundValue {
  value: string;
  rank: number;
  page: number;
  scanned: boolean;
  /** A budget taken from, or matching, the amount written in words */
  wordsAgree: boolean;
  /** Written in Thai digits, which OCR confuses (๔ ๖ ๘ ๙ all come out as ๕) the same way on every reading */
  thaiDigits: boolean;
}

/** The fields a new project should have; those a scan did not give are pointed out so people fill them in. */
export const ESSENTIAL_FIELDS: ProjectPdfField[] = ['name', 'clientName', 'location', 'startDate', 'endDate', 'budget'];

export class ProjectDetailsCollector {
  private readonly found = new Map<ProjectPdfField, FoundValue>();
  private pagesWithoutNews = 0;
  private marksGuessed = false;

  /** Keeps only what belongs in the form; the rest of the page is dropped here. */
  addPage(lines: string[], source: { page: number; scanned: boolean } = { page: 0, scanned: false }): void {
    this.marksGuessed ||= lines.some((l) => LOST_MARK.test(l));
    const entries = lines.map((raw) => ({ line: normalizeLine(raw), thaiDigits: /[๐-๙]/.test(raw) })).filter((e) => e.line);
    const normalized = entries.map((e) => e.line);
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
          const after = line.slice(m.index + m[0].length);
          const raw = valueAfter(normalized, index, after);
          const value = cleanValue(field, raw, /^\s*[:：]/.test(after));
          if (!value) return false;
          const fromNextLine = raw === normalized[index + 1];
          const thaiDigits = entries[index]!.thaiDigits || (fromNextLine && entries[index + 1]!.thaiDigits);
          if (field === 'budget') {
            const nearby = [line, ...normalized.slice(index + 1, index + 4).filter((l) => !isOcrNoise(l))].join(' ');
            const inWords = amountInBrackets(nearby);
            this.found.set(field, { value: inWords ?? value, rank, ...source, thaiDigits, wordsAgree: inWords !== null || amountMatchesWords(value, nearby) });
          } else {
            this.found.set(field, { value, rank, ...source, thaiDigits, wordsAgree: false });
          }
          news = true;
          return true;
        });
      }
      this.addPeriod(line, entries[index]!.thaiDigits, source);
    });
    news = this.addContractWording(entries, source) || news;
    this.pagesWithoutNews = news ? 0 : this.pagesWithoutNews + 1;
  }

  /** Thai government contracts have no labelled fields: the details sit in standard sentences. A label elsewhere still wins. */
  private addContractWording(entries: { line: string; thaiDigits: boolean }[], source: { page: number; scanned: boolean }): boolean {
    const clean = entries.filter((e) => !isOcrNoise(e.line));
    const text = clean.map((e) => e.line).join(' ');
    let news = false;
    const add = (field: ProjectPdfField, value: string, extra: Partial<FoundValue> = {}) => {
      if (this.found.has(field)) return;
      this.found.set(field, { value, rank: Number.MAX_SAFE_INTEGER, ...source, wordsAgree: false, thaiDigits: false, ...extra });
      news = true;
    };

    if (source.page <= 1) {
      const title = clean.slice(0, 5).map((e) => CONTRACT_TITLE.exec(e.line)?.[1]?.trim()).find((t) => t && t.length >= MIN_CONTRACT_TITLE && !/เลขที่/.test(t));
      if (title) add('name', title);
    }

    // The party named first is the hirer only if the contract says so; the other one is the contractor, usually the company itself
    const hirer = CALLED_HIRER.exec(text);
    const contractor = CALLED_CONTRACTOR.exec(text);
    const party = CONTRACT_PARTY.exec(text);
    if (party && hirer && (!contractor || hirer.index < contractor.index)) add('clientName', party[1]!.trim());

    const site = CONTRACT_SITE.exec(text);
    if (site) add('location', site[1]!.trim());

    const paymentLine = clean.findIndex((e) => withoutVowels(e.line).includes('คาจางจานวน'));
    if (paymentLine >= 0) {
      const nearby = clean.slice(paymentLine, paymentLine + 3);
      const inWords = amountInBrackets(nearby.map((e) => e.line).join(' '));
      const figure = /\d[\d,]*\.\d{2}/.exec(nearby[0]!.line);
      const value = inWords ?? (figure && parseDecimalInput(figure[0])?.toFixed(2));
      if (value) add('budget', value, { wordsAgree: inWords !== null, thaiDigits: nearby[0]!.thaiDigits });
    }
    return news;
  }

  /** "ระยะเวลา 1 ม.ค. 2569 ถึง 31 ธ.ค. 2569" names both ends at once; a labelled date still takes priority. */
  private addPeriod(line: string, thaiDigits: boolean, source: { page: number; scanned: boolean }): void {
    if (!/(^|\s)(ระยะเวลา|ตั้งแต่)/.test(line)) return;
    const [start, end] = findDates(line);
    if (!start || !end) return;
    const lowest = Number.MAX_SAFE_INTEGER;
    if (!this.found.has('startDate')) this.found.set('startDate', { value: start, rank: lowest, ...source, wordsAgree: false, thaiDigits });
    if (!this.found.has('endDate')) this.found.set('endDate', { value: end, rank: lowest, ...source, wordsAgree: false, thaiDigits });
  }

  /** Project details sit together near the front; after that, a long file only offers false matches. */
  canStop(pagesWithoutNews: number): boolean {
    return this.found.size > 0 && this.pagesWithoutNews >= pagesWithoutNews;
  }

  /** Enough to stop reading a scan: each further page costs many seconds, and dates are usually in Thai digits it cannot trust anyway. */
  get hasCoreDetails(): boolean {
    return (['name', 'clientName', 'location', 'budget'] as const).every((f) => this.found.has(f));
  }

  /** The scanned pages worth reading a second time: those that gave a value the amount in words has not already settled. */
  get scannedSourcePages(): number[] {
    return [...new Set([...this.found.values()].filter((f) => f.scanned && !f.wordsAgree).map((f) => f.page))].sort((a, b) => a - b);
  }

  get(field: ProjectPdfField): Readonly<FoundValue> | undefined {
    return this.found.get(field);
  }

  /** The file lost some tone marks and they were filled in by best guess, so names need a closer look. */
  get toneMarksGuessed(): boolean {
    return this.marksGuessed;
  }

  get details(): ProjectDetailsFromPdf {
    return Object.fromEntries([...this.found].map(([field, { value }]) => [field, value])) as ProjectDetailsFromPdf;
  }
}

/** A wrong one of these does real harm and is hard to spot, so two readings that disagree fill in nothing. */
const MUST_AGREE_FIELDS: ProjectPdfField[] = ['code', 'budget', 'startDate', 'endDate'];

export interface ReconciledDetails {
  details: ProjectDetailsFromPdf;
  /** Read the same both times, or came from real text in the file */
  confirmed: ProjectPdfField[];
  /** Filled in, but only one reading supports it, or the wording differs */
  needsCheck: ProjectPdfField[];
  /** Left empty because the readings contradict each other, or because the scan cannot be trusted on it */
  refused: { field: ProjectPdfField; readings: string[]; thaiDigits?: boolean }[];
}

const withoutMarks = (s: string) => s.replace(/\s/g, '').replace(/[\u0E48-\u0E4B]/g, '').toLowerCase();

/** Compares two independent readings of the scanned pages. `second` is null if the check was stopped before it ran. */
export function reconcileReadings(first: ProjectDetailsCollector, second: ProjectDetailsCollector | null): ReconciledDetails {
  const result: ReconciledDetails = { details: {}, confirmed: [], needsCheck: [], refused: [] };
  const take = (field: ProjectPdfField, value: string, into: 'confirmed' | 'needsCheck') => {
    (result.details as Record<ProjectPdfField, string>)[field] = value;
    result[into].push(field);
  };

  for (const field of FIELDS) {
    const a = first.get(field);
    const b = second?.get(field);
    if (!a && !b) continue;
    if (a && !a.scanned) {
      take(field, a.value, 'confirmed');
    } else if (a?.wordsAgree) {
      take(field, a.value, 'confirmed');
    } else if (b?.wordsAgree) {
      take(field, b.value, 'confirmed');
    } else if (MUST_AGREE_FIELDS.includes(field) && (a?.thaiDigits || b?.thaiDigits)) {
      // Both readings make the same mistakes on Thai digits, so agreeing proves nothing here
      result.refused.push({ field, readings: [], thaiDigits: true });
    } else if (!a || !b) {
      take(field, (a ?? b)!.value, 'needsCheck');
    } else if (withoutMarks(a.value) === withoutMarks(b.value)) {
      // OCR drops tone marks more often than it invents them, so the fuller spelling is the better one
      take(field, b.value.length > a.value.length ? b.value : a.value, 'confirmed');
    } else if (MUST_AGREE_FIELDS.includes(field)) {
      result.refused.push({ field, readings: [a.value, b.value] });
    } else {
      // OCR loses letters far more often than it adds them, so the longer reading is usually the whole one
      take(field, b.value.length > a.value.length ? b.value : a.value, 'needsCheck');
    }
  }

  const { startDate, endDate } = result.details;
  if (startDate && endDate && startDate > endDate) {
    for (const field of ['startDate', 'endDate'] as const) {
      result.refused.push({ field, readings: [result.details[field]!] });
      delete result.details[field];
      result.confirmed = result.confirmed.filter((f) => f !== field);
      result.needsCheck = result.needsCheck.filter((f) => f !== field);
    }
  }
  return result;
}
