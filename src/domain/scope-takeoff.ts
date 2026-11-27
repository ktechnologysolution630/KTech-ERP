import type { TakeoffKind } from './boq-takeoff';
import { fixOcrThai, normalizeThai, splitColumns, type TextLine, type TextQtyItem } from './text-takeoff';

/**
 * Take-off from the scope-of-work list. A Thai government drawing set (a TOR) lists its work up
 * front as numbered items under numbered sections:
 *
 *   1. งานรื้อถอน
 *   1.1 งานรื้อผิวจราจรเดิม พื้นที่รวมประมาณ 8,928.00 ตารางเมตร
 *   2. งานก่อสร้างพื้นทางเดินและทางจักรยาน
 *   2.1 งานปรับปรุงถนนลาดยาง … พื้นที่รวมประมาณ 9,000.00 ตารางเมตร
 *
 * That list is the BOQ in the order the owner wrote it. It is read here into items that keep their
 * section and number, and each item is checked against the quantities written on the drawing sheets,
 * so an OCR slip (“1,800” read as “800”, item “3.2” read as “5.2”) shows before it reaches the BOQ.
 */

export interface ScopeItem {
  key: string;
  /** “2.1”, or “4” for a section that is a single item */
  no: string;
  sectionNo: string;
  sectionName: string;
  description: string;
  kind: TakeoffKind;
  unit: string;
  /** 0 when the line gave no quantity */
  qty: number;
  page: number;
  /** The line as read */
  source: string;
  /** Sheets where the same quantity is written (the scope page itself left out) */
  confirmedOn: number[];
  /** A quantity one OCR slip away that the sheets write, when the list's own does not appear on them */
  sheetQty: { qty: number; pages: number[] } | null;
  /** The item's number when its order says OCR misread it: “5.2” between 3.1 and 3.3 is 3.2 */
  fixedNo: string | null;
  /** No unit was read; the unit given is a guess */
  unitGuessed: boolean;
}

/** A page holds the scope list when this many numbered work items are read off it */
const MIN_ITEMS_ON_PAGE = 4;

const THAI_DIGITS = /[๐-๙]/g;
const toArabic = (s: string) => s.replace(THAI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0e50));

/** 9,000.00 · 1,800,00 and 1.800.00 (OCR swaps comma and dot) · 330.00 · 90 */
const NUM = String.raw`\d{1,3}(?:[,.]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;

/** Reads a number however OCR wrote its separators: the last group of one or two digits is the decimals */
export function parseThaiNumber(s: string): number {
  const groups = toArabic(s).split(/[,.]/);
  if (groups.length === 1) return Number(groups[0]);
  const last = groups[groups.length - 1]!;
  if (last.length === 3) return Number(groups.join(''));
  return Number(`${groups.slice(0, -1).join('')}.${last}`);
}

const UNITS: { re: string; unit: string; kind: TakeoffKind }[] = [
  { re: String.raw`ตารางเมตร|ตาราง\s?เมตร|ตร\.?\s?ม\.?`, unit: 'ตร.ม.', kind: 'area' },
  { re: String.raw`ลูกบาศก์เมตร|ลบ\.?\s?ม\.?`, unit: 'ลบ.ม.', kind: 'volume' },
  { re: String.raw`กิโลเมตร|กม\.`, unit: 'กม.', kind: 'length' },
  { re: String.raw`เมตร|ม\.`, unit: 'ม.', kind: 'length' },
  { re: String.raw`บ[่]?อ`, unit: 'บ่อ', kind: 'count' },
  { re: String.raw`ฝา`, unit: 'ฝา', kind: 'count' },
  { re: String.raw`ชุด|คุด`, unit: 'ชุด', kind: 'count' },
  { re: String.raw`งาน`, unit: 'งาน', kind: 'count' },
  { re: String.raw`แห[่]?ง`, unit: 'แห่ง', kind: 'count' },
  { re: String.raw`จุด`, unit: 'จุด', kind: 'count' },
  { re: String.raw`ต[้]?น`, unit: 'ต้น', kind: 'count' },
  { re: String.raw`ตัว`, unit: 'ตัว', kind: 'count' },
  { re: String.raw`เครื[่]?อง`, unit: 'เครื่อง', kind: 'count' },
  { re: String.raw`หลัง`, unit: 'หลัง', kind: 'count' },
  { re: String.raw`โคม`, unit: 'โคม', kind: 'count' },
];
const UNIT_RE = UNITS.map((u) => `(${u.re})`).join('|');

/** “พื้นที่รวมประมาณ 9,000.00 ตารางเมตร”, “จำนวน 90 บ่อ”, and the measure word before them */
const TOTAL = new RegExp(
  String.raw`(?:(?:พ[ืั]?[้]?น\s?ท[ีิึ]?[่]?|ความยาว|ยาว|ปริมาตร)\s*)?(รวม|จ[ำํ]?า?นวน|จําบวน)\s*(?:ทั้งหมด)?\s*(?:ประมา[ณนฌ])?\s*[:=]?\s*(${NUM})\s*(?:${UNIT_RE})?`,
  'g',
);
/** Any number with a unit, for a line that has no รวม/จำนวน: “… ความยาวประมาณ 1,800.00 เมตร” */
const ANY_QTY = new RegExp(String.raw`(?:(?:ความยาว|ยาว|พ[ืั]?[้]?น\s?ท[ีิึ]?[่]?)\s*)?(?:ประมา[ณนฌ])?\s*(${NUM})\s*(?:${UNIT_RE})(?!\s*(?:/|ต่อ|x|×|%))`, 'g');
/** A size, not a quantity: 0.90x1.50 ม., 3.50 x 2.50 เมตร */
const SIZE = new RegExp(String.raw`(?:${NUM})\s*[x×%«]\s*(?:${NUM})(?:\s*[x×%]\s*(?:${NUM}))?\s*(?:${UNIT_RE})?`, 'g');

function unitOf(m: RegExpExecArray, first: number): { unit: string; kind: TakeoffKind } | null {
  for (let i = 0; i < UNITS.length; i++) if (m[first + i]) return UNITS[i]!;
  return null;
}

/** The item's quantity and the line with it taken out (the name that is left) */
function readQuantity(line: string): { qty: number; unit: string; kind: TakeoffKind; unitGuessed: boolean; name: string } | null {
  const plain = line.replace(SIZE, (s) => ' '.repeat(s.length));
  TOTAL.lastIndex = 0;
  const totals = [...plain.matchAll(TOTAL)];
  // The first total with a unit; “… จำนวน 90 บ่อ พร้อมฝา … จำนวน 90 ฝา” is 90 บ่อ, the lids come with them
  const withUnit = totals.find((m) => unitOf(m as RegExpExecArray, 3));
  const m = (withUnit ?? totals[0] ?? [...plain.matchAll(ANY_QTY)].pop()) as RegExpExecArray | undefined;
  if (!m) return null;
  const isTotal = m[0].match(/รวม|จ[ำํ]?า?นวน|จําบวน/) !== null;
  const numIdx = isTotal ? 2 : 1;
  const u = unitOf(m, numIdx + 1);
  const qty = parseThaiNumber(m[numIdx]!);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const name = line
    .slice(0, m.index)
    .replace(/[\s,.:;\-–—=]+$/, '')
    .trim();
  return { qty, unit: u?.unit ?? 'งาน', kind: u?.kind ?? 'count', unitGuessed: !u, name };
}

/** “2.1 งาน…” (OCR may drop the dot or read it as a comma, or glue a stray digit on: “1.11งาน”) */
const ITEM = /^\s*[^\dก-๙]{0,3}(\d{1,2})\s*[.,]\s*(\d{1,2})\s*(?=[ก-๙A-Za-z])(.+)$/;
/** “1. งานรื้อถอน” · “3 งานปรับปรุง…” · “4. ก่อสร้างบ่อสูบน้ำ … จำนวน 1 บ่อ” */
const SECTION = /^\s*[^\dก-๙]{0,3}(\d{1,2})\s*\.?\s*(?=[ก-๙])((?:งาน|ก่อสร้าง|กอสราง|ปรับปรุง|ติดตั้ง|รื้อ|วาง)[ก-๙].*)$/;
const WORK = /งาน|ปรับปรุง|ก่อสร้าง|ติดตั้ง|รื้อ|วาง|ซ่อม|ทาสี/;

interface Row {
  page: number;
  text: string;
  item?: { major: number; minor: number; rest: string };
  section?: { no: number; rest: string };
}

function readRows(lines: TextLine[]): Row[] {
  return lines.flatMap(({ page, text }) =>
    // The title block sits beside the list, far to the right: only the first column is the list
    splitColumns(fixOcrThai(normalizeThai(toArabic(text)))).slice(0, 1).map((t): Row => {
      const it = ITEM.exec(t);
      if (it && WORK.test(it[3]!)) {
        // “1.11งาน” after 1.0 is 1.1 with a stray digit; a minor number is never above 30 in a list like this
        const minor = Number(it[2]!.length === 2 && Number(it[2]) > 30 ? it[2]![0] : it[2]);
        return { page, text: t, item: { major: Number(it[1]), minor, rest: it[3]!.trim() } };
      }
      const se = SECTION.exec(t);
      if (se) return { page, text: t, section: { no: Number(se[1]), rest: se[2]!.trim() } };
      return { page, text: t };
    }),
  );
}

/** Same count of digits, one digit apart, or one leading digit lost (“1,800” read as “800”) */
function oneSlipApart(a: number, b: number): boolean {
  const x = String(a),
    y = String(b);
  if (x === y) return false;
  if (x.length === y.length) {
    let diff = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff++;
    return diff === 1;
  }
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return long.length === short.length + 1 && long.endsWith(short);
}

/**
 * Items of the scope list, in its order. `written` are the quantities read off all the sheets
 * (extractTextItems), which each item is checked against.
 */
export function extractScopeItems(lines: TextLine[], written: TextQtyItem[] = []): ScopeItem[] {
  const rows = readRows(lines);
  const perPage = new Map<number, number>();
  for (const r of rows) if (r.item) perPage.set(r.page, (perPage.get(r.page) ?? 0) + 1);
  const scopePages = new Set([...perPage].filter(([, n]) => n >= MIN_ITEMS_ON_PAGE).map(([p]) => p));
  if (!scopePages.size) return [];

  interface Draft extends Omit<ScopeItem, 'confirmedOn' | 'sheetQty' | 'fixedNo' | 'key'> {
    major: number;
    minor: number;
  }
  const drafts: Draft[] = [];
  const sectionNames = new Map<number, string>();
  let section = 0;
  let open: Draft | null = null;
  for (const r of rows) {
    if (!scopePages.has(r.page)) continue;
    if (r.item) {
      const q = readQuantity(r.item.rest);
      open = {
        no: `${r.item.major}.${r.item.minor}`,
        major: r.item.major,
        minor: r.item.minor,
        sectionNo: String(section || r.item.major),
        sectionName: '',
        description: (q?.name || r.item.rest).slice(0, 300),
        kind: q?.kind ?? 'count',
        unit: q?.unit ?? 'งาน',
        qty: q?.qty ?? 0,
        unitGuessed: q ? q.unitGuessed : true,
        page: r.page,
        source: r.text.slice(0, 300),
      };
      drafts.push(open);
    } else if (r.section) {
      section = r.section.no;
      const q = readQuantity(r.section.rest);
      sectionNames.set(section, (q?.name || r.section.rest).slice(0, 200));
      open = null;
      if (q) {
        // A section that is one piece of work with its own quantity: “4. ก่อสร้างบ่อสูบน้ำ … จำนวน 1 บ่อ”
        drafts.push({ no: String(section), major: section, minor: 0, sectionNo: String(section), sectionName: '', description: q.name.slice(0, 300), kind: q.kind, unit: q.unit, qty: q.qty, unitGuessed: q.unitGuessed, page: r.page, source: r.text.slice(0, 300) });
      }
    } else if (open && open.qty === 0 && /[ก-๙]{3}|\d/.test(r.text)) {
      // The item ran onto the next line: “3.3 งานพ่นสี … พื้นที่รวมประมาณ” / “1,020.00 ตารางเมตร”
      const joined = `${open.description} ${r.text}`;
      const q = readQuantity(joined);
      if (q) Object.assign(open, { description: q.name.slice(0, 300), kind: q.kind, unit: q.unit, qty: q.qty, unitGuessed: q.unitGuessed, source: `${open.source} ${r.text}`.slice(0, 300) });
      open = null;
    }
  }

  // Item numbers that break the list's order: under section 3, between 3.1 and 3.3, “5.2” is 3.2
  const fixed = drafts.map((d, i) => {
    if (d.minor === 0) return null;
    const prev = drafts[i - 1];
    const next = drafts[i + 1];
    const expected = Number(d.sectionNo);
    if (d.major === expected) return null;
    const fitsPrev = !prev || prev.major === expected;
    const fitsNext = !next || next.major === expected || next.minor === 0;
    return fitsPrev && fitsNext ? `${expected}.${d.minor}` : null;
  });

  // What the sheets write: the notes read into items, and any number with a unit on a sheet's lines,
  // since a note OCR garbled the words of (“พันทึ๊ประมาณ 5,140.00 ตารางเมตร”) still has its number
  const others = written.map((w) => ({ unit: w.unit, qty: w.qty, pages: w.pages.filter((p) => !scopePages.has(p)) })).filter((w) => w.pages.length > 0);
  for (const r of rows) {
    if (scopePages.has(r.page)) continue;
    const plain = r.text.replace(SIZE, (x) => ' '.repeat(x.length));
    for (const m of plain.matchAll(ANY_QTY)) {
      const u = unitOf(m as RegExpExecArray, 2);
      const qty = parseThaiNumber(m[1]!);
      if (u && qty > 0) others.push({ unit: u.unit, qty, pages: [r.page] });
    }
  }
  return drafts.map((d, i): ScopeItem => {
    const sameUnit = others.filter((w) => w.unit === d.unit);
    const same = sameUnit.filter((w) => w.qty === d.qty);
    const confirmedOn = [...new Set(same.flatMap((w) => w.pages))].sort((a, b) => a - b);
    let sheetQty: ScopeItem['sheetQty'] = null;
    if (!confirmedOn.length && d.qty > 0) {
      const near = sameUnit.filter((w) => oneSlipApart(w.qty, d.qty)).sort((a, b) => b.pages.length - a.pages.length)[0];
      if (near) sheetQty = { qty: near.qty, pages: [...near.pages].sort((a, b) => a - b) };
    }
    const sectionNo = fixed[i] ? fixed[i]!.split('.')[0]! : d.sectionNo;
    return {
      no: d.no,
      description: d.description,
      kind: d.kind,
      unit: d.unit,
      qty: d.qty,
      page: d.page,
      source: d.source,
      unitGuessed: d.unitGuessed,
      key: `scope|${d.page}|${i}`,
      sectionNo,
      sectionName: sectionNames.get(Number(sectionNo)) ?? '',
      confirmedOn,
      sheetQty,
      fixedNo: fixed[i],
    };
  });
}
