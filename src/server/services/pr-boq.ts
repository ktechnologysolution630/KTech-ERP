import { and, eq, inArray, lt, ne, or } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  boqLines,
  boqs,
  poLines,
  pos,
  prLines,
  prs,
  variationOrders,
  type NotificationLevel,
  type PrStatus,
  type SessionUser,
} from '@/db/schema';
import { boqUsageLevel, type BoqUsageLevel } from '@/domain/boq-overrun';
import { DomainError } from '@/domain/errors';
import { D, type Decimal } from '@/domain/money';
import { computePrBoqOver, stockCategoryOfBoq, type PrBoqOverLine } from '@/domain/pr-boq';
import { type StockCategory } from '@/domain/stock';
import { formatQty } from '@/domain/pr-outstanding';
import { type PrLineKind } from '@/domain/pr-type';
import { isSiteScopedOnly } from '@/server/policy';
import { notify, usersWithRole } from './notifications';

/** PRs past the PM whose full quantity counts against the BOQ; a closed PR counts what was ordered */
const COUNTING_STATUSES: PrStatus[] = ['OWNER_REVIEW', 'APPROVED'];

/** Item quantity alerts go to the people who request and buy, not to the owner */
const QTY_ALERT_ROLES = ['PM', 'PURCHASING', 'PURCHASING_HEAD'] as const;

const LEVEL_OF: Record<Exclude<BoqUsageLevel, 0>, NotificationLevel> = {
  50: 'NOTICE',
  80: 'WARNING',
  100: 'CRITICAL',
  101: 'OVER',
};

type BoqLineRow = typeof boqLines.$inferSelect;

/**
 * Rows of the BOQs a PR may draw on, category rows included, in sheet order: the project's main BOQ,
 * then the BOQs of its approved variation orders. All projects when projectId is left out.
 */
async function purchasableBoqRows(tx: Db, projectId?: string) {
  return tx
    .select({ line: boqLines, projectId: boqs.projectId, kind: boqs.kind, voNumber: variationOrders.number })
    .from(boqLines)
    .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
    .leftJoin(variationOrders, eq(variationOrders.id, boqs.voId))
    .where(
      and(
        projectId ? eq(boqs.projectId, projectId) : undefined,
        or(eq(boqs.kind, 'MAIN'), and(eq(boqs.kind, 'VO'), eq(variationOrders.status, 'APPROVED'))),
      ),
    )
    .orderBy(boqs.projectId, boqs.kind, boqLines.boqId, boqLines.sort);
}

/** Lines a PR may draw on: material lines with a quantity */
const isPurchasable = (line: BoqLineRow) => !line.isCategory && line.qty !== null && D(line.qty).gt(0);

async function purchasableBoqLines(tx: Db, projectId?: string) {
  return (await purchasableBoqRows(tx, projectId)).filter((r) => isPurchasable(r.line));
}

/**
 * Quantity already asked for against each BOQ line: PRs a PM has approved count in full, closed PRs
 * count what was put on purchase orders. Leave out one PR with excludePrId.
 */
export async function requestedQtyByBoqLine(tx: Db, boqLineIds: string[], excludePrId?: string): Promise<Map<string, Decimal>> {
  const requested = new Map<string, Decimal>();
  if (boqLineIds.length === 0) return requested;
  const add = (id: string | null, qty: Decimal.Value) => {
    if (id) requested.set(id, (requested.get(id) ?? D(0)).plus(qty));
  };

  const rows = await tx
    .select({ id: prLines.id, boqLineId: prLines.boqLineId, qty: prLines.qty, status: prs.status })
    .from(prLines)
    .innerJoin(prs, eq(prs.id, prLines.prId))
    .where(
      and(
        inArray(prLines.boqLineId, boqLineIds),
        inArray(prs.status, [...COUNTING_STATUSES, 'CLOSED']),
        excludePrId ? ne(prs.id, excludePrId) : undefined,
      ),
    );

  for (const r of rows) if (r.status !== 'CLOSED') add(r.boqLineId, r.qty);

  const closed = rows.filter((r) => r.status === 'CLOSED');
  if (closed.length > 0) {
    const ordered = await tx
      .select({ prLineId: poLines.prLineId, qty: poLines.qty })
      .from(poLines)
      .innerJoin(pos, and(eq(pos.id, poLines.poId), ne(pos.status, 'CANCELLED')))
      .where(inArray(poLines.prLineId, closed.map((r) => r.id)));
    const boqOf = new Map(closed.map((r) => [r.id, r.boqLineId]));
    for (const o of ordered) if (o.prLineId) add(boqOf.get(o.prLineId) ?? null, o.qty);
  }
  return requested;
}

/** What a PR line carries about the BOQ */
export interface PrLineForBoq {
  lineKind: PrLineKind;
  description: string;
  unitName: string;
  qty: Decimal.Value;
  boqLineId?: string | null;
  outsideBoq?: boolean;
}

/** Goods lines only draw on the BOQ; hired work is paid through milestones */
export function boqFieldsOf(l: Pick<PrLineForBoq, 'lineKind' | 'boqLineId' | 'outsideBoq'>) {
  if (l.lineKind !== 'GOODS') return { boqLineId: null, outsideBoq: false };
  if (l.boqLineId) return { boqLineId: l.boqLineId, outsideBoq: false };
  return { boqLineId: null, outsideBoq: Boolean(l.outsideBoq) };
}

/** A goods line may only draw on a material line with a quantity in this project's BOQ */
export async function assertPrBoqLinesValid(tx: Db, projectId: string, lines: PrLineForBoq[]): Promise<void> {
  const ids = [...new Set(lines.map((l) => boqFieldsOf(l).boqLineId).filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const valid = new Set((await purchasableBoqLines(tx, projectId)).map((r) => r.line.id));
  if (ids.some((id) => !valid.has(id))) {
    throw new DomainError(
      'BOQ_LINE_MISMATCH',
      'รายการ BOQ ที่เลือกต้องเป็นรายการวัสดุที่มีจำนวนใน BOQ หลัก หรือ BOQ ของ VO ที่อนุมัติแล้วของโครงการนี้',
    );
  }
}

/** Once a project has a BOQ, every goods line names its BOQ line or is marked as outside the BOQ */
export async function assertPrBoqLinesChosen(tx: Db, projectId: string, lines: PrLineForBoq[]): Promise<void> {
  const goods = lines.filter((l) => l.lineKind === 'GOODS');
  if (goods.length === 0) return;
  const missing = goods.find((l) => !l.boqLineId && !l.outsideBoq);
  if (!missing) return;
  if ((await purchasableBoqLines(tx, projectId)).length === 0) return;
  throw new DomainError('BOQ_LINE_REQUIRED', `กรุณาเลือกรายการ BOQ ของ "${missing.description}" หรือเลือก "นอก BOQ"`);
}

export interface PrBoqCheck {
  over: PrBoqOverLine[];
  /** Goods lines marked as not in the BOQ */
  outside: { description: string; qty: string; unit: string }[];
  /** Over the BOQ quantity or outside it: the owner approves after the PM */
  needsOwner: boolean;
}

/** BOQ standing of a PR's goods lines against what other approved PRs already ask for */
export async function checkPrBoq(tx: Db, prId: string | null, lines: PrLineForBoq[]): Promise<PrBoqCheck> {
  const thisPr = new Map<string, Decimal>();
  const outside: PrBoqCheck['outside'] = [];
  for (const l of lines) {
    const f = boqFieldsOf(l);
    if (f.boqLineId) thisPr.set(f.boqLineId, (thisPr.get(f.boqLineId) ?? D(0)).plus(l.qty));
    else if (f.outsideBoq) outside.push({ description: l.description, qty: D(l.qty).toString(), unit: l.unitName });
  }
  const ids = [...thisPr.keys()];
  const [rows, elsewhere] = await Promise.all([
    ids.length ? tx.select().from(boqLines).where(inArray(boqLines.id, ids)) : Promise.resolve([] as BoqLineRow[]),
    requestedQtyByBoqLine(tx, ids, prId ?? undefined),
  ]);
  const over = computePrBoqOver({ boqLines: rows, thisPrByBoqLine: thisPr, requestedElsewhereByBoqLine: elsewhere });
  return { over, outside, needsOwner: over.length > 0 || outside.length > 0 };
}

/**
 * Re-checks how much of each given BOQ line PRs ask for, after a PR was approved, rejected, cancelled
 * or closed, and tells the project's PM and purchasing when a line first reaches 50%, 80%, 100% or
 * goes over its BOQ quantity. A line whose quantity drops is lowered silently so it can alert again.
 * Must run inside the transaction that changed the PR.
 */
export async function checkBoqQtyAlerts(tx: Db, boqLineIds: (string | null | undefined)[]): Promise<void> {
  const ids = Array.from(new Set(boqLineIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return;

  const [rows, requested] = await Promise.all([
    tx
      .select({ line: boqLines, projectId: boqs.projectId })
      .from(boqLines)
      .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
      .where(and(inArray(boqLines.id, ids), eq(boqLines.isCategory, false))),
    requestedQtyByBoqLine(tx, ids),
  ]);

  const recipientsByProject = new Map<string, string[]>();
  for (const { line, projectId } of rows) {
    const boqQty = line.qty === null ? D(0) : D(line.qty);
    const used = requested.get(line.id) ?? D(0);
    const level = boqUsageLevel(used, boqQty);
    if (level === line.usageAlertLevel) continue;

    if (level < line.usageAlertLevel) {
      await tx.update(boqLines).set({ usageAlertLevel: level }).where(eq(boqLines.id, line.id));
      continue;
    }

    // Claim the level first so concurrent checks never send the same alert twice
    const claimed = await tx
      .update(boqLines)
      .set({ usageAlertLevel: level })
      .where(and(eq(boqLines.id, line.id), lt(boqLines.usageAlertLevel, level)))
      .returning();
    if (claimed.length === 0 || level === 0) continue;

    let recipients = recipientsByProject.get(projectId);
    if (!recipients) {
      recipients = await usersWithRole(tx, [...QTY_ALERT_ROLES], projectId);
      recipientsByProject.set(projectId, recipients);
    }

    const name = [line.no, line.description].filter(Boolean).join(' ');
    const unit = line.unit ? ` ${line.unit}` : '';
    const amounts = `${formatQty(used.toNumber())} / ${formatQty(boqQty.toNumber())}${unit}`;
    const title =
      level === 101
        ? `ขอซื้อเกิน BOQ ${name}: เกิน ${formatQty(used.minus(boqQty).toNumber())}${unit} (${amounts})`
        : `BOQ ${name}: ขอซื้อแล้ว ${used.div(boqQty).times(100).floor().toFixed(0)}% (${amounts})`;

    await notify(tx, recipients, {
      title,
      href: `/projects/${projectId}/boq`,
      category: 'BOQ',
      level: LEVEL_OF[level],
      projectId,
    });
  }
}

export interface BoqQtyOption {
  id: string;
  projectId: string;
  /** "BOQ หลัก" or the VO number the line came from */
  source: string;
  /**
   * The major group the line sits under, for grouping the picker: its BOQ category ("1 งานฐานราก"),
   * prefixed by the VO number for a variation order's BOQ; "BOQ หลัก" for a line above any category
   */
  group: string;
  /** The PR category (หมวด) the group belongs to, which narrows the picker; null when its name does not say */
  category: StockCategory | null;
  no: string;
  description: string;
  unit: string;
  qty: number;
  /** Asked for on PRs a PM has approved */
  requested: number;
  remaining: number;
}

/** Material lines a PR can pick, in BOQ order under their major group, with how much approved PRs already ask for */
export async function listBoqQtyOptions(db: Db, actor: SessionUser): Promise<BoqQtyOption[]> {
  const all = await purchasableBoqRows(db);
  const rows = isSiteScopedOnly(actor) ? all.filter((r) => actor.projectIds.includes(r.projectId)) : all;

  // Each line's group is the last category row above it in the same BOQ
  const groupOf = new Map<string, { label: string; category: StockCategory | null }>();
  let boqId: string | null = null;
  let heading: { label: string; category: StockCategory | null } = { label: '', category: null };
  for (const { line, kind, voNumber } of rows) {
    if (line.boqId !== boqId) {
      boqId = line.boqId;
      heading = { label: '', category: null };
    }
    if (line.isCategory) {
      heading = { label: [line.no, line.description].filter(Boolean).join(' '), category: stockCategoryOfBoq(line.description) };
      continue;
    }
    const source = kind === 'VO' && voNumber ? voNumber : '';
    groupOf.set(line.id, { label: [source, heading.label].filter(Boolean).join(' · ') || 'BOQ หลัก', category: heading.category });
  }

  const visible = rows.filter((r) => isPurchasable(r.line));
  if (visible.length === 0) return [];
  const requested = await requestedQtyByBoqLine(db, visible.map((r) => r.line.id));
  return visible.map(({ line, projectId, kind, voNumber }) => {
    const qty = D(line.qty!);
    const used = requested.get(line.id) ?? D(0);
    return {
      id: line.id,
      projectId,
      source: kind === 'VO' && voNumber ? voNumber : 'BOQ หลัก',
      group: groupOf.get(line.id)?.label ?? 'BOQ หลัก',
      category: groupOf.get(line.id)?.category ?? null,
      no: line.no,
      description: line.description,
      unit: line.unit,
      qty: qty.toNumber(),
      requested: used.toNumber(),
      remaining: qty.minus(used).toNumber(),
    };
  });
}
