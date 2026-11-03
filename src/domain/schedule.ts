export const TASK_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'PENDING_APPROVAL',
  'DONE',
  'REJECTED',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'รอดำเนินการ',
  IN_PROGRESS: 'กำลังดำเนินการ',
  IN_REVIEW: 'รอตรวจสอบ',
  PENDING_APPROVAL: 'รออนุมัติ',
  DONE: 'เสร็จสิ้น',
  REJECTED: 'ไม่อนุมัติ',
};

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'ต่ำ',
  MEDIUM: 'ปานกลาง',
  HIGH: 'สูง',
};

/** Minimal task shape the schedule maths needs; dates are ISO `yyyy-mm-dd`. */
export interface ScheduleTask {
  id: string;
  parentId: string | null;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  value: number;
  status: TaskStatus;
}

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

export function isTaskOverdue(task: Pick<ScheduleTask, 'dueDate' | 'status'>, today: string): boolean {
  return task.dueDate !== null && task.dueDate < today && task.status !== 'DONE';
}

/** Leaf tasks carry the work; a parent only groups its children. */
export function leafTasks<T extends ScheduleTask>(tasks: T[]): T[] {
  const parents = new Set(tasks.map((t) => t.parentId).filter((id): id is string => id !== null));
  return tasks.filter((t) => !parents.has(t.id));
}

/**
 * Weight per leaf: its value (baht) when any leaf has a value, otherwise planned duration in days,
 * otherwise equal weights. Mirrors "% แผนงาน: ตามงบประมาณ".
 */
function weights(leaves: ScheduleTask[]): number[] {
  if (leaves.some((t) => t.value > 0)) return leaves.map((t) => Math.max(0, t.value));
  const durations = leaves.map((t) =>
    t.startDate && t.dueDate ? Math.max(1, dayNumber(t.dueDate) - dayNumber(t.startDate) + 1) : 0,
  );
  if (durations.some((d) => d > 0)) return durations;
  return leaves.map(() => 1);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Weighted actual progress of the whole project, 0–100 with one decimal. */
export function computeProjectProgress(tasks: ScheduleTask[]): number {
  const leaves = leafTasks(tasks);
  if (leaves.length === 0) return 0;
  const w = weights(leaves);
  const total = w.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const done = leaves.reduce((acc, t, i) => acc + w[i] * Math.min(100, Math.max(0, t.progress)), 0);
  return round1(done / total);
}

/** Planned cumulative % at the end of `date`, assuming each leaf's work spreads evenly over its days. */
export function plannedProgressAt(tasks: ScheduleTask[], date: string): number {
  const leaves = leafTasks(tasks);
  if (leaves.length === 0) return 0;
  const w = weights(leaves);
  const total = w.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const d = dayNumber(date);
  let planned = 0;
  leaves.forEach((t, i) => {
    if (!t.startDate || !t.dueDate) return;
    const s = dayNumber(t.startDate);
    const e = dayNumber(t.dueDate);
    if (d < s) return;
    const fraction = d >= e ? 1 : (d - s + 1) / (e - s + 1);
    planned += w[i] * fraction;
  });
  return round1((planned / total) * 100);
}

export interface SchedulePoint {
  date: string;
  planned: number;
}

/** Planned S-curve sampled at month ends between the earliest start and latest due date. */
export function plannedCurve(tasks: ScheduleTask[]): SchedulePoint[] {
  const dated = leafTasks(tasks).filter((t) => t.startDate && t.dueDate);
  if (dated.length === 0) return [];
  const start = dated.map((t) => t.startDate as string).sort()[0];
  const end = dated.map((t) => t.dueDate as string).sort().at(-1) as string;

  const points: SchedulePoint[] = [{ date: start, planned: plannedProgressAt(tasks, start) }];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  for (;;) {
    // Last day of month y-m
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (monthEnd >= end) break;
    if (monthEnd > start) points.push({ date: monthEnd, planned: plannedProgressAt(tasks, monthEnd) });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  points.push({ date: end, planned: plannedProgressAt(tasks, end) });
  return points;
}

/** WBS numbers ("1", "1.2") for tasks already ordered parent-first by sort. */
export function wbsNumbers(tasks: { id: string; parentId: string | null }[]): Map<string, string> {
  const result = new Map<string, string>();
  const childCount = new Map<string, number>();
  let top = 0;
  for (const t of tasks) {
    if (t.parentId === null) {
      top += 1;
      result.set(t.id, String(top));
    } else {
      const n = (childCount.get(t.parentId) ?? 0) + 1;
      childCount.set(t.parentId, n);
      result.set(t.id, `${result.get(t.parentId) ?? '?'}.${n}`);
    }
  }
  return result;
}
