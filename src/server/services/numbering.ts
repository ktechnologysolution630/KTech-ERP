import { eq, sql } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { type Db } from '@/db/client';
import {
  apCreditNotes,
  activityLogs,
  advances,
  arCreditNotes,
  arInvoices,
  arReceipts,
  boqOverrunRequests,
  docCounters,
  journalEntries,
  pos,
  prs,
  prvs,
  pvs,
  salesDocs,
  variationOrders,
} from '@/db/schema';
import { docPeriod } from '@/domain/thai';

export type DocPrefix =
  | 'PR'
  | 'PO'
  | 'PV'
  | 'WHT'
  | 'PRV'
  | 'SM'
  | 'SAR'
  | 'SC'
  | 'GR'
  | 'ISS'
  | 'TRF'
  | 'BRW'
  | 'QT'
  | 'REC'
  | 'TI'
  | 'STI'
  | 'DN'
  | 'INC'
  | 'EXP'
  | 'BOQ'
  | 'PJ'
  | 'AP'
  | 'VO'
  | 'INV'
  | 'VT'
  | 'RC'
  | 'CN'
  | 'PCN'
  | 'ADV'
  | 'RS'
  | 'MAT'
  | 'DR'
  | 'WAR'
  | 'DF'
  | 'AST'
  | 'JV'
  | 'AJ'
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

/**
 * Where documents whose numbers can be set or changed by hand keep them. A counter set back, or a
 * document renumbered ahead of the count, could hand out a number already in use, so these are
 * checked and skipped.
 */
export const NUMBERED_DOCS: Partial<Record<DocPrefix, { table: PgTable; column: PgColumn }>> = {
  PR: { table: prs, column: prs.number },
  PO: { table: pos, column: pos.number },
  PV: { table: pvs, column: pvs.number },
  AP: { table: boqOverrunRequests, column: boqOverrunRequests.number },
  PRV: { table: prvs, column: prvs.prvNumber },
  INV: { table: arInvoices, column: arInvoices.number },
  RC: { table: arReceipts, column: arReceipts.number },
  CN: { table: arCreditNotes, column: arCreditNotes.number },
  PCN: { table: apCreditNotes, column: apCreditNotes.number },
  QT: { table: salesDocs, column: salesDocs.number },
  REC: { table: salesDocs, column: salesDocs.number },
  TI: { table: salesDocs, column: salesDocs.number },
  STI: { table: salesDocs, column: salesDocs.number },
  DN: { table: salesDocs, column: salesDocs.number },
  INC: { table: salesDocs, column: salesDocs.number },
  EXP: { table: salesDocs, column: salesDocs.number },
  ADV: { table: advances, column: advances.number },
  VO: { table: variationOrders, column: variationOrders.number },
  JV: { table: journalEntries, column: journalEntries.number },
};

/**
 * The activity-log entry of a delete lists the numbers that went, so they are never handed out again
 * even when the counter is set back by hand
 */
export const deletedNumbersData = (numbers: string[]) => ({ deletedNumbers: numbers });

export async function wasDeleted(tx: Db, number: string): Promise<boolean> {
  const [hit] = await tx
    .select({ one: sql<number>`1` })
    .from(activityLogs)
    .where(sql`${activityLogs.data} -> 'deletedNumbers' @> jsonb_build_array(${number}::text)`)
    .limit(1);
  return Boolean(hit);
}

/** Whether a document of this kind already carries the number, or one that carried it was deleted */
export async function isDocNumberTaken(tx: Db, prefix: DocPrefix, number: string): Promise<boolean> {
  const where = NUMBERED_DOCS[prefix];
  if (where) {
    const [hit] = await tx.select({ one: sql<number>`1` }).from(where.table).where(eq(where.column, number)).limit(1);
    if (hit) return true;
  }
  return wasDeleted(tx, number);
}

/** PO-6911-0001: prefix, Thai year and month, then the count in that month */
export const formatDocNumber = (prefix: DocPrefix, period: string, seq: number) => `${prefix}-${period}-${String(seq).padStart(4, '0')}`;

/** PR-K68-007-11001: prefix, project code, month, then the count for that project in that month */
export const formatProjectDocNumber = (prefix: DocPrefix, code: string, period: string, seq: number) =>
  `${prefix}-${code.trim() || 'NOPROJ'}-${period.slice(2)}${String(seq).padStart(3, '0')}`;

/** Counter key of a number that runs per project and month */
export const projectCounterPeriod = (projectId: string, period: string) => `project:${projectId}:${period}`;

export async function nextDocNumber(
  tx: Db,
  prefix: DocPrefix,
  at: Date = new Date(),
): Promise<string> {
  const period = docPeriod(at);
  // A number already in use (set by hand) is skipped
  for (let attempt = 0; attempt < 1000; attempt++) {
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
    const candidate = formatDocNumber(prefix, period, rows[0]!.last);
    if (!(await isDocNumberTaken(tx, prefix, candidate))) return candidate;
  }
  throw new Error(`Could not find a free ${prefix} number for ${period}`);
}

/**
 * Number that runs per project and month, e.g. PR-K68-007-11001, PR-K68-007-11002, then
 * PR-K68-007-12001 when December starts (Bangkok time). The counter is keyed by the project id,
 * so renaming the project's code keeps its sequence; a number already taken is skipped.
 */
export async function nextProjectDocNumber(
  tx: Db,
  prefix: DocPrefix,
  project: { id: string; code: string },
  isTaken: (candidate: string) => Promise<boolean>,
  at: Date = new Date(),
): Promise<string> {
  // docPeriod is yyMM in the Thai year; the year keeps next December apart from this one
  const period = docPeriod(at);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const rows = await tx
      .insert(docCounters)
      .values({ prefix, period: projectCounterPeriod(project.id, period), last: 1 })
      .onConflictDoUpdate({
        target: [docCounters.prefix, docCounters.period],
        set: { last: sql`${docCounters.last} + 1`, updatedAt: new Date() },
      })
      .returning();
    const candidate = formatProjectDocNumber(prefix, project.code, period, rows[0]!.last);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`Could not find a free ${prefix} number for project ${project.code.trim() || 'NOPROJ'}`);
}
