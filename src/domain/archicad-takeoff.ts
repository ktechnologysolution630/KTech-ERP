import { parseDecimalInput } from './money';
import type { TakeoffKind } from './boq-takeoff';

/**
 * Quantities taken off an Archicad model. Archicad keeps the BIM model on the user's computer and
 * answers its JSON API only on localhost, so the web app cannot ask it directly. The script offered
 * in the dialog (public/tools/archicad) reads the model there and writes a CSV in the same columns as
 * a BOQ export (ลำดับ, รายการ, จำนวน, หน่วย, … หมายเหตุ); this reads that CSV back into take-off items.
 */

export interface ArchicadRow {
  category: string;
  description: string;
  kind: TakeoffKind;
  unit: string;
  qty: number;
  note: string;
}

export interface ArchicadParseResult {
  rows: ArchicadRow[];
  /** Item rows left out because their quantity is missing, zero or not a number, by their ลำดับ */
  skipped: string[];
}

const COUNT_UNITS = ['ชุด', 'จุด', 'ชิ้น', 'ตัว', 'บ่อ', 'ต้น', 'แผ่น', 'อัน', 'เครื่อง', 'ท่อน', 'เส้น', 'ห้อง', 'ช่อง', 'บาน', 'ลูก', 'หลัง', 'งาน', 'แห่ง', 'คู่', 'ea', 'pcs', 'no', 'nos', 'set'];

const unitKey = (u: string) => u.replace(/\s+/g, '').replace(/\.$/, '').toLowerCase();

/**
 * Which way the item is measured. A volume (ลบ.ม.) has no tool of its own on the drawing; it is an
 * area with the thickness as its factor, so it is kept as an area item.
 */
export function kindOfUnit(unit: string): TakeoffKind {
  const u = unitKey(unit);
  if (u === 'ม' || u === 'เมตร' || u === 'm' || u === 'ม.ย' || u === 'เมตรยาว' || u === 'lm') return 'length';
  if (COUNT_UNITS.includes(u)) return 'count';
  return 'area';
}

const get = (row: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined) return v.trim();
  }
  return '';
};

/**
 * Rows of the CSV, keyed by header (as `parseCsvText` gives them). A row whose ลำดับ has no dot and no
 * quantity is a category heading; the item rows under it take its name.
 */
export function parseArchicadRows(rows: Record<string, string>[]): ArchicadParseResult {
  const out: ArchicadRow[] = [];
  const skipped: string[] = [];
  let category = '';
  for (const r of rows) {
    const no = get(r, 'ลำดับ', 'No', 'no');
    const description = get(r, 'รายการ', 'Description', 'description');
    const qtyText = get(r, 'จำนวน', 'Qty', 'qty').replace(/,/g, '');
    const unit = get(r, 'หน่วย', 'Unit', 'unit');
    if (!description) continue;
    const isHeading = !no.includes('.') && qtyText === '' && unit === '';
    if (isHeading) {
      category = description;
      continue;
    }
    const qty = parseDecimalInput(qtyText)?.toNumber();
    if (qty === undefined || !Number.isFinite(qty) || qty <= 0) {
      skipped.push(no || description);
      continue;
    }
    out.push({
      category: category || 'ไม่ระบุหมวด',
      description: description.slice(0, 1000),
      kind: kindOfUnit(unit),
      unit: unit.slice(0, 50),
      qty,
      note: get(r, 'หมายเหตุ', 'Note', 'note').slice(0, 500),
    });
  }
  return { rows: out, skipped };
}
