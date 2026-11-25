import type { TakeoffKind } from './boq-takeoff';

/**
 * Take-off from what is written on the drawing. Thai drawings, above all government ones, write the
 * quantities of the work in their notes: “ก่อสร้างถนนลาดยาง กว้าง 5.00 เมตร ยาวประมาณ 1,800.00 เมตร
 * พื้นที่ประมาณ 9,000.00 ตารางเมตร”, “บ่อพัก คสล. ขนาด 0.90x1.50 ม. จำนวน 90 บ่อ”. Those notes are
 * read here, from the PDF's own text or from OCR of a scan, into BOQ items with their quantity.
 *
 * OCR of Thai drops or swaps tone marks and vowels (บอพัก, จํานวน, พื้นที), so matching is loose on
 * purpose and every item keeps the line it came from for the user to check.
 */

export interface TextLine {
  page: number;
  text: string;
}

export interface TextQtyItem {
  key: string;
  description: string;
  kind: TakeoffKind;
  unit: string;
  qty: number;
  /** Pages the same note was found on (the same quantity is counted once) */
  pages: number[];
  /** The line as read, so the user can check it */
  source: string;
}

const NUM = String.raw`(\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
/** Thai OCR may give ำ as ํ + า, and loses tone marks; this puts back what matching needs */
export function normalizeThai(s: string): string {
  return s
    .normalize('NFC')
    .replace(/ํา/g, 'ำ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[|“”"‘’`~_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COUNT_UNITS: Record<string, string> = {
  บ่อ: 'บ่อ',
  บอ: 'บ่อ',
  จุด: 'จุด',
  ต้น: 'ต้น',
  ตน: 'ต้น',
  ชุด: 'ชุด',
  ตัว: 'ตัว',
  แห่ง: 'แห่ง',
  แหง: 'แห่ง',
  ท่อน: 'ท่อน',
  ทอน: 'ท่อน',
  เส้น: 'เส้น',
  เสน: 'เส้น',
  แผ่น: 'แผ่น',
  แผน: 'แผ่น',
  ดวง: 'ดวง',
  โคม: 'โคม',
  หลัง: 'หลัง',
  ป้าย: 'ป้าย',
  ปาย: 'ป้าย',
  บาน: 'บาน',
  อัน: 'อัน',
  เครื่อง: 'เครื่อง',
  เครือง: 'เครื่อง',
  ลูก: 'ลูก',
  ก้อน: 'ก้อน',
  กอน: 'ก้อน',
  ตู้: 'ตู้',
  ตู: 'ตู้',
  คู่: 'คู่',
  ช่อง: 'ช่อง',
  ชอง: 'ช่อง',
  ม้า: 'ตัว',
  กระถาง: 'กระถาง',
};
const COUNT_UNIT_RE = Object.keys(COUNT_UNITS)
  .sort((a, b) => b.length - a.length)
  .join('|');

interface Rule {
  re: RegExp;
  kind: TakeoffKind;
  unit: (m: RegExpExecArray) => string;
  qty: (m: RegExpExecArray) => number;
}

const num = (s: string) => Number(s.replace(/[,，]/g, ''));
// Words between the measure and the number that OCR often reads: รวม, ประมาณ (ประมาน, ประมาฌ), ทั้งหมด
const ABOUT = String.raw`(?:\s*(?:รวม|ทั้งหมด|ทังหมด|ประมา[ณนฌ]|ประมา|ราว|ไม่น้อยกว่า|ไมนอยกวา))*\s*[:=]?\s*`;

/** “ยาว 6.00 ม./ต้น” is the size of one piece, not a quantity of work */
const NOT_PER = String.raw`(?!\s*(?:/|ต่อ))`;

const RULES: Rule[] = [
  {
    // ยาวประมาณ 1,800.00 เมตร · ความยาวรวม 250 ม. · ระยะทาง 1.8 กม.
    re: new RegExp(String.raw`(?:ความยาว|ยาว|ระยะทาง)${ABOUT}${NUM}\s*(กิโลเมตร|กม\.?|เมตร|ม\.)${NOT_PER}`, 'g'),
    kind: 'length',
    unit: () => 'ม.',
    qty: (m) => num(m[1]!) * (/^(กิโลเมตร|กม)/.test(m[2]!) ? 1000 : 1),
  },
  {
    // พื้นที่ประมาณ 9,000.00 ตารางเมตร · พื้นที่รวม 1,020 ตร.ม.
    re: new RegExp(String.raw`(?:พ[ืิ]?[้]?น\s?ท[ีึิ]?[่]?|เน[ื]?[้]?อท[ีึ]?[่]?)${ABOUT}${NUM}\s*(ตารางเมตร|ตร\.?\s?ม\.?)`, 'g'),
    kind: 'area',
    unit: () => 'ตร.ม.',
    qty: (m) => num(m[1]!),
  },
  {
    // ปริมาตร 12.5 ลูกบาศก์เมตร
    re: new RegExp(String.raw`(?:ปริมาตร|ปริมาณ)${ABOUT}${NUM}\s*(ลูกบาศก์เมตร|ลบ\.?\s?ม\.?)`, 'g'),
    kind: 'count',
    unit: () => 'ลบ.ม.',
    qty: (m) => num(m[1]!),
  },
  {
    // จำนวน 90 บ่อ · จํานวน 12 ต้น
    re: new RegExp(String.raw`(?:จำนวน|จานวน|จํานวน|จำนาน)${ABOUT}${NUM}\s*(${COUNT_UNIT_RE})${NOT_PER}`, 'g'),
    kind: 'count',
    unit: (m) => COUNT_UNITS[m[2]!] ?? m[2]!,
    qty: (m) => num(m[1]!),
  },
];

const THAI = /[ก-๛]/g;
const thaiCount = (s: string) => (s.match(THAI) ?? []).length;

/** Sheet references, sign-offs, remarks, legend entries and drawing titles do not name work items */
const NOT_WORK = /^\(?\s*(ดูแบบ|ดูรายละเอียด|นาย|นาง|หมายเหตุ|แบบ|แปลน|รูปตัด|รูปด้าน|ผัง|มาตรา|ทิศเหนือ|แสดง|แลดง|สัญลักษณ์|ตำแหน่ง|ตำแหนง|วิศวกร|วิดวกร|ผู้อำนวยการ|ผู้อํานวยการ|หัวหน้า|เขียนแบบ|ออกแบบ|ตรวจ|อนุมัติ|เห็นชอบ|นายก|สำนัก|ลำนัก|โครงการ|สถานที่|ทะเบียนแบบ|แผ่นที่)/;

/** A line that names work: mostly Thai letters, and not one of the lines above */
function isHeading(s: string): boolean {
  const letters = s.replace(/[\s\d.,:;()\-–—/x×]/g, '');
  if (thaiCount(s) < 10 || thaiCount(s) < letters.length * 0.7 || !/[ก-๙]{4,}/.test(s)) return false;
  // A legend entry starts with its symbol drawn as text: <= → ⇐ ●
  if (/^[<>=←→⇐⇒●○■□◄►▲▼@*#]/.test(s.trim())) return false;
  if (NOT_WORK.test(s)) return false;
  return !RULES.some((r) => new RegExp(r.re.source).test(s));
}

/** What the line says before its numbers, with sizes and references taken out */
function cleanDescription(s: string): string {
  return s
    .replace(/\(?\s*ดูแบบ[^)]*\)?/g, '')
    .replace(new RegExp(String.raw`(?:ความ)?(?:กว้าง|กวาง|ควาง|หนา|สูง|ลึก)${ABOUT}${NUM}\s*(?:เมตร|ม\.|ซม\.|เซนติเมตร|มม\.)`, 'g'), '')
    .replace(/\(\s*\)/g, '')
    .replace(/[\s,.:;\-–—=]+$/g, '')
    .replace(/^(?:[ก-๙]?[\s,.:;\-–—=*•»«>_]{2,})+/g, '')
    .replace(/^(?:[A-Za-z]{1,3}\s+)+(?=[ก-๙])/, '')
    .replace(/^[^ก-๙]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    // OCR crumbs at the end: “… มิตรประชา ง1 4 3”
    .replace(/(?:\s+(?:\S*\d\S*|[^\sก-๙]+|[ก-๙]))+$/, (tail) => (tail.length <= 12 ? '' : tail))
    .trim();
}

/**
 * Common construction words as Thai OCR misreads them (in many drawing fonts ส reads as ล and
 * tone marks fall off). Only whole known words are put right, so nothing else is guessed at.
 */
const OCR_FIXES: [RegExp, string][] = [
  [/ก[่ื]?อ[สล][่์]?ร[้่]?าง/g, 'ก่อสร้าง'],
  [/(?<![ก-๙])ค[สล]ั?ล\.?(?=\s|$|[^ก-๛])/g, 'คสล.'],
  [/แอ[สล][์]?[ฟพ]ัลท[ู์่]*[์]?/g, 'แอสฟัลท์'],
  [/เลริม/g, 'เสริม'],
  [/ลํ?าหรับ|ลำหรับ/g, 'สำหรับ'],
  [/[สล]ัญลักษณ[์]?/g, 'สัญลักษณ์'],
  [/พ[ื]?[้]?น[สล]ี(?=\s|[A-Za-z]|$)/g, 'พื้นสี'],
  [/[ขช][้]?องจอดรถ/g, 'ช่องจอดรถ'],
  [/ท[ีิ][่]?จอดรถ/g, 'ที่จอดรถ'],
  [/คนว[ิ]ง/g, 'คนวิ่ง'],
  [/[สล]?แ[สล]ตนเล[สล]/g, 'สแตนเลส'],
  [/วัลดุ/g, 'วัสดุ'],
  [/[บป][่]?อพัก/g, 'บ่อพัก'],
  [/ค[สล]ั?ล\./g, 'คสล.'],
  [/ท[่]?างจักรยาน/g, 'ทางจักรยาน'],
  [/ทาล[ีส]/g, 'ทาสี'],
  [/ค[ัุ]?นหิน/g, 'คันหิน'],
  [/หญ[้]?ามาเลเซีย/g, 'หญ้ามาเลเซีย'],
  [/คืนล?ภาพ/g, 'คืนสภาพ'],
  [/ท[่]?อระบายน[้]*[ำา]/g, 'ท่อระบายน้ำ'],
  [/ระบายน[้]+[ำา]/g, 'ระบายน้ำ'],
  [/ร[่]?องระบายน[้]*[ำา]/g, 'ร่องระบายน้ำ'],
  [/ทางเดินเท[้]?า/g, 'ทางเดินเท้า'],
  [/คอนกรีตเลริมเหล็ก/g, 'คอนกรีตเสริมเหล็ก'],
  [/[สลด][้่๋]?วน[สล][่]?มเด็จ/g, 'สวนสมเด็จ'],
  [/ตำแหน[่]?ง/g, 'ตำแหน่ง'],
  [/พระครีนครินทร[์]?/g, 'พระศรีนครินทร์'],
  [/ปรับปรุงภูมิท[ัู]?[ดศค]น[์]?/g, 'ปรับปรุงภูมิทัศน์'],
  [/ต[้]?นไม[้]?/g, 'ต้นไม้'],
  [/สนามหญ[้]?า/g, 'สนามหญ้า'],
  [/ไม[่]?รวม/g, 'ไม่รวม'],
  [/พื้นท[ีึ](?![่])/g, 'พื้นที่'],
  [/กว[้]?าง/g, 'กว้าง'],
  [/คสล\.\.+/g, 'คสล.'],
];

export const fixOcrThai = (s: string) => OCR_FIXES.reduce((t, [re, to]) => t.replace(re, to), s);

/** Lines of OCR text split where wide gaps show separate columns (a note beside the title block) */
export function splitColumns(text: string): string[] {
  return text
    .split('\n')
    .flatMap((line) => line.split(/\s{4,}/))
    .map((l) => fixOcrThai(normalizeThai(l)))
    .filter(Boolean);
}

const bigrams = (s: string) => {
  const t = s.replace(/[^ก-ฮ]/g, '');
  const out = new Set<string>();
  for (let i = 1; i < t.length; i++) out.add(t.slice(i - 1, i + 1));
  return out;
};
function similar(a: string, b: string): boolean {
  const x = bigrams(a),
    y = bigrams(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return both / Math.min(x.size, y.size) >= 0.5;
}

const keyOf = (s: string) => s.replace(/[^ก-ฮ]/g, '');

/**
 * Lines found on most of the sheets read are the title block (project name, place, sign-offs),
 * not notes about work, so they never name an item.
 */
function boilerplate(lines: TextLine[]): Set<string> {
  const pages = new Map<string, Set<number>>();
  for (const { page, text } of lines) {
    const k = keyOf(fixOcrThai(normalizeThai(text)));
    if (k.length < 6) continue;
    const set = pages.get(k) ?? new Set<number>();
    set.add(page);
    pages.set(k, set);
  }
  const sheets = new Set(lines.map((l) => l.page)).size;
  return new Set([...pages].filter(([, ps]) => sheets >= 3 && ps.size >= Math.max(3, sheets * 0.5)).map(([k]) => k));
}

interface Found {
  page: number;
  line: string;
  description: string | null;
  kind: TakeoffKind;
  unit: string;
  qty: number;
}

/** Items with quantities written on the drawing, merged over pages */
export function extractTextItems(lines: TextLine[]): TextQtyItem[] {
  const skip = boilerplate(lines);
  const found: Found[] = [];
  // Headings seen on the page so far, nearest last
  let page = -1;
  let headings: string[] = [];
  for (const { page: p, text } of lines) {
    if (p !== page) {
      page = p;
      headings = [];
    }
    const line = fixOcrThai(normalizeThai(text));
    const hits: { at: number; kind: TakeoffKind; unit: string; qty: number }[] = [];
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      for (let m = rule.re.exec(line); m; m = rule.re.exec(line)) {
        const qty = rule.qty(m);
        if (Number.isFinite(qty) && qty > 0 && qty < 1e8) hits.push({ at: m.index, kind: rule.kind, unit: rule.unit(m), qty });
      }
    }
    if (!hits.length) {
      const clean = cleanDescription(line);
      if (isHeading(clean) && !skip.has(keyOf(line))) headings.push(clean);
      if (headings.length > 4) headings.shift();
      continue;
    }
    hits.sort((a, b) => a.at - b.at);
    let own = cleanDescription(line.slice(0, hits[0]!.at));
    if (NOT_WORK.test(own) || skip.has(keyOf(own))) own = '';
    // “บ่อพัก คสล. ขนาด 0.90x1.50 ม. จำนวน 90 บ่อ” names itself; “พื้นที่ประมาณ …” takes the heading above.
    // “บริเวณภายใน…” under a note says where, not what; the line above it names the work.
    const heading = [...headings].reverse().find((h) => !/^(บริเวณ|ภายใน|ตั้งแต่|ที่ตั้ง|สถานที่)/.test(h)) ?? headings[headings.length - 1];
    // “ขนาด 0.10 ลบ.ม./วินาที จำนวน 2 เครื่อง” gives the size; the heading above says of what
    const description = thaiCount(own) >= 6 && !/^(ขนาด|กว้าง|ยาว|หนา|สูง|ชนิด|แบบ)/.test(own) ? own : [heading, own].filter(Boolean).join(' ').trim();
    if (thaiCount(own) >= 6 && isHeading(own)) headings.push(own);
    for (const h of hits) found.push({ page: p, line, description: thaiCount(description) >= 4 ? description : null, ...h });
  }

  const items = new Map<string, TextQtyItem>();
  const sameQty = (i: TextQtyItem, f: Found) => i.kind === f.kind && i.unit === f.unit && i.qty === f.qty;
  // Named ones first; a quantity read without its name then joins the same quantity found named elsewhere
  for (const f of [...found.filter((x) => x.description), ...found.filter((x) => !x.description)]) {
    const key = f.description ? `${f.kind}|${f.unit}|${f.qty}|${keyOf(f.description).slice(0, 12)}` : '';
    // The same note read on another sheet, with OCR slips in its words
    const prev = (key && items.get(key)) || [...items.values()].find((i) => sameQty(i, f) && (!f.description || similar(i.description, f.description)));
    if (prev) {
      if (!prev.pages.includes(f.page)) prev.pages.push(f.page);
      continue;
    }
    if (!f.description) continue;
    items.set(key, { key, description: f.description.slice(0, 300), kind: f.kind, unit: f.unit, qty: f.qty, pages: [f.page], source: f.line.slice(0, 300) });
  }
  for (const i of items.values()) i.pages.sort((a, b) => a - b);
  return [...items.values()];
}
