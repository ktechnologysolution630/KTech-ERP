import { and, eq, inArray, lt } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { boqLines, boqs, type NotificationLevel } from '@/db/schema';
import { boqMaterialBudget, boqUsageLevel, type BoqUsageLevel } from '@/domain/boq-overrun';
import { D, formatMoneyDisplay } from '@/domain/money';
import { committedByBoqLine } from './boq-overrun';
import { notify, usersWithRole } from './notifications';

/** Only the owner and the project's PM are told how much of a BOQ line has been bought. */
const BOQ_ALERT_ROLES = ['OWNER', 'PM'] as const;

const LEVEL_OF: Record<Exclude<BoqUsageLevel, 0>, NotificationLevel> = {
  50: 'NOTICE',
  80: 'WARNING',
  100: 'CRITICAL',
  101: 'OVER',
};

/**
 * Re-checks the material usage of the given BOQ lines after POs that commit to them changed, and
 * tells the owner and the project's PM when a line first reaches 50%, 80%, 100% or goes over budget.
 * A line whose usage drops (rejected or cancelled PO) is lowered silently so it can alert again.
 * Must run inside the transaction that changed the POs.
 */
export async function checkBoqUsageAlerts(tx: Db, boqLineIds: (string | null | undefined)[]): Promise<void> {
  const ids = Array.from(new Set(boqLineIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return;

  const [rows, committed] = await Promise.all([
    tx
      .select({ line: boqLines, projectId: boqs.projectId })
      .from(boqLines)
      .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
      .where(and(inArray(boqLines.id, ids), eq(boqLines.isCategory, false))),
    committedByBoqLine(tx, ids),
  ]);

  const recipientsByProject = new Map<string, string[]>();

  for (const { line, projectId } of rows) {
    const budget = boqMaterialBudget(line);
    const used = committed.get(line.id) ?? D(0);
    const level = boqUsageLevel(used, budget);
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
      recipients = await usersWithRole(tx, [...BOQ_ALERT_ROLES], projectId);
      recipientsByProject.set(projectId, recipients);
    }

    const name = [line.no, line.description].filter(Boolean).join(' ');
    const amounts = `฿${formatMoneyDisplay(used.toFixed(2))} / ฿${formatMoneyDisplay(budget.toFixed(2))}`;
    const title =
      level === 101
        ? `ซื้อเกิน BOQ ${name}: เกิน ฿${formatMoneyDisplay(used.minus(budget).toFixed(2))} (${amounts})`
        : `BOQ ${name}: ซื้อแล้ว ${used.div(budget).times(100).floor().toFixed(0)}% (${amounts})`;

    await notify(tx, recipients, {
      title,
      href: `/projects/${projectId}/boq`,
      category: 'BOQ',
      level: LEVEL_OF[level],
      projectId,
    });
  }
}
