import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  arInvoices,
  arReceipts,
  attachments,
  dailyReports,
  milestones,
  payables,
  projectTasks,
  projects,
  stockItems,
  stockMovements,
  users,
  variationOrders,
  type DailyWorkOutcome,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { MILESTONE_STATUS_LABELS } from '@/domain/milestone';
import { isTaskOverdue, leafTasks, wbsNumbers, type ScheduleTask } from '@/domain/schedule';
import {
  buildCurve,
  categoryProgress,
  compareProgress,
  executiveSummary,
  monthOf,
  nextPeriod,
  previousPeriod,
  rollupDaily,
  weekOf,
  type CategoryProgress,
  type CurvePoint,
  type DailyRollup,
  type Period,
  type ProgressComparison,
  type ProgressEntry,
} from '@/domain/site-report';
import { bangkokDateString } from '@/domain/thai';
import { assertCan, can } from '@/server/policy';
import { getSettings } from './settings';

export type ReportKind = 'WEEK' | 'MONTH';

export interface PeriodicReport {
  kind: ReportKind;
  number: string;
  period: Period;
  previous: Period;
  next: Period;
  /** Last day the actual figures cover: the period end, or today while the period is running */
  cutoff: string;
  company: { name: string; logoUrl: string | null };
  project: { code: string; name: string; client: string; location: string; pmName: string | null; startDate: string | null; endDate: string | null };
  summary: string;
  progress: ProgressComparison;
  hasPlan: boolean;
  categories: CategoryProgress[];
  curve: CurvePoint[];
  rollup: DailyRollup;
  sources: { submitted: number; drafts: number; workItems: number; issues: number; photos: number };
  /** Work summary lines and progress lines; `todayPercent` is set only on progress lines */
  work: { date: string; wbs: string | null; description: string; todayPercent: number | null; progressPercent: number | null; outcome: DailyWorkOutcome | null; note: string }[];
  issues: { date: string; text: string }[];
  safety: { date: string; accident: boolean; note: string }[];
  visitors: { date: string; text: string }[];
  photos: { id: string; url: string; name: string; caption: string }[];
  /** Open tasks that are overdue or reported late, plus work reported late with no task behind it */
  critical: { wbs: string; title: string; dueDate: string | null; progress: number | null; cause: string }[];
  nextPlan: { wbs: string; title: string; startDate: string | null; dueDate: string | null; progress: number }[];
  milestones: { kind: 'PAY' | 'RECEIVE'; title: string; plannedDate: string | null; status: string }[];
  materials: { name: string; unit: string; quantity: number }[];
  /** null when the viewer may not see project money */
  finance: { contractValue: number; approvedVo: number; costToDate: number; billed: number; received: number } | null;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const MAX_LISTED_PHOTOS = 12;

/** Builds a weekly or monthly report purely from what is already in the system. */
export async function getPeriodicReport(db: Db, actor: SessionUser, projectId: string, kind: ReportKind, anchorDate: string): Promise<PeriodicReport> {
  assertCan(actor, 'project.view', { projectId });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate) || Number.isNaN(Date.parse(anchorDate))) {
    throw new DomainError('INVALID_INPUT', 'รูปแบบวันที่ไม่ถูกต้อง');
  }

  const [row] = await db
    .select({ project: projects, pmName: users.name })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.pmUserId))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  const { project, pmName } = row;

  const today = bangkokDateString();
  const period = kind === 'WEEK' ? weekOf(anchorDate) : monthOf(anchorDate);
  const previous = previousPeriod(kind, period);
  const next = nextPeriod(kind, period);
  const cutoff = period.end < today ? period.end : today;

  const [settings, taskRows, reportRows, milestoneRows, materialRows] = await Promise.all([
    getSettings(db),
    db.select().from(projectTasks).where(eq(projectTasks.projectId, projectId)).orderBy(asc(projectTasks.sort)),
    // Every report up to the period end: earlier ones give the progress history
    db
      .select()
      .from(dailyReports)
      .where(and(eq(dailyReports.projectId, projectId), lte(dailyReports.reportDate, period.end)))
      .orderBy(asc(dailyReports.reportDate), asc(dailyReports.createdAt)),
    db.select().from(milestones).where(and(eq(milestones.projectId, projectId), ne(milestones.status, 'CANCELLED'))).orderBy(asc(milestones.kind), asc(milestones.seq)),
    db
      .select({ name: stockItems.name, unit: stockItems.unit, quantity: sql<string>`coalesce(sum(${stockMovements.quantity}), 0)` })
      .from(stockMovements)
      .innerJoin(stockItems, eq(stockItems.id, stockMovements.stockItemId))
      .where(
        and(
          eq(stockMovements.projectId, projectId),
          eq(stockMovements.type, 'ISSUE'),
          gte(stockMovements.createdAt, new Date(`${period.start}T00:00:00+07:00`)),
          lte(stockMovements.createdAt, new Date(`${period.end}T23:59:59.999+07:00`)),
        ),
      )
      .groupBy(stockItems.name, stockItems.unit)
      .orderBy(asc(stockItems.name)),
  ]);

  const tasks: (ScheduleTask & { title: string })[] = taskRows.map((t) => ({
    id: t.id,
    parentId: t.parentId,
    startDate: t.startDate,
    dueDate: t.dueDate,
    progress: t.progress,
    value: num(t.value),
    status: t.status,
    title: t.title,
  }));
  const wbs = wbsNumbers(tasks);

  // Only submitted reports count; drafts can still change
  const submitted = reportRows.filter((r) => r.status === 'SUBMITTED');
  const inPeriod = submitted.filter((r) => r.reportDate >= period.start);
  const drafts = reportRows.filter((r) => r.status === 'DRAFT' && r.reportDate >= period.start).length;

  const entries: ProgressEntry[] = submitted.flatMap((r) => [
    // Reports from before the progress table kept a cumulative figure on the work line
    ...r.work.flatMap((w) => (w.taskId && w.progressPercent != null ? [{ reportDate: r.reportDate, taskId: w.taskId, progressPercent: w.progressPercent }] : [])),
    ...r.progress.flatMap((p) => (p.taskId && p.cumulativePercent != null ? [{ reportDate: r.reportDate, taskId: p.taskId, progressPercent: p.cumulativePercent }] : [])),
  ]);

  const progress = compareProgress(tasks, entries, period, today);
  const hasPlan = tasks.some((t) => t.startDate && t.dueDate);
  const rollup = rollupDaily(inPeriod);

  const titleOf = (t: ScheduleTask) => (t as ScheduleTask & { title: string }).title;
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const work = inPeriod.flatMap((r) => [
    ...r.work.map((w) => ({
      date: r.reportDate,
      wbs: w.taskId ? (wbs.get(w.taskId) ?? null) : null,
      description: w.description,
      todayPercent: null,
      progressPercent: w.progressPercent ?? null,
      outcome: w.outcome ?? null,
      note: w.note,
    })),
    ...r.progress.map((p) => {
      const task = p.taskId ? taskById.get(p.taskId) : undefined;
      return {
        date: r.reportDate,
        wbs: p.taskId ? (wbs.get(p.taskId) ?? null) : null,
        description: [p.area, task ? titleOf(task) : '', p.detail].filter(Boolean).join(' · '),
        todayPercent: p.todayPercent,
        progressPercent: p.cumulativePercent ?? null,
        outcome: null,
        note: p.note,
      };
    }),
  ]);
  const issues = inPeriod.flatMap((r) => [
    ...(r.issues ? [{ date: r.reportDate, text: r.issues }] : []),
    ...r.work.filter((w) => w.note).map((w) => ({ date: r.reportDate, text: `${w.description ? `${w.description}: ` : ''}${w.note}` })),
    ...r.progress.filter((p) => p.note).map((p) => ({ date: r.reportDate, text: `${p.detail || p.area ? `${p.detail || p.area}: ` : ''}${p.note}` })),
    ...(r.scheduleNote ? [{ date: r.reportDate, text: r.scheduleNote }] : []),
  ]);

  // Open leaf tasks that need attention, with the reason
  const delayedTaskIds = new Set(inPeriod.flatMap((r) => r.work.filter((w) => w.taskId && w.outcome === 'DELAYED').map((w) => w.taskId as string)));
  const critical: PeriodicReport['critical'] = [
    ...leafTasks(tasks)
      .filter((t) => t.status !== 'DONE' && t.progress < 100 && (isTaskOverdue(t, cutoff) || delayedTaskIds.has(t.id)))
      .map((t) => ({
        wbs: wbs.get(t.id) ?? '',
        title: titleOf(t),
        dueDate: t.dueDate,
        progress: t.progress,
        cause: isTaskOverdue(t, cutoff) ? 'เกินกำหนด' : 'รายงานว่าล่าช้า',
      })),
    ...inPeriod.flatMap((r) =>
      r.work
        .filter((w) => !w.taskId && w.outcome === 'DELAYED')
        .map((w) => ({ wbs: '-', title: w.description || '-', dueDate: null, progress: null, cause: `รายงานว่าล่าช้า (${r.reportDate})${w.note ? `: ${w.note}` : ''}` })),
    ),
  ];
  const nextPlan = leafTasks(tasks)
    .filter((t) => t.status !== 'DONE' && t.progress < 100 && t.startDate && t.dueDate && t.startDate <= next.end && t.dueDate >= next.start)
    .map((t) => ({ wbs: wbs.get(t.id) ?? '', title: titleOf(t), startDate: t.startDate, dueDate: t.dueDate, progress: t.progress }));

  const reportIds = inPeriod.map((r) => r.id);
  const photoRows = reportIds.length
    ? await db
        .select({ id: attachments.id, url: attachments.url, name: attachments.name, caption: attachments.caption, contentType: attachments.contentType })
        .from(attachments)
        .where(and(eq(attachments.entityType, 'DAILY_REPORT'), inArray(attachments.entityId, reportIds)))
        .orderBy(asc(attachments.createdAt))
    : [];
  const photos = photoRows.filter((p) => p.contentType.startsWith('image/'));

  let finance: PeriodicReport['finance'] = null;
  if (can(actor, 'project.finance', { projectId })) {
    const [voRows, costRows, billedRows, receivedRows] = await Promise.all([
      db
        .select({ amount: sql<string>`coalesce(sum(${variationOrders.addAmount} - ${variationOrders.deductAmount}), 0)` })
        .from(variationOrders)
        .where(and(eq(variationOrders.projectId, projectId), eq(variationOrders.status, 'APPROVED'))),
      db
        .select({ amount: sql<string>`coalesce(sum(${payables.beforeVat}), 0)` })
        .from(payables)
        .where(and(eq(payables.projectId, projectId), ne(payables.status, 'CANCELLED'))),
      db
        .select({ amount: sql<string>`coalesce(sum(${arInvoices.gross}), 0)` })
        .from(arInvoices)
        .where(and(eq(arInvoices.projectId, projectId), inArray(arInvoices.status, ['ISSUED', 'PARTIAL', 'PAID']))),
      db
        .select({ amount: sql<string>`coalesce(sum(${arReceipts.amountReceived} + ${arReceipts.whtAmount}), 0)` })
        .from(arReceipts)
        .innerJoin(arInvoices, eq(arInvoices.id, arReceipts.invoiceId))
        .where(and(eq(arInvoices.projectId, projectId), eq(arReceipts.voided, false))),
    ]);
    finance = {
      contractValue: num(project.budget),
      approvedVo: num(voRows[0]?.amount),
      costToDate: num(costRows[0]?.amount),
      billed: num(billedRows[0]?.amount),
      received: num(receivedRows[0]?.amount),
    };
  }

  const stamp = period.start.replaceAll('-', '');
  return {
    kind,
    number: kind === 'WEEK' ? `WR-${stamp}` : `MR-${stamp.slice(0, 6)}`,
    period,
    previous,
    next,
    cutoff,
    company: { name: settings.companyName, logoUrl: settings.logoUrl ?? null },
    project: {
      code: project.code,
      name: project.name,
      client: project.clientName,
      location: project.location,
      pmName,
      startDate: project.startDate,
      endDate: project.endDate,
    },
    summary: executiveSummary({ kind, period, progress, hasPlan, rollup, issueCount: issues.length }),
    progress,
    hasPlan,
    categories: categoryProgress(tasks, entries, period, today),
    curve: buildCurve(tasks, entries, cutoff, today),
    rollup,
    sources: { submitted: inPeriod.length, drafts, workItems: work.length, issues: issues.length, photos: photos.length },
    work,
    issues,
    safety: inPeriod.filter((r) => r.accident || r.safetyNote).map((r) => ({ date: r.reportDate, accident: r.accident, note: r.safetyNote })),
    visitors: inPeriod.filter((r) => r.visitors).map((r) => ({ date: r.reportDate, text: r.visitors })),
    photos: photos.slice(0, MAX_LISTED_PHOTOS).map(({ id, url, name, caption }) => ({ id, url, name, caption })),
    critical,
    nextPlan,
    milestones: milestoneRows
      .filter((m) => !m.plannedDate || (m.plannedDate >= period.start && m.plannedDate <= next.end) || m.claimedAt || m.approvedAt)
      .filter((m) => m.status !== 'PAID' || (m.paidAt ?? '') >= period.start)
      .map((m) => ({ kind: m.kind, title: m.title, plannedDate: m.plannedDate, status: MILESTONE_STATUS_LABELS[m.kind][m.status] })),
    materials: materialRows.map((m) => ({ name: m.name, unit: m.unit, quantity: num(m.quantity) })),
    finance,
  };
}
