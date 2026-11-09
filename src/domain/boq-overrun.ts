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
