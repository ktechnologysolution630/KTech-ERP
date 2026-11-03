import { computeBoqLine, computeBoqTotals, type BoqRowInput } from './boq';
import { allocate, D, Decimal, round2, sum } from './money';

/** PAY = งวดงานจ่าย to contractors; RECEIVE = งวดงานรับ billed to the client. */
export const MILESTONE_KINDS = ['PAY', 'RECEIVE'] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const MILESTONE_KIND_LABELS: Record<MilestoneKind, string> = {
  PAY: 'แผนงวดงานจ่าย',
  RECEIVE: 'แผนงวดงานรับ',
};

export const MILESTONE_STATUSES = ['PLANNED', 'CLAIMED', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABELS: Record<MilestoneKind, Record<MilestoneStatus, string>> = {
  PAY: {
    PLANNED: 'ตามแผน',
    CLAIMED: 'ผู้รับเหมาเบิกงวด',
    APPROVED: 'อนุมัติจ่าย',
    PAID: 'จ่ายแล้ว',
    CANCELLED: 'ยกเลิก',
  },
  RECEIVE: {
    PLANNED: 'ตามแผน',
    CLAIMED: 'ส่งเบิกงวด',
    APPROVED: 'ลูกค้าอนุมัติ',
    PAID: 'รับเงินแล้ว',
    CANCELLED: 'ยกเลิก',
  },
};

/** Forward-only lifecycle; CANCELLED is reachable from anything not yet settled. */
export const NEXT_MILESTONE_STATUS: Partial<Record<MilestoneStatus, MilestoneStatus>> = {
  PLANNED: 'CLAIMED',
  CLAIMED: 'APPROVED',
  APPROVED: 'PAID',
};

export function canCancelMilestone(status: MilestoneStatus): boolean {
  return status !== 'PAID' && status !== 'CANCELLED';
}

export interface MilestoneAmounts {
  retention: Decimal;
  net: Decimal;
}

/** หักประกันผลงาน: retention is rounded to satang; the claim is paid net of it. */
export function computeMilestoneAmounts(amount: Decimal.Value, retentionPercent: Decimal.Value): MilestoneAmounts {
  const gross = D(amount);
  const retention = round2(gross.times(retentionPercent).div(100));
  return { retention, net: gross.minus(retention) };
}

export interface MilestoneForSummary {
  amount: Decimal.Value;
  retentionAmount: Decimal.Value;
  status: MilestoneStatus;
}

export interface MilestoneSummary {
  planned: Decimal;
  unplanned: Decimal;
  approvedOrPaid: Decimal;
  paidNet: Decimal;
  retentionHeld: Decimal;
  plannedPercent: number;
}

export function summarizeMilestones(budget: Decimal.Value, rows: MilestoneForSummary[]): MilestoneSummary {
  const live = rows.filter((r) => r.status !== 'CANCELLED');
  const planned = sum(live.map((r) => D(r.amount)));
  const settled = live.filter((r) => r.status === 'APPROVED' || r.status === 'PAID');
  const paid = live.filter((r) => r.status === 'PAID');
  const b = D(budget);
  return {
    planned,
    unplanned: b.minus(planned),
    approvedOrPaid: sum(settled.map((r) => D(r.amount))),
    paidNet: sum(paid.map((r) => D(r.amount).minus(r.retentionAmount))),
    retentionHeld: sum(paid.map((r) => D(r.retentionAmount))),
    plannedPercent: b.isZero() ? 0 : planned.div(b).times(100).toDecimalPlaces(1).toNumber(),
  };
}

export interface BoqSheetForMilestones {
  lines: (BoqRowInput & { description: string })[];
  overheadPercent: number;
  discountAmount: number;
  vatPercent: number;
}

export interface MilestoneDraft {
  title: string;
  amount: Decimal;
}

/**
 * One draft milestone per BOQ category (หมวด), in sheet order; rows above the first category form
 * a "งานทั่วไป" group. PAY uses each category's direct cost; RECEIVE spreads the BOQ grand total
 * (overhead, discount and VAT included) over categories by direct cost, so the drafts add up to
 * exactly what the client is billed. Empty categories are skipped.
 */
export function milestonesFromBoq(boq: BoqSheetForMilestones, kind: MilestoneKind): MilestoneDraft[] {
  const groups: { title: string; cost: Decimal }[] = [];
  for (const line of boq.lines) {
    if (line.isCategory) {
      groups.push({ title: line.description.trim() || `หมวดที่ ${groups.length + 1}`, cost: D(0) });
      continue;
    }
    if (groups.length === 0) groups.push({ title: 'งานทั่วไป', cost: D(0) });
    groups[groups.length - 1].cost = groups[groups.length - 1].cost.plus(computeBoqLine(line).total);
  }
  const nonEmpty = groups.filter((g) => g.cost.greaterThan(0));
  if (kind === 'PAY') return nonEmpty.map((g) => ({ title: g.title, amount: g.cost }));

  const grand = computeBoqTotals({
    rows: boq.lines,
    overheadPercent: boq.overheadPercent,
    discountAmount: boq.discountAmount,
    vatPercent: boq.vatPercent,
  }).grandTotal;
  const shares = allocate(grand, nonEmpty.map((g) => g.cost));
  return nonEmpty.map((g, i) => ({ title: g.title, amount: shares[i] }));
}
