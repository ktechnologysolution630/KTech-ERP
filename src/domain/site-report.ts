import { computeProjectProgress, plannedProgressAt, type ScheduleTask } from './schedule';

const DAY_MS = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const fromDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

export const addDays = (iso: string, days: number) => fromDay(toDay(iso) + days);

export interface Period {
  start: string;
  end: string;
}

/** The Monday-to-Sunday week containing `date`. */
export function weekOf(date: string): Period {
  // 1970-01-01 was a Thursday, so day number + 3 counts from a Monday
  const day = toDay(date);
  const monday = day - ((day + 3) % 7);
  return { start: fromDay(monday), end: fromDay(monday + 6) };
}

/** The calendar month containing `date`. */
export function monthOf(date: string): Period {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return { start: `${date.slice(0, 7)}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

export const previousPeriod = (kind: 'WEEK' | 'MONTH', p: Period): Period =>
  kind === 'WEEK' ? weekOf(addDays(p.start, -1)) : monthOf(addDays(p.start, -1));

export const nextPeriod = (kind: 'WEEK' | 'MONTH', p: Period): Period =>
  kind === 'WEEK' ? weekOf(addDays(p.end, 1)) : monthOf(addDays(p.end, 1));

/** Task progress recorded in one submitted daily report. */
export interface ProgressEntry {
  reportDate: string;
  taskId: string;
  progressPercent: number;
}

/**
 * Weighted actual progress as it stood at the end of `date`. There are no stored snapshots, so
 * the past comes from submitted daily reports (each task's highest figure so far); from today on
 * the tasks' current progress is used, which also covers updates made directly on the task.
 */
export function actualProgressAt(tasks: ScheduleTask[], entries: ProgressEntry[], date: string, today: string): number {
  if (date >= today) return computeProjectProgress(tasks);
  const best = new Map<string, number>();
  for (const e of entries) {
    if (e.reportDate > date) continue;
    best.set(e.taskId, Math.max(best.get(e.taskId) ?? 0, e.progressPercent));
  }
  return computeProjectProgress(tasks.map((t) => ({ ...t, progress: best.get(t.id) ?? 0 })));
}

export interface CurvePoint {
  date: string;
  planned: number;
  /** null after the cut-off date: the future has no actual */
  actual: number | null;
}

/** Dates to plot between the plan's start and end: weekly up to about 6 months, then month ends; always includes the cut-off. */
export function curveDates(start: string, end: string, cutoff: string): string[] {
  if (end < start) return [];
  const dates = new Set<string>([start, end]);
  if (toDay(end) - toDay(start) <= 190) {
    for (let d = weekOf(start).end; d < end; d = addDays(d, 7)) if (d > start) dates.add(d);
  } else {
    for (let m = monthOf(start); m.end < end; m = monthOf(addDays(m.end, 1))) if (m.end > start) dates.add(m.end);
  }
  if (cutoff > start && cutoff < end) dates.add(cutoff);
  return [...dates].sort();
}

export function buildCurve(tasks: ScheduleTask[], entries: ProgressEntry[], cutoff: string, today: string): CurvePoint[] {
  const dated = tasks.filter((t) => t.startDate && t.dueDate);
  if (dated.length === 0) return [];
  const start = dated.map((t) => t.startDate as string).sort()[0]!;
  const end = dated.map((t) => t.dueDate as string).sort().at(-1)!;
  return curveDates(start, end, cutoff).map((date) => ({
    date,
    planned: plannedProgressAt(tasks, date),
    actual: date <= cutoff ? actualProgressAt(tasks, entries, date, today) : null,
  }));
}

export interface CategoryProgress {
  name: string;
  planned: number;
  actual: number;
  previousActual: number;
}

/** Progress per top-level WBS item; a top-level task with no children counts as its own category. */
export function categoryProgress(
  tasks: (ScheduleTask & { title: string })[],
  entries: ProgressEntry[],
  period: Period,
  today: string,
): CategoryProgress[] {
  const cutoff = period.end < today ? period.end : today;
  return tasks
    .filter((t) => t.parentId === null)
    .map((top) => {
      const group = tasks.filter((t) => t.id === top.id || t.parentId === top.id);
      return {
        name: top.title,
        planned: plannedProgressAt(group, period.end),
        actual: actualProgressAt(group, entries, cutoff, today),
        previousActual: actualProgressAt(group, entries, addDays(period.start, -1), today),
      };
    });
}

export interface ProgressComparison {
  previousPlanned: number;
  previousActual: number;
  planned: number;
  actual: number;
  plannedIncrease: number;
  actualIncrease: number;
  /** Actual − planned at the end of the period (percentage points) */
  variance: number;
  /** Actual increase − planned increase during the period (percentage points) */
  periodVariance: number;
}

export function compareProgress(tasks: ScheduleTask[], entries: ProgressEntry[], period: Period, today: string): ProgressComparison {
  const previousEnd = addDays(period.start, -1);
  const cutoff = period.end < today ? period.end : today;
  const previousPlanned = plannedProgressAt(tasks, previousEnd);
  const previousActual = actualProgressAt(tasks, entries, previousEnd, today);
  const planned = plannedProgressAt(tasks, period.end);
  const actual = actualProgressAt(tasks, entries, cutoff, today);
  const plannedIncrease = round1(planned - previousPlanned);
  const actualIncrease = round1(actual - previousActual);
  return {
    previousPlanned,
    previousActual,
    planned,
    actual,
    plannedIncrease,
    actualIncrease,
    variance: round1(actual - planned),
    periodVariance: round1(actualIncrease - plannedIncrease),
  };
}

export interface DailyRollupInput {
  reportDate: string;
  scheduleImpact: boolean;
  accident: boolean;
  labour: { company: string; workers: number; hours: number }[];
  equipment: { type: string; hours: number }[];
}

export interface DailyRollup {
  reportDays: number;
  avgManpower: number;
  peakManpower: number;
  manDays: number;
  accidents: number;
  impactedDays: number;
  labour: { company: string; manDays: number; manHours: number }[];
  equipment: { type: string; hours: number }[];
}

/** Adds up the labour and equipment entered across the period's submitted daily reports. */
export function rollupDaily(reports: DailyRollupInput[]): DailyRollup {
  const labour = new Map<string, { manDays: number; manHours: number }>();
  const equipment = new Map<string, number>();
  const headcountByDay = new Map<string, number>();
  for (const r of reports) {
    let headcount = 0;
    for (const l of r.labour) {
      headcount += l.workers;
      const key = l.company || 'ไม่ระบุ';
      const prev = labour.get(key) ?? { manDays: 0, manHours: 0 };
      labour.set(key, { manDays: prev.manDays + l.workers, manHours: prev.manHours + l.workers * l.hours });
    }
    for (const e of r.equipment) equipment.set(e.type, (equipment.get(e.type) ?? 0) + e.hours);
    headcountByDay.set(r.reportDate, (headcountByDay.get(r.reportDate) ?? 0) + headcount);
  }
  const counts = [...headcountByDay.values()];
  const manDays = counts.reduce((a, n) => a + n, 0);
  return {
    reportDays: counts.length,
    avgManpower: counts.length ? round1(manDays / counts.length) : 0,
    peakManpower: counts.length ? Math.max(...counts) : 0,
    manDays,
    accidents: reports.filter((r) => r.accident).length,
    impactedDays: new Set(reports.filter((r) => r.scheduleImpact).map((r) => r.reportDate)).size,
    labour: [...labour.entries()].map(([company, v]) => ({ company, ...v })).sort((a, b) => b.manDays - a.manDays),
    equipment: [...equipment.entries()].map(([type, hours]) => ({ type, hours })).sort((a, b) => b.hours - a.hours),
  };
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export function formatPeriod(p: Period): string {
  const part = (iso: string) => ({ d: Number(iso.slice(8, 10)), m: THAI_MONTHS[Number(iso.slice(5, 7)) - 1], y: Number(iso.slice(0, 4)) + 543 });
  const a = part(p.start);
  const b = part(p.end);
  if (a.m === b.m && a.y === b.y) return `${a.d}-${b.d} ${b.m} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${a.m} - ${b.d} ${b.m} ${b.y}`;
  return `${a.d} ${a.m} ${a.y} - ${b.d} ${b.m} ${b.y}`;
}

/** The auto-written summary paragraph at the top of weekly and monthly reports. */
export function executiveSummary(input: {
  kind: 'WEEK' | 'MONTH';
  period: Period;
  progress: ProgressComparison;
  hasPlan: boolean;
  rollup: DailyRollup;
  issueCount: number;
}): string {
  const { progress: p, rollup: r } = input;
  const label = input.kind === 'WEEK' ? 'สัปดาห์' : 'เดือน';
  const parts = [`สรุปผลงานประจำ${label} ${formatPeriod(input.period)}: ความคืบหน้าจริง ${p.actual}% (เพิ่มขึ้น ${p.actualIncrease}%)`];
  if (input.hasPlan) {
    const pos = p.variance > 0 ? `เร็วกว่าแผน ${p.variance}%` : p.variance < 0 ? `ช้ากว่าแผน ${-p.variance}%` : 'ตรงตามแผน';
    parts.push(`เทียบกับแผน ${p.planned}% ${pos}`);
  } else {
    parts.push('ยังไม่มีแผนงานที่กำหนดวันเริ่ม-วันเสร็จใน Gantt');
  }
  if (r.reportDays === 0) {
    parts.push(`ไม่มี Daily Report ที่ส่งแล้วใน${label}นี้`);
  } else {
    parts.push(`มี Daily Report ${r.reportDays} วัน คนงานเฉลี่ย ${r.avgManpower} คน/วัน`);
    parts.push(r.accidents > 0 ? `พบอุบัติเหตุ ${r.accidents} ครั้ง` : 'ไม่มีอุบัติเหตุ');
    if (r.impactedDays > 0) parts.push(`กระทบแผนงาน ${r.impactedDays} วัน`);
    if (input.issueCount > 0) parts.push(`มีปัญหา/อุปสรรค ${input.issueCount} รายการ`);
  }
  return parts.join(' · ');
}
