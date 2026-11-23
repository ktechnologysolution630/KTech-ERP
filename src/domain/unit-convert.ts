/**
 * Converting a BOQ row to another unit (กก. → เส้น) while keeping its money the same:
 * quantity is divided by how many old units make one new unit, unit rates are multiplied by it.
 */
import { D, round2 } from '@/domain/money';

/** Density of steel, kg per m per mm² of section */
const STEEL_KG_PER_M_PER_MM2 = 0.00785;
/** Thai stock lengths: sections and rebar */
const SECTION_BAR_M = 6;
const REBAR_BAR_M = 10;
/** 4 ft × 8 ft plate, m² */
const PLATE_SHEET_M2 = 1.2192 * 2.4384;

export interface WeightEstimate {
  /** Unit one piece is counted in */
  unit: string;
  /** kg in one piece */
  kgPerUnit: number;
  /** How it was worked out, for the person to check */
  basis: string;
}

const num = (s: string) => Number(s.replace(',', '.'));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Standard weight of one piece of the steel a BOQ row names, or null when the row is not a known shape.
 * Box/pipe a×b×t, H/I/wide-flange a×b×t1×t2 and rebar per 6 m / 10 m bar; plate t mm per 4×8 ft sheet.
 */
export function estimateSteelWeight(description: string): WeightEstimate | null {
  const d = description.toLowerCase().replace(/\s+/g, ' ');
  const dims = (re: RegExp) => d.match(re)?.slice(1).map(num);
  const x = '\\s*[x×*]\\s*';
  const n = '(\\d+(?:[.,]\\d+)?)';

  if (/กล่อง|box|แป๊บ|rhs|shs/.test(d)) {
    const m = dims(new RegExp(`${n}${x}${n}${x}${n}`));
    if (m) {
      const [a, b, t] = m;
      const area = 2 * t * (a + b) - 4 * t * t;
      const kg = r3(area * STEEL_KG_PER_M_PER_MM2 * SECTION_BAR_M);
      return { unit: 'เส้น', kgPerUnit: kg, basis: `กล่อง ${a}×${b}×${t} มม. ยาว ${SECTION_BAR_M} ม.` };
    }
  }
  if (/(^|[^a-z])(h|i|wf)[ -]?(beam)?\s*\d|ไวด์แฟลนจ์|เหล็ก\s*h|เหล็ก\s*i/.test(d)) {
    const m = dims(new RegExp(`${n}${x}${n}${x}${n}${x}${n}`));
    if (m) {
      const [a, b, t1, t2] = m;
      // Rolled sections have root fillets (r ≈ 1.1 × flange): adds about 3% to the plain-plate area
      const r = 1.1 * t2;
      const area = 2 * b * t2 + (a - 2 * t2) * t1 + (4 - Math.PI) * r * r;
      const kg = r3(area * STEEL_KG_PER_M_PER_MM2 * SECTION_BAR_M);
      return { unit: 'เส้น', kgPerUnit: kg, basis: `H ${a}×${b}×${t1}×${t2} มม. ยาว ${SECTION_BAR_M} ม.` };
    }
  }
  if (/plate|เพลท|แผ่นเหล็ก|เหล็กแผ่น/.test(d)) {
    const m = dims(new RegExp(`${n}\\s*(?:มม|mm)`));
    if (m) {
      const [t] = m;
      const kg = r3(t * 7.85 * PLATE_SHEET_M2);
      return { unit: 'แผ่น', kgPerUnit: kg, basis: `หนา ${t} มม. แผ่น 4×8 ฟุต` };
    }
  }
  const bar = d.match(/(?:db|rb|sd\s*\d*|sr\s*\d*|dia\.?|ø|⌀)\s*(\d+(?:\.\d+)?)/);
  if (bar && /db|rb|sd|sr|dia|ø|⌀|เหล็กเส้น|ข้ออ้อย|เส้นกลม/.test(d)) {
    const dia = num(bar[1]);
    // SD/SR 40 is a grade: take the size after "dia" when both are written
    const size = d.match(/dia\.?\s*(\d+(?:\.\d+)?)/) ? num(d.match(/dia\.?\s*(\d+(?:\.\d+)?)/)![1]) : dia;
    if (size >= 6 && size <= 40) {
      const kg = r3(((size * size) / 162) * REBAR_BAR_M);
      return { unit: 'เส้น', kgPerUnit: kg, basis: `เหล็กเส้น ⌀${size} มม. ยาว ${REBAR_BAR_M} ม.` };
    }
  }
  return null;
}

export interface ConvertibleRow {
  qty: number | '';
  unit: string;
  matRate: number | '';
  labRate: number | '';
}

/**
 * The row counted in `toUnit`, where one `toUnit` holds `perUnit` of the old unit.
 * Quantity keeps 3 decimals and rates 2, as stored, so money can move by a few satang.
 */
export function convertRow<R extends ConvertibleRow>(row: R, toUnit: string, perUnit: number): R {
  if (!(perUnit > 0)) return row;
  const qty = row.qty === '' ? '' : D(row.qty).div(perUnit).toDecimalPlaces(3).toNumber();
  const rate = (v: number | '') => (v === '' ? '' : round2(D(v).times(perUnit)).toNumber());
  return { ...row, qty, unit: toUnit, matRate: rate(row.matRate), labRate: rate(row.labRate) };
}
