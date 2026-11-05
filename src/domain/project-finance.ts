import { computeBoqLine } from './boq';
import { D, type Decimal, round2, sum } from './money';

/** `yyyy-mm` keys for the `count` months ending with the month of `today` (oldest first). */
export function lastMonthKeys(today: string, count: number): string[] {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    keys.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return keys;
}

/** Month keys from `start` to `end` inclusive (both ISO dates); empty when end < start. */
export function monthRange(start: string, end: string): string[] {
  const keys: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const last = end.slice(0, 7);
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > last) break;
    keys.push(key);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

/** Last calendar day of a `yyyy-mm` key. */
export function monthEnd(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export interface EvmInput {
  /** Budget at completion, baht */
  bac: number;
  /** Planned cumulative progress today, 0–100 */
  plannedPercent: number;
  /** Actual cumulative progress today, 0–100 */
  actualPercent: number;
  /** Actual cost incurred, baht */
  ac: number;
}

export interface EvmResult {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  cv: number;
  sv: number;
  /** null when there is no cost or no plan yet, so the ratio would be meaningless */
  cpi: number | null;
  spi: number | null;
  /** Estimate at completion: BAC / CPI, or BAC + spent-so-far when nothing is earned yet */
  eac: number;
  vac: number;
}

export function computeEvm(input: EvmInput): EvmResult {
  // The BOQ total arrives as a sum of floats; unrounded, it leaves a tiny remainder in the variance
  const bac = round2(D(input.bac));
  const pv = round2(bac.times(input.plannedPercent).div(100));
  const ev = round2(bac.times(input.actualPercent).div(100));
  const ac = round2(D(input.ac));
  const cpi = ac.gt(0) && ev.gt(0) ? ev.div(ac).toDecimalPlaces(2).toNumber() : null;
  const spi = pv.gt(0) ? ev.div(pv).toDecimalPlaces(2).toNumber() : null;
  const eac = cpi ? round2(bac.div(cpi)) : round2(bac.plus(ac.minus(ev).gt(0) ? ac.minus(ev) : 0));
  return {
    bac: bac.toNumber(),
    pv: pv.toNumber(),
    ev: ev.toNumber(),
    ac: ac.toNumber(),
    cv: ev.minus(ac).toNumber(),
    sv: ev.minus(pv).toNumber(),
    cpi,
    spi,
    eac: eac.toNumber(),
    vac: bac.minus(eac).toNumber(),
  };
}

export interface BoqLineForBudget {
  id: string;
  isCategory: boolean;
  no: string;
  description: string;
  qty: string | null;
  materialRate: string | null;
  laborRate: string | null;
}

export interface BoqBudgetCategory {
  key: string;
  name: string;
  budget: number;
  lineIds: string[];
}

/**
 * Groups BOQ lines (in sheet order) under their category headers and sums direct cost
 * (qty × (material + labour)). Lines before the first header fall under "งานทั่วไป".
 */
export function groupBoqBudget(lines: BoqLineForBudget[]): BoqBudgetCategory[] {
  const groups: BoqBudgetCategory[] = [];
  let current: BoqBudgetCategory | null = null;
  const amounts = new Map<BoqBudgetCategory, Decimal[]>();
  for (const line of lines) {
    if (line.isCategory) {
      current = { key: line.id, name: [line.no, line.description].filter(Boolean).join(' ') || 'หมวดงาน', budget: 0, lineIds: [] };
      groups.push(current);
      amounts.set(current, []);
      continue;
    }
    if (!current) {
      current = { key: 'uncategorised', name: 'งานทั่วไป', budget: 0, lineIds: [] };
      groups.push(current);
      amounts.set(current, []);
    }
    const { total } = computeBoqLine({
      isCategory: false,
      qty: line.qty === null ? '' : Number(line.qty),
      materialRate: line.materialRate === null ? '' : Number(line.materialRate),
      laborRate: line.laborRate === null ? '' : Number(line.laborRate),
    });
    current.lineIds.push(line.id);
    amounts.get(current)!.push(total);
  }
  for (const g of groups) g.budget = sum(amounts.get(g) ?? []).toNumber();
  return groups.filter((g) => g.lineIds.length > 0);
}
