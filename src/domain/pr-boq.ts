import { D, Decimal } from './money';

/** A BOQ material line as far as PR quantities are concerned */
export interface BoqQtyLine {
  id: string;
  no: string;
  description: string;
  unit: string;
  qty: Decimal.Value | null;
}

/** One BOQ line a PR asks for more of than the BOQ quantity allows */
export interface PrBoqOverLine {
  boqLineId: string;
  boqNo: string;
  description: string;
  unit: string;
  /** Quantity in the BOQ */
  boqQty: string;
  /** Already asked for on other PRs that a PM has approved */
  requestedElsewhere: string;
  /** Asked for on this PR */
  thisPr: string;
  /** The part of this PR beyond the BOQ quantity */
  over: string;
}

/**
 * Compares a PR's goods quantities with each referenced BOQ line, counting what other approved PRs
 * already ask for. Only the part of the excess this PR causes counts against it, so the PR approved
 * first stays within the BOQ and the later one carries the overrun.
 */
export function computePrBoqOver(input: {
  boqLines: BoqQtyLine[];
  thisPrByBoqLine: Map<string, Decimal>;
  requestedElsewhereByBoqLine: Map<string, Decimal>;
}): PrBoqOverLine[] {
  const byId = new Map(input.boqLines.map((l) => [l.id, l]));
  const lines: PrBoqOverLine[] = [];
  for (const [boqLineId, thisPr] of input.thisPrByBoqLine) {
    const boq = byId.get(boqLineId);
    if (!boq) continue;
    const boqQty = boq.qty === null ? D(0) : D(boq.qty);
    const elsewhere = input.requestedElsewhereByBoqLine.get(boqLineId) ?? D(0);
    const over = Decimal.min(thisPr, Decimal.max(D(0), elsewhere.plus(thisPr).minus(boqQty)));
    if (over.gt(0)) {
      lines.push({
        boqLineId,
        boqNo: boq.no,
        description: boq.description,
        unit: boq.unit,
        boqQty: boqQty.toString(),
        requestedElsewhere: elsewhere.toString(),
        thisPr: thisPr.toString(),
        over: over.toString(),
      });
    }
  }
  return lines;
}
