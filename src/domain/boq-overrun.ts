import { D, Decimal, round2, sum } from './money';

/** One BOQ material line checked against what purchases commit to it (amounts before VAT). */
export interface BoqOverrunLine {
  boqLineId: string;
  boqNo: string;
  description: string;
  budget: string;
  committedElsewhere: string;
  thisPo: string;
  over: string;
}

export interface BoqBudgetLine {
  id: string;
  no: string;
  description: string;
  qty: Decimal.Value | null;
  materialRate: Decimal.Value | null;
}

/** Material budget of a BOQ line: qty × material unit rate (labour is paid through milestones). */
export function boqMaterialBudget(line: Pick<BoqBudgetLine, 'qty' | 'materialRate'>): Decimal {
  if (line.qty === null || line.materialRate === null) return D(0);
  return round2(D(line.qty).times(line.materialRate));
}

/** Usage alert thresholds in percent of the material budget; 101 stands for "over budget". */
export type BoqUsageLevel = 0 | 50 | 80 | 100 | 101;

/** Highest alert threshold that `used` has reached against `budget`. */
export function boqUsageLevel(used: Decimal.Value, budget: Decimal.Value): BoqUsageLevel {
  const b = D(budget);
  if (b.lte(0)) return 0;
  const u = D(used);
  if (u.gt(b)) return 101;
  const percent = u.div(b).times(100);
  if (percent.gte(100)) return 100;
  if (percent.gte(80)) return 80;
  if (percent.gte(50)) return 50;
  return 0;
}

/**
 * Compares this PO's lines with each referenced BOQ line's material budget, counting what other
 * live POs already commit. Only lines that end up over budget are returned.
 */
export function computeBoqOverrun(input: {
  boqLines: BoqBudgetLine[];
  thisPoByBoqLine: Map<string, Decimal>;
  committedElsewhereByBoqLine: Map<string, Decimal>;
}): { lines: BoqOverrunLine[]; overAmount: Decimal } {
  const byId = new Map(input.boqLines.map((l) => [l.id, l]));
  const lines: BoqOverrunLine[] = [];
  for (const [boqLineId, thisPo] of input.thisPoByBoqLine) {
    const boq = byId.get(boqLineId);
    if (!boq) continue;
    const budget = boqMaterialBudget(boq);
    const elsewhere = input.committedElsewhereByBoqLine.get(boqLineId) ?? D(0);
    // Only the part of the excess caused by this PO counts against it
    const totalOver = elsewhere.plus(thisPo).minus(budget);
    const over = Decimal.min(thisPo, Decimal.max(D(0), totalOver));
    if (over.greaterThan(0)) {
      lines.push({
        boqLineId,
        boqNo: boq.no,
        description: boq.description,
        budget: budget.toFixed(2),
        committedElsewhere: elsewhere.toFixed(2),
        thisPo: thisPo.toFixed(2),
        over: over.toFixed(2),
      });
    }
  }
  return { lines, overAmount: sum(lines.map((l) => D(l.over))) };
}

/** A BOQ row as stored, enough to tell which category (หมวด) each item falls under. */
export interface BoqSheetRow {
  id: string;
  boqId: string;
  isCategory: boolean;
  no: string;
  description: string;
}

/**
 * The category row each item sits under: the nearest category row above it in the same BOQ.
 * Rows must come in sheet order. Items above the first category row have none.
 */
export function boqCategoryOfLines(rows: BoqSheetRow[]): Map<string, { id: string; name: string }> {
  const out = new Map<string, { id: string; name: string }>();
  let current: { id: string; boqId: string; name: string } | null = null;
  for (const r of rows) {
    if (current && current.boqId !== r.boqId) current = null;
    if (r.isCategory) {
      current = { id: r.id, boqId: r.boqId, name: [r.no, r.description].map((s) => s.trim()).filter(Boolean).join(' ') || 'หมวด' };
    } else if (current) {
      out.set(r.id, { id: current.id, name: current.name });
    }
  }
  return out;
}

/** One BOQ category (หมวด) that this PO pushes over its material budget (amounts before VAT). */
export interface BoqCategoryOverrun {
  categoryId: string;
  name: string;
  budget: string;
  /** What other live POs already commit to the category */
  committedElsewhere: string;
  thisPo: string;
  /** How far the category ends up over its budget with this PO counted */
  over: string;
  /** The part of `over` this PO causes (never more than `thisPo`); the owner approves this amount */
  overByThisPo: string;
}

/** Category overrun this PO causes in total; above zero the PO needs the owner's approval (AP). */
export function categoryOverAmount(overruns: Pick<BoqCategoryOverrun, 'overByThisPo'>[]): Decimal {
  return sum(overruns.map((o) => D(o.overByThisPo)));
}

/**
 * Compares, for each category this PO's lines draw on, the category's material budget with what
 * other live POs commit to it plus this PO. Only categories that end up over budget are returned;
 * the PO then needs the owner's approval (AP) before it can be approved.
 */
export function computeBoqCategoryOverrun(input: {
  /** Category of each BOQ item line */
  categoryOf: Map<string, { id: string; name: string }>;
  /** Material budget of each BOQ item line, for every item of the categories involved */
  budgetByBoqLine: Map<string, Decimal.Value>;
  /** What other live POs commit to each BOQ item line */
  committedElsewhereByBoqLine: Map<string, Decimal.Value>;
  thisPoByBoqLine: Map<string, Decimal.Value>;
}): BoqCategoryOverrun[] {
  const thisPo = new Map<string, Decimal>();
  for (const [lineId, amount] of input.thisPoByBoqLine) {
    const cat = input.categoryOf.get(lineId);
    if (cat) thisPo.set(cat.id, (thisPo.get(cat.id) ?? D(0)).plus(amount));
  }
  if (thisPo.size === 0) return [];

  const budget = new Map<string, Decimal>();
  const elsewhere = new Map<string, Decimal>();
  const names = new Map<string, string>();
  for (const [lineId, cat] of input.categoryOf) {
    if (!thisPo.has(cat.id)) continue;
    names.set(cat.id, cat.name);
    budget.set(cat.id, (budget.get(cat.id) ?? D(0)).plus(input.budgetByBoqLine.get(lineId) ?? 0));
    elsewhere.set(cat.id, (elsewhere.get(cat.id) ?? D(0)).plus(input.committedElsewhereByBoqLine.get(lineId) ?? 0));
  }

  const out: BoqCategoryOverrun[] = [];
  for (const [id, mine] of thisPo) {
    const b = budget.get(id) ?? D(0);
    const e = elsewhere.get(id) ?? D(0);
    const over = e.plus(mine).minus(b);
    // A category with no material budget at all is not a budget to warn against
    if (b.lte(0) || over.lte(0)) continue;
    out.push({
      categoryId: id,
      name: names.get(id) ?? 'หมวด',
      budget: b.toFixed(2),
      committedElsewhere: e.toFixed(2),
      thisPo: mine.toFixed(2),
      over: over.toFixed(2),
      overByThisPo: Decimal.min(mine, over).toFixed(2),
    });
  }
  return out;
}

/**
 * The amount an AP asks the owner to approve: the larger of the line overrun and the category
 * overrun (a line overrun is usually also part of its category's overrun, so they are not added).
 */
export function apAmount(ap: { overAmount: Decimal.Value; categoryOverAmount?: Decimal.Value | null }): Decimal {
  return Decimal.max(D(ap.overAmount), D(ap.categoryOverAmount ?? 0));
}
