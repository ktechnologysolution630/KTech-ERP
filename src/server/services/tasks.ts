import { and, asc, eq, isNull, max } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { projectTasks, projects, users, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D } from '@/domain/money';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  wbsNumbers,
  type TaskPriority,
  type TaskStatus,
} from '@/domain/schedule';
import { assertCan, can } from '@/server/policy';

export interface TaskDto {
  id: string;
  parentId: string | null;
  wbs: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  value: number;
  assigneeId: string | null;
  assigneeName: string | null;
  hasChildren: boolean;
}

export interface ProjectTaskList {
  tasks: TaskDto[];
  canManage: boolean;
  canUpdateProgress: boolean;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');

const taskFields = {
  title: z.string().trim().min(1, 'กรุณาระบุชื่องาน').max(300),
  description: z.string().trim().max(2000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  startDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  progress: z.number().int('ความคืบหน้าต้องเป็นจำนวนเต็ม').min(0).max(100),
  value: z.number().finite().min(0, 'มูลค่างานต้องไม่ติดลบ').max(10_000_000_000_000),
  assigneeId: z.string().uuid().nullable(),
};

const createSchema = z.object({
  parentId: z.string().uuid().nullable().default(null),
  title: taskFields.title,
  description: taskFields.description.default(''),
  status: taskFields.status.default('TODO'),
  priority: taskFields.priority.default('MEDIUM'),
  startDate: taskFields.startDate.default(null),
  dueDate: taskFields.dueDate.default(null),
  progress: taskFields.progress.default(0),
  value: taskFields.value.default(0),
  assigneeId: taskFields.assigneeId.default(null),
});

const updateSchema = z.object(taskFields).partial();

export type CreateTaskInput = z.input<typeof createSchema>;
export type UpdateTaskInput = z.input<typeof updateSchema>;

/** Fields a site foreman may change without full task-management rights. */
const PROGRESS_ONLY_KEYS = new Set(['status', 'progress']);

function assertValid<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (!result.success) throw new DomainError('INVALID_TASK', result.error.issues[0].message);
  return result.data;
}

function assertDates(start: string | null, due: string | null) {
  if (start && due && due < start) {
    throw new DomainError('INVALID_TASK', 'วันกำหนดเสร็จต้องไม่ก่อนวันเริ่มงาน');
  }
}

async function assertProject(db: Db, projectId: string) {
  if (!z.string().uuid().safeParse(projectId).success) {
    throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
  }
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new DomainError('NOT_FOUND', 'ไม่พบโครงการ', 404);
}

async function loadTask(db: Db, taskId: string) {
  if (!z.string().uuid().safeParse(taskId).success) {
    throw new DomainError('NOT_FOUND', 'ไม่พบงาน', 404);
  }
  const [task] = await db.select().from(projectTasks).where(eq(projectTasks.id, taskId)).limit(1);
  if (!task) throw new DomainError('NOT_FOUND', 'ไม่พบงาน', 404);
  return task;
}

async function assertAssignee(db: Db, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const [u] = await db
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(eq(users.id, assigneeId))
    .limit(1);
  if (!u || !u.active) throw new DomainError('INVALID_TASK', 'ไม่พบผู้รับผิดชอบที่เลือก');
}

/** DONE always means 100 %; reaching 100 % does not close the task by itself (it may need review). */
function normalizeProgress(status: TaskStatus | undefined, progress: number | undefined) {
  return status === 'DONE' ? 100 : progress;
}

export async function listProjectTasks(
  db: Db,
  actor: SessionUser,
  projectId: string,
): Promise<ProjectTaskList> {
  await assertProject(db, projectId);
  assertCan(actor, 'project.view', { projectId });

  const rows = await db
    .select({ task: projectTasks, assigneeName: users.name })
    .from(projectTasks)
    .leftJoin(users, eq(users.id, projectTasks.assigneeId))
    .where(eq(projectTasks.projectId, projectId))
    .orderBy(asc(projectTasks.sort), asc(projectTasks.createdAt));

  // Parent-first order: each top-level task followed by its children
  const top = rows.filter((r) => r.task.parentId === null);
  const childrenOf = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.task.parentId) {
      const list = childrenOf.get(r.task.parentId) ?? [];
      list.push(r);
      childrenOf.set(r.task.parentId, list);
    }
  }
  const ordered = top.flatMap((r) => [r, ...(childrenOf.get(r.task.id) ?? [])]);
  const wbs = wbsNumbers(ordered.map((r) => r.task));

  return {
    tasks: ordered.map(({ task, assigneeName }) => ({
      id: task.id,
      parentId: task.parentId,
      wbs: wbs.get(task.id) ?? '',
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      startDate: task.startDate,
      dueDate: task.dueDate,
      progress: task.progress,
      value: Number(task.value),
      assigneeId: task.assigneeId,
      assigneeName,
      hasChildren: childrenOf.has(task.id),
    })),
    canManage: can(actor, 'task.manage', { projectId }),
    canUpdateProgress: can(actor, 'task.progress', { projectId }),
  };
}

export async function createTask(
  db: Db,
  actor: SessionUser,
  projectId: string,
  input: CreateTaskInput,
): Promise<{ id: string }> {
  await assertProject(db, projectId);
  assertCan(actor, 'task.manage', { projectId });
  const data = assertValid(createSchema.safeParse(input));
  assertDates(data.startDate, data.dueDate);
  await assertAssignee(db, data.assigneeId);

  if (data.parentId) {
    const parent = await loadTask(db, data.parentId);
    if (parent.projectId !== projectId) {
      throw new DomainError('INVALID_TASK', 'งานหลักต้องอยู่ในโครงการเดียวกัน');
    }
    if (parent.parentId !== null) {
      throw new DomainError('INVALID_TASK', 'เพิ่มงานย่อยได้เพียง 1 ระดับ');
    }
  }

  return db.transaction(async (tx) => {
    const siblings = data.parentId
      ? eq(projectTasks.parentId, data.parentId)
      : and(eq(projectTasks.projectId, projectId), isNull(projectTasks.parentId));
    const [{ last }] = await tx
      .select({ last: max(projectTasks.sort) })
      .from(projectTasks)
      .where(siblings);

    const [created] = await tx
      .insert(projectTasks)
      .values({
        projectId,
        parentId: data.parentId,
        sort: (last ?? -1) + 1,
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        startDate: data.startDate,
        dueDate: data.dueDate,
        progress: normalizeProgress(data.status, data.progress) ?? 0,
        value: D(data.value).toFixed(2),
        assigneeId: data.assigneeId,
        createdBy: actor.id,
      })
      .returning();
    return { id: created.id };
  });
}

export async function updateTask(
  db: Db,
  actor: SessionUser,
  taskId: string,
  input: UpdateTaskInput,
): Promise<void> {
  const task = await loadTask(db, taskId);
  const data = assertValid(updateSchema.safeParse(input));
  const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
  const progressOnly = keys.length > 0 && keys.every((k) => PROGRESS_ONLY_KEYS.has(k));
  assertCan(actor, progressOnly ? 'task.progress' : 'task.manage', { projectId: task.projectId });

  assertDates(
    data.startDate !== undefined ? data.startDate : task.startDate,
    data.dueDate !== undefined ? data.dueDate : task.dueDate,
  );
  await assertAssignee(db, data.assigneeId);

  await db
    .update(projectTasks)
    .set({
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
      ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
      ...(normalizeProgress(data.status, data.progress) !== undefined
        ? { progress: normalizeProgress(data.status, data.progress) }
        : {}),
      ...(data.value !== undefined ? { value: D(data.value).toFixed(2) } : {}),
      ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(projectTasks.id, taskId));
}

/** Deletes a task; its sub-tasks go with it (FK cascade). */
export async function deleteTask(db: Db, actor: SessionUser, taskId: string): Promise<void> {
  const task = await loadTask(db, taskId);
  assertCan(actor, 'task.manage', { projectId: task.projectId });
  await db.delete(projectTasks).where(eq(projectTasks.id, taskId));
}
