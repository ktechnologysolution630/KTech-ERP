import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { boqLines, boqs, projects, variationOrders, type NotificationLevel } from '@/db/schema';
import { boqMaterialBudget, boqUsageLevel, type BoqUsageLevel } from '@/domain/boq-overrun';
import { D, formatMoneyDisplay, sum } from '@/domain/money';
import { committedByBoqLine } from './boq-overrun';
import { notify, usersWithRole } from './notifications';

const LEVEL_OF: Record<Exclude<BoqUsageLevel, 0>, NotificationLevel> = {
  50: 'NOTICE',
  80: 'WARNING',
  100: 'CRITICAL',
  101: 'OVER',
};

/**
 * Re-checks how much of each affected project's BOQ material budget live POs commit, after POs that
 * draw on the given BOQ lines changed, and tells the owner when the whole project first reaches 50%,
 * 80%, 100% or goes over. Single lines are watched by quantity on PRs instead (checkBoqQtyAlerts).
 * A project whose spend drops (rejected or cancelled PO) is lowered silently so it can alert again.
 * Must run inside the transaction that changed the POs.
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

  // The project's budget: material of its main BOQ and of the BOQs of approved variation orders
  const [lines, projectRows] = await Promise.all([
    tx
      .select({ line: boqLines, projectId: boqs.projectId })
      .from(boqLines)
      .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
      .leftJoin(variationOrders, eq(variationOrders.id, boqs.voId))
      .where(
        and(
          inArray(boqs.projectId, projectIds),
          eq(boqLines.isCategory, false),
          or(eq(boqs.kind, 'MAIN'), and(eq(boqs.kind, 'VO'), eq(variationOrders.status, 'APPROVED'))),
        ),
      ),
    tx.select().from(projects).where(inArray(projects.id, projectIds)),
  ]);
  const committed = await committedByBoqLine(tx, lines.map((l) => l.line.id));

  let owners: string[] | null = null;
  for (const project of projectRows) {
    const own = lines.filter((l) => l.projectId === project.id);
    const budget = sum(own.map((l) => boqMaterialBudget(l.line)));
    const used = sum(own.map((l) => committed.get(l.line.id) ?? D(0)));
    const level = boqUsageLevel(used, budget);
    if (level === project.boqUsageAlertLevel) continue;

    if (level < project.boqUsageAlertLevel) {
      await tx.update(projects).set({ boqUsageAlertLevel: level }).where(eq(projects.id, project.id));
      continue;
    }

    // Claim the level first so concurrent checks never send the same alert twice
    const claimed = await tx
      .update(projects)
      .set({ boqUsageAlertLevel: level })
      .where(and(eq(projects.id, project.id), lt(projects.boqUsageAlertLevel, level)))
      .returning();
    if (claimed.length === 0 || level === 0) continue;

    owners ??= await usersWithRole(tx, ['OWNER']);
    const name = `${project.code} ${project.name}`;
    const amounts = `฿${formatMoneyDisplay(used.toFixed(2))} / ฿${formatMoneyDisplay(budget.toFixed(2))}`;
    const title =
      level === 101
        ? `โครงการ ${name}: ซื้อเกินงบวัสดุ BOQ ฿${formatMoneyDisplay(used.minus(budget).toFixed(2))} (${amounts})`
        : `โครงการ ${name}: ซื้อแล้ว ${used.div(budget).times(100).floor().toFixed(0)}% ของงบวัสดุ BOQ (${amounts})`;

    await notify(tx, owners, {
      title,
      href: `/projects/${project.id}/boq`,
      category: 'BOQ',
      level: LEVEL_OF[level],
      projectId: project.id,
    });
  }
}
