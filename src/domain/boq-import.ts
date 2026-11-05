import { D, parseDecimalInput, round2 } from './money';
import { findDates } from './project-pdf';

/** One spreadsheet cell: its stored value, and the text Excel shows, which keeps numbering like 1.10 intact. */
export interface BoqSheetCell {
  v: string | number;
  w: string;
}

export interface BoqSheetGrid {
  name: string;
  rows: (BoqSheetCell | null)[][];
}

export interface ImportedBoqLine {
  isCategory: boolean;
  isBold: boolean;
  no: string;
  description: string;
  qty: number | '';
  unit: string;
  matRate: number | '';
  labRate: number | '';
  note: string;
}

export interface BoqImportResult {
  lines: ImportedBoqLine[];
  /**
   * The same lines at the price the contract was won at, for a price summary form. It carries both prices:
   * `lines` holds the direct cost, like every other form, and this includes Factor F and VAT. Null for other forms.
   */
  offerLines: ImportedBoqLine[] | null;
  usedSheets: { name: string; categories: number; items: number }[];
  skippedSheets: string[];
  meta: { projectName: string; owner: string; location: string; estimateDate: string };
  /** Items with a quantity but no price; government estimate forms often come with quantities only */
  unpricedItems: number;
  /** Rows the file adds up differently from quantity × rate, by sheet and row number */
  amountMismatches: string[];
  /** Rows that could not be read as they stand, by sheet and row number */
  unreadable: string[];
}

/** Same limits the save applies, so what is shown here is what gets stored. */
const MAX_DESCRIPTION = 1000;
const MAX_NO = 20;
const MAX_UNIT = 50;
const MAX_NOTE = 500;
/** A price summary form opens with smaller tables, so its item table starts further down */
const HEADER_SEARCH_ROWS = 40;
/** A difference of up to this is rounding in the file, not a mistake */
const AMOUNT_TOLERANCE = 1;

const textOf = (cell: BoqSheetCell | null | undefined): string => (cell ? String(cell.v).replace(/\s+/g, ' ').trim() : '');
/** Numbering as Excel shows it: 1.10 is stored as the number 1.1, which would read as the wrong item */
const shownOf = (cell: BoqSheetCell | null | undefined): string => (cell ? (cell.w || String(cell.v)).trim() : '');

function numberOf(cell: BoqSheetCell | null | undefined): number | null {
  if (!cell) return null;
  if (typeof cell.v === 'number') return Number.isFinite(cell.v) ? cell.v : null;
  return parseDecimalInput(cell.v)?.toNumber() ?? null;
}

interface TableColumns {
  headerRow: number;
  no: number;
  description: number;
  qty: number;
  unit: number;
  material: number;
  labor: number | null;
  /** The price column holds the whole amount rather than a rate per unit */
  priceIsTotal: boolean;
  amountMaterial: number | null;
  amountLabor: number | null;
  amountTotal: number | null;
  note: number | null;
  /** Price summary form: the price column includes this factor, and the cost column is not always per unit */
  factor: number | null;
  offerUnitPrice: number | null;
  /** Only the richest kind of table in a file is used, because the others repeat the same work */
  kind: TableKind;
}

/** Higher is better: a BOQ with material and labour, then a price summary, then a plain price list. */
const TABLE_KIND = { PRICE_LIST: 0, PRICE_SUMMARY: 1, FULL: 2 } as const;
type TableKind = (typeof TABLE_KIND)[keyof typeof TABLE_KIND];

/** Finds the table on a sheet by its headings, which may span two rows; the description column often has no heading at all. */
function findTable(rows: BoqSheetGrid['rows']): TableColumns | null {
  for (let r = 0; r < Math.min(rows.length, HEADER_SEARCH_ROWS); r++) {
    const top = (rows[r] ?? []).map(textOf);
    const noColumn = top.findIndex((t) => /^ลำดับ/.test(t));
    const qty = top.findIndex((t) => /^(จำนวน|ปริมาณ)$/.test(t));
    const unit = top.findIndex((t) => /^หน่วย/.test(t));
    if (noColumn < 0 || qty < 0 || unit < 0) continue;

    const sub = (rows[r + 1] ?? []).map(textOf);
    const named = top.findIndex((t) => /^(รายการ|รายละเอียด|ชื่อรายการ)/.test(t));
    const description = named >= 0 ? named : noColumn + 1;
    if (description >= qty) continue;

    const headingAt = (c: number) => `${top[c] ?? ''} ${sub[c] ?? ''}`;
    const columnsFrom = (start: number) => {
      // Under a merged heading: the rate comes first, then its amount
      const rate = [start, start + 1].find((c) => /ราคา|หน่วย/.test(headingAt(c)) && !/จำนวนเงิน/.test(headingAt(c))) ?? start;
      const amount = [rate + 1].find((c) => /จำนวนเงิน/.test(sub[c] ?? ''));
      return { rate, amount: amount ?? null };
    };
    const materialStart = top.findIndex((t, c) => c > unit && /วัสดุ/.test(t) && !/แรง/.test(t));
    const laborStart = top.findIndex((t, c) => c > unit && /แรง/.test(t) && !/วัสดุ/.test(t));
    const totalColumn = top.findIndex((t, c) => c > unit && (/รวม/.test(t) || /รวม/.test(sub[c] ?? '')) && (/วัสดุ|แรง|เงิน/.test(t) || /วัสดุ|แรง|เงิน/.test(sub[c] ?? '')));
    const noteColumn = top.findIndex((t) => /^หมายเหตุ/.test(t));
    const shared = {
      headerRow: top.some((t) => t) && sub.some((t) => /จำนวนเงิน|ราคา/.test(t)) ? r + 1 : r,
      no: noColumn,
      description,
      qty,
      unit,
      note: noteColumn >= 0 ? noteColumn : null,
      factor: null,
      offerUnitPrice: null,
    };

    if (materialStart >= 0 && laborStart >= 0) {
      const material = columnsFrom(materialStart);
      const labor = columnsFrom(laborStart);
      return { ...shared, material: material.rate, labor: labor.rate, priceIsTotal: false, amountMaterial: material.amount, amountLabor: labor.amount, amountTotal: totalColumn >= 0 ? totalColumn : null, kind: TABLE_KIND.FULL };
    }
    const lumpSum = top.findIndex((t, c) => c > unit && /ค่าใช้จ่ายรวม/.test(t));
    if (lumpSum >= 0) {
      return { ...shared, material: lumpSum, labor: null, priceIsTotal: true, amountMaterial: null, amountLabor: null, amountTotal: null, kind: TABLE_KIND.FULL };
    }
    const afterQuantities = Math.max(unit, qty);
    const subAfter = (pattern: RegExp) => sub.findIndex((t, c) => c > afterQuantities && pattern.test(t));
    const factor = subAfter(/factor/i);
    const middlePrice = subAfter(/^ราคากลาง/);
    if (factor >= 0 && middlePrice >= 0) {
      const offer = subAfter(/ราคาต่อหน่วย/);
      return { ...shared, material: middlePrice, labor: null, priceIsTotal: true, amountMaterial: null, amountLabor: null, amountTotal: null, factor, offerUnitPrice: offer >= 0 ? offer : null, kind: TABLE_KIND.PRICE_SUMMARY };
    }
    const price = top.findIndex((t, c) => c > unit && /ราคา/.test(t));
    if (price >= 0) {
      const single = columnsFrom(price);
      return { ...shared, material: single.rate, labor: null, priceIsTotal: false, amountMaterial: single.amount, amountLabor: null, amountTotal: null, kind: TABLE_KIND.PRICE_LIST };
    }
  }
  return null;
}

/** Totals the file adds itself: counting them as well would double the BOQ. */
const isRollup = (description: string, unit: string, qty: number | null) => unit === 'รวม' || (qty === null && /^(รวม|สรุป)/.test(description));
/** A page heading repeated partway down, or the signature block at the end */
const isNotALine = (description: string, no: string) => /^ลำดับ/.test(no) || /^(รายการ|ลงชื่อ|\(ลงชื่อ\)|ผู้ประมาณ|คณะกรรมการ)/.test(description);
const isWholeNumber = (no: string) => /^\d+\.?$/.test(no);
const clip = (text: string, max: number) => text.slice(0, max);

/** A price summary has one price per line, but a line named as labour is still labour. */
const isLaborLine = (description: string) => /^-?\s*ค่าแรง/.test(description);

function readTable(sheet: BoqSheetGrid, table: TableColumns, result: BoqImportResult): { categories: number; items: number } {
  const lines: ImportedBoqLine[] = [];
  const offerLines: ImportedBoqLine[] = [];
  const parsed = sheet.rows.slice(table.headerRow + 1).map((row, offset) => ({ row: row ?? [], rowNumber: table.headerRow + offset + 2 }));
  const headings = parsed.filter(({ row }) => numberOf(row[table.qty]) === null && !isRollup(textOf(row[table.description]), textOf(row[table.unit]), null));
  const numberedSections = headings.some(({ row }) => textOf(row[table.description]) && isWholeNumber(shownOf(row[table.no])));

  for (const { row, rowNumber } of parsed) {
    const description = textOf(row[table.description]);
    const no = shownOf(row[table.no]);
    if (!description || isNotALine(description, no)) continue;
    const unit = textOf(row[table.unit]);
    const qtyCell = row[table.qty];
    let qty = numberOf(qtyCell);
    if (isRollup(description, unit, qty)) continue;

    const where = `${sheet.name.trim()} แถว ${rowNumber}`;
    if (qty !== null && qty < 0) {
      result.unreadable.push(`${where}: จำนวนติดลบ`);
      qty = null;
    } else if (qty === null && textOf(qtyCell)) {
      result.unreadable.push(`${where}: จำนวน "${textOf(qtyCell)}" ไม่ใช่ตัวเลข`);
    }

    const noteCells = table.note === null ? [] : [row[table.note], row[table.note + 1], row[table.note + 2]];
    // Some forms write a remark one column past the heading, beside helper figures
    const note = noteCells.find((c) => c && typeof c.v === 'string' && c.v.trim() && numberOf(c) === null);
    const stated = numberOf(row[table.material]);
    const factor = table.factor === null ? null : numberOf(row[table.factor]);
    // The cost column holds a rate on some rows and an amount on others, so it is worked back from the priced amount
    const rawMaterial = stated !== null && factor ? D(stated).div(factor).toNumber() : stated;
    const rawLabor = table.labor === null ? null : numberOf(row[table.labor]);

    if (qty === null && !rawMaterial && !rawLabor) {
      // Sections become categories. Sub-headings and lines that ran over from the row above stay as text, in place, so nothing is lost
      const unnumberedSection = table.factor !== null && /^(งาน|ค่าใช้จ่าย)/.test(description);
      const section = numberedSections ? isWholeNumber(no) || unnumberedSection : !/^\s*-/.test(description);
      const heading = { isCategory: section, isBold: section || no !== '', no: clip(no, MAX_NO), description: clip(description, MAX_DESCRIPTION), qty: '' as const, unit: '', matRate: '' as const, labRate: '' as const, note: clip(textOf(note), MAX_NOTE) };
      lines.push(heading);
      offerLines.push(heading);
      continue;
    }

    const roundedQty = qty === null ? '' : D(qty).toDecimalPlaces(3).toNumber();
    const perUnit = (amount: number | null) => {
      if (amount === null) return '' as const;
      const rate = table.priceIsTotal && qty ? D(amount).div(qty) : D(amount);
      return round2(rate).toNumber();
    };
    const asLabor = table.factor !== null && isLaborLine(description);
    const matRate = asLabor ? '' : perUnit(rawMaterial);
    const labRate = asLabor ? perUnit(rawMaterial) : perUnit(rawLabor);
    if (!matRate && !labRate) result.unpricedItems += 1;

    const quantity = roundedQty === '' ? 0 : roundedQty;
    const expected = [
      [table.amountMaterial, D(quantity).times(matRate || 0)],
      [table.amountLabor, D(quantity).times(labRate || 0)],
      [table.amountTotal, D(quantity).times(matRate || 0).plus(D(quantity).times(labRate || 0))],
    ] as const;
    const differs = expected.some(([column, computed]) => {
      const stated = column === null ? null : numberOf(row[column]);
      return stated !== null && stated !== 0 && computed.minus(stated).abs().gt(AMOUNT_TOLERANCE);
    });
    if (differs) result.amountMismatches.push(where);

    const line: ImportedBoqLine = { isCategory: false, isBold: false, no: clip(no, MAX_NO), description: clip(description, MAX_DESCRIPTION), qty: roundedQty, unit: clip(unit, MAX_UNIT), matRate, labRate, note: clip(textOf(note), MAX_NOTE) };
    lines.push(line);
    const offer = table.offerUnitPrice === null ? null : numberOf(row[table.offerUnitPrice]);
    const offerRate = offer === null ? ('' as const) : round2(D(offer)).toNumber();
    offerLines.push({ ...line, matRate: asLabor ? '' : offerRate, labRate: asLabor ? offerRate : '' });
  }
  result.lines.push(...lines);
  if (table.offerUnitPrice !== null) result.offerLines = [...(result.offerLines ?? []), ...offerLines];
  return { categories: lines.filter((l) => l.isCategory).length, items: lines.filter((l) => l.qty !== '').length };
}

const META_LABELS: [keyof BoqImportResult['meta'], RegExp][] = [
  ['projectName', /โครงการ/],
  ['owner', /^เจ้าของ/],
  ['location', /^สถานที่/],
  ['estimateDate', /เมื่อวันที่|^วันที่|^ประมาณราคา/],
];

/** The lines above the table name the project, its owner and site, and the date of the estimate. */
function readMeta(sheet: BoqSheetGrid, table: TableColumns, meta: BoqImportResult['meta']): void {
  for (const row of sheet.rows.slice(0, table.headerRow)) {
    const cells = (row ?? []).map(textOf);
    const at = cells.findIndex(Boolean);
    if (at < 0) continue;
    const label = cells[at]!;
    const value = cells.slice(at + 1).find(Boolean) ?? '';
    // A summary form gives the project as a line of its own, not as a label and a value
    if (!value && !meta.projectName && /^โครงการ/.test(label)) meta.projectName = clip(label, 300);
    for (const [key, pattern] of META_LABELS) {
      if (meta[key] || !pattern.test(label) || !value) continue;
      if (key === 'estimateDate') meta[key] = findDates(value.replace(/เดือน|วันที่/g, ' '))[0] ?? '';
      else meta[key] = clip(value, 300);
      break;
    }
  }
}

/**
 * Picks the BOQ tables out of a workbook and keeps only what the BOQ needs. Summaries, price lists and factor
 * tables are left out: they have no material and labour columns, or repeat figures a BOQ table already holds.
 */
export function parseBoqWorkbook(sheets: BoqSheetGrid[]): BoqImportResult {
  const result: BoqImportResult = {
    lines: [],
    offerLines: null,
    usedSheets: [],
    skippedSheets: [],
    meta: { projectName: '', owner: '', location: '', estimateDate: '' },
    unpricedItems: 0,
    amountMismatches: [],
    unreadable: [],
  };
  const found = sheets.map((sheet) => ({ sheet, table: findTable(sheet.rows) }));
  // A summary or a plain price list counts only if the file has nothing richer
  const bestKind = Math.max(...found.map(({ table }) => table?.kind ?? -1));
  for (const { sheet, table } of found) {
    if (!table || table.kind !== bestKind) {
      result.skippedSheets.push(sheet.name.trim());
      continue;
    }
    readMeta(sheet, table, result.meta);
    result.usedSheets.push({ name: sheet.name.trim(), ...readTable(sheet, table, result) });
  }
  return result;
}
