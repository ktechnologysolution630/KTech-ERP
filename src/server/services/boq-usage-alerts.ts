import { and, asc, eq, inArray, lt, or } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { boqLines, boqs, projects, variationOrders, type NotificationLevel } from '@/db/schema';
import { boqMaterialBudget, boqUsageLevel, type BoqUsageLevel } from '@/domain/boq-overrun';
import { D, Decimal, formatMoneyDisplay, sum } from '@/domain/money';
import { committedByBoqLine } from './boq-overrun';
import { notify, usersWithRole } from './notifications';

const LEVEL_OF: Record<Exclude<BoqUsageLevel, 0>, NotificationLevel> = {
  50: 'NOTICE',
  80: 'WARNING',
  100: 'CRITICAL',
  101: 'OVER',
};

type BoqLineRow = typeof boqLines.$inferSelect;

/** Spend of one project or one BOQ category against its material budget */
interface Spend {
  budget: Decimal;
  used: Decimal;
}

const money = (d: Decimal) => formatMoneyDisplay(d.toFixed(2));
const amountsOf = ({ used, budget }: Spend) => `฿${money(used)} / ฿${money(budget)}`;
const percentOf = ({ used, budget }: Spend) => used.div(budget).times(100).floor().toFixed(0);

/**
 * Re-checks how much of each affected project's BOQ material budget live POs commit, after POs that
 * draw on the given BOQ lines changed, and tells the owner when the whole project, or one category
 * (หมวด) of its BOQ, first reaches 50%, 80%, 100% or goes over. Single lines are watched by quantity on
 * PRs instead (checkBoqQtyAlerts). Spend that drops (rejected or cancelled PO) lowers the level silently
 * so it can alert again. Must run inside the transaction that changed the POs.
 */
export async function checkBoqUsageAlerts(tx: Db, boqLineIds: (string | null | undefined)[]): Promise<void> {
  const ids = Array.from(new Set(boqLineIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return;

  const touched = await tx
    .selectDistinct({ projectId: boqs.projectId })
    .from(boqLines)
    .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
    .where(inArray(boqLines.id, ids));
  if (touched.length === 0) return;
  const projectIds = touched.map((t) => t.projectId);

  // The budget: material of the main BOQ and of the BOQs of approved variation orders, in sheet order
  const [rows, projectRows] = await Promise.all([
    tx
      .select({ line: boqLines, projectId: boqs.projectId })
      .from(boqLines)
      .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
      .leftJoin(variationOrders, eq(variationOrders.id, boqs.voId))
      .where(
        and(
          inArray(boqs.projectId, projectIds),
          or(eq(boqs.kind, 'MAIN'), and(eq(boqs.kind, 'VO'), eq(variationOrders.status, 'APPROVED'))),
        ),
      )
      .orderBy(asc(boqLines.boqId), asc(boqLines.sort)),
    tx.select().from(projects).where(inArray(projects.id, projectIds)),
  ]);
  const items = rows.filter((r) => !r.line.isCategory);
  const committed = await committedByBoqLine(tx, items.map((r) => r.line.id));
  const spendOf = (lines: BoqLineRow[]): Spend => ({
    budget: sum(lines.map((l) => boqMaterialBudget(l))),
    used: sum(lines.map((l) => committed.get(l.id) ?? D(0))),
  });

  let owners: string[] | null = null;
  const tell = async (projectId: string, level: Exclude<BoqUsageLevel, 0>, title: string) => {
    owners ??= await usersWithRole(tx, ['OWNER']);
    await notify(tx, owners, { title, href: `/projects/${projectId}/boq`, category: 'BOQ', level: LEVEL_OF[level], projectId });
  };

  for (const project of projectRows) {
    const name = `${project.code} ${project.name}`;

    // Whole project
    const total = spendOf(items.filter((r) => r.projectId === project.id).map((r) => r.line));
    const level = boqUsageLevel(total.used, total.budget);
    if (level < project.boqUsageAlertLevel) {
      await tx.update(projects).set({ boqUsageAlertLevel: level }).where(eq(projects.id, project.id));
    } else if (level > project.boqUsageAlertLevel) {
      // Claim the level first so concurrent checks never send the same alert twice
      const claimed = await tx
        .update(projects)
        .set({ boqUsageAlertLevel: level })
        .where(and(eq(projects.id, project.id), lt(projects.boqUsageAlertLevel, level)))
        .returning();
      if (claimed.length > 0 && level !== 0) {
        await tell(
          project.id,
          level,
          level === 101
            ? `โครงการ ${name}: ซื้อเกินงบวัสดุ BOQ ฿${money(total.used.minus(total.budget))} (${amountsOf(total)})`
            : `โครงการ ${name}: ซื้อแล้ว ${percentOf(total)}% ของงบวัสดุ BOQ (${amountsOf(total)})`,
        );
      }
    }

    // Each category: the lines under a category row, up to the next one, in each BOQ of the project
    const categories: { row: BoqLineRow; lines: BoqLineRow[] }[] = [];
    let current: { row: BoqLineRow; lines: BoqLineRow[] } | null = null;
    for (const { line, projectId } of rows) {
      if (projectId !== project.id) continue;
      if (current && current.row.boqId !== line.boqId) current = null;
      if (line.isCategory) {
        current = { row: line, lines: [] };
        categories.push(current);
      } else if (current) {
        current.lines.push(line);
      }
    }

    for (const { row, lines } of categories) {
      const spend = spendOf(lines);
      // A category row keeps its own level; item rows use theirs for PR quantities
      const catLevel = boqUsageLevel(spend.used, spend.budget);
      if (catLevel === row.usageAlertLevel) continue;
      if (catLevel < row.usageAlertLevel) {
        await tx.update(boqLines).set({ usageAlertLevel: catLevel }).where(eq(boqLines.id, row.id));
        continue;
      }
      const claimed = await tx
        .update(boqLines)
        .set({ usageAlertLevel: catLevel })
        .where(and(eq(boqLines.id, row.id), lt(boqLines.usageAlertLevel, catLevel)))
        .returning();
      if (claimed.length === 0 || catLevel === 0) continue;
      const category = `หมวด ${[row.no, row.description].filter(Boolean).join(' ')}`;
      await tell(
        project.id,
        catLevel,
        catLevel === 101
          ? `โครงการ ${project.code} ${category}: ซื้อเกินงบวัสดุของหมวด ฿${money(spend.used.minus(spend.budget))} (${amountsOf(spend)})`
          : `โครงการ ${project.code} ${category}: ซื้อแล้ว ${percentOf(spend)}% ของงบวัสดุของหมวด (${amountsOf(spend)})`,
      );
    }
  }
}
