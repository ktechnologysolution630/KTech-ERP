import { sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { docCounters } from '@/db/schema';
import { docPeriod } from '@/domain/thai';

export type DocPrefix =
  | 'PR'
  | 'PO'
  | 'PV'
  | 'WHT'
  | 'PRV'
  | 'SM'
  | 'SAR'
  | 'BOQ'
  | 'PJ'
  | 'AP'
  | 'VO'
  | 'INV'
  | 'RC'
  | 'CN'
  | 'ADV'
  | 'RS'
  | 'MAT'
  | 'DR'
  | 'WAR'
  | 'DF'
  | 'AST'
  | 'V';

/** Daily report number by report date, e.g. DR-20261104-001; several reports on one day get the next number. */
export async function nextDailyReportNumber(tx: Db, reportDate: string): Promise<string> {
  const period = reportDate.replaceAll('-', '');
  const rows = await tx
    .insert(docCounters)
    .values({ prefix: 'DR', period, last: 1 })
    .onConflictDoUpdate({
      target: [docCounters.prefix, docCounters.period],
      set: { last: sql`${docCounters.last} + 1`, updatedAt: new Date() },
    })
    .returning();
  return `DR-${period}-${String(rows[0]!.last).padStart(3, '0')}`;
}

export async function nextDocNumber(
  tx: Db,
  prefix: DocPrefix,
  at: Date = new Date(),
): Promise<string> {
  const period = docPeriod(at);
  const rows = await tx
    .insert(docCounters)
    .values({ prefix, period, last: 1 })
    .onConflictDoUpdate({
      target: [docCounters.prefix, docCounters.period],
      set: {
        last: sql`${docCounters.last} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();

  const seq = String(rows[0]!.last).padStart(4, '0');
  return `${prefix}-${period}-${seq}`;
}

/**
 * Number that runs per project, e.g. PR-K68-007-0001, PR-K68-007-0002. The counter is keyed by
 * the project id, so renaming the project's code keeps its sequence; a number already taken
 * (an older document) is skipped.
 */
export async function nextProjectDocNumber(
  tx: Db,
  prefix: DocPrefix,
  project: { id: string; code: string },
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const code = project.code.trim() || 'NOPROJ';
  for (let attempt = 0; attempt < 1000; attempt++) {
    const rows = await tx
      .insert(docCounters)
      .values({ prefix, period: `project:${project.id}`, last: 1 })
      .onConflictDoUpdate({
        target: [docCounters.prefix, docCounters.period],
        set: { last: sql`${docCounters.last} + 1`, updatedAt: new Date() },
      })
      .returning();
    const candidate = `${prefix}-${code}-${String(rows[0]!.last).padStart(4, '0')}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`Could not find a free ${prefix} number for project ${code}`);
}
