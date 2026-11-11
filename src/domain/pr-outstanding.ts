import type { PrStatus } from '@/db/schema';

/** A line of an open PR whose goods have not all arrived */
export interface OutstandingPrLine {
  prId: string;
  prNumber: string;
  prStatus: PrStatus;
  projectId: string;
  projectCode: string;
  projectName: string;
  prLineId: string;
  itemId: string | null;
  description: string;
  unitName: string;
  /** Asked for on the PR */
  qty: number;
  /** Put on purchase orders so far */
  orderedQty: number;
  receivedQty: number;
  /** qty - receivedQty, always above zero */
  outstandingQty: number;
}

const sameName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Outstanding lines that a line being written would ask for again: the same catalogue item, or the
 * same name when either side was typed freely. Only the same project counts; another site asking
 * for cement is not a repeat.
 */
export function duplicatesOfOutstanding(
  line: { itemId?: string | null; description: string },
  outstanding: OutstandingPrLine[],
  scope: { projectId: string; exceptPrId?: string },
): OutstandingPrLine[] {
  if (!scope.projectId) return [];
  const name = sameName(line.description);
  if (!line.itemId && !name) return [];
  return outstanding.filter(
    (o) =>
      o.projectId === scope.projectId &&
      o.prId !== scope.exceptPrId &&
      ((!!line.itemId && o.itemId === line.itemId) || (!!name && sameName(o.description) === name)),
  );
}

/** 7, 2.5, 0.125: quantities without trailing zeros */
export const formatQty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
