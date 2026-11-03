import { asc, eq, inArray } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { projectTasks, projects, users, type SessionUser } from '@/db/schema';
import { type ProjectStatus } from '@/domain/project';
import { computeProjectProgress, plannedProgressAt, type ScheduleTask } from '@/domain/schedule';
import { bangkokDateString } from '@/domain/thai';
import { isSiteScopedOnly } from '@/server/policy';

export interface TimelineRow {
  id: string;
  code: string;
  name: string;
  location: string;
  status: ProjectStatus;
  pmId: string | null;
  pmName: string | null;
  /** Contract dates, or the span of the project's dated tasks when the contract dates are not set */
  startDate: string | null;
  endDate: string | null;
  datesFromTasks: boolean;
  progress: number;
  plannedProgress: number;
  taskCount: number;
}

/** Every project the user may see, with its date span and actual vs planned progress. */
export async function listProjectTimeline(db: Db, actor: SessionUser): Promise<{ today: string; rows: TimelineRow[] }> {
  const today = bangkokDateString();
  const all = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      location: projects.location,
      status: projects.status,
      startDate: projects.startDate,
      endDate: projects.endDate,
      pmId: projects.pmUserId,
      pmName: users.name,
    })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.pmUserId))
    .orderBy(asc(projects.code));
  const visible = isSiteScopedOnly(actor) ? all.filter((p) => actor.projectIds.includes(p.id)) : all;
  if (visible.length === 0) return { today, rows: [] };

  const taskRows = await db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      parentId: projectTasks.parentId,
      startDate: projectTasks.startDate,
      dueDate: projectTasks.dueDate,
      progress: projectTasks.progress,
      value: projectTasks.value,
      status: projectTasks.status,
    })
    .from(projectTasks)
    .where(
      inArray(
        projectTasks.projectId,
        visible.map((p) => p.id),
      ),
    );
  const byProject = new Map<string, ScheduleTask[]>();
  for (const t of taskRows) {
    const list = byProject.get(t.projectId) ?? [];
    list.push({ ...t, value: Number(t.value) });
    byProject.set(t.projectId, list);
  }

  return {
    today,
    rows: visible.map((p) => {
      const tasks = byProject.get(p.id) ?? [];
      const starts = tasks.map((t) => t.startDate).filter((d): d is string => !!d).sort();
      const ends = tasks.map((t) => t.dueDate).filter((d): d is string => !!d).sort();
      const startDate = p.startDate ?? starts[0] ?? null;
      const endDate = p.endDate ?? ends.at(-1) ?? null;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        location: p.location,
        status: p.status,
        pmId: p.pmId,
        pmName: p.pmName,
        startDate,
        endDate,
        datesFromTasks: (!p.startDate && !!starts[0]) || (!p.endDate && !!ends.at(-1)),
        progress: p.status === 'COMPLETED' ? 100 : computeProjectProgress(tasks),
        plannedProgress: plannedProgressAt(tasks, today),
        taskCount: tasks.length,
      };
    }),
  };
}
