import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  projectMembers,
  projectTasks,
  projects,
  users,
  type SessionUser,
} from '@/db/schema';
import { isProjectClosed, type ProjectStatus } from '@/domain/project';
import {
  computeProjectProgress,
  leafTasks,
  type ScheduleTask,
} from '@/domain/schedule';
import { can, isSiteScopedOnly } from '@/server/policy';

export interface PortalProject {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  coverImageUrl: string;
  clientName: string;
  pmName: string | null;
  location: string;
  /** null when the viewer may not see project money */
  budget: number | null;
  progress: number;
  tasksDone: number;
  tasksTotal: number;
  team: { id: string; name: string }[];
}

/**
 * Projects for the portal: the ones the user belongs to or manages. Office roles that belong to
 * no project see every open project instead, so the portal is never empty for them.
 */
export async function getPortalProjects(
  db: Db,
  actor: SessionUser,
): Promise<{ scope: 'MINE' | 'ALL_OPEN'; projects: PortalProject[] }> {
  // A fresh builder per query: drizzle builders are mutable, so a shared one would keep the first where()
  const base = () =>
    db
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        status: projects.status,
        coverImageUrl: projects.coverImageUrl,
        clientName: projects.clientName,
        location: projects.location,
        budget: projects.budget,
        pmUserId: projects.pmUserId,
        pmName: users.name,
      })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.pmUserId));

  const mineFilter = actor.projectIds.length
    ? or(
        inArray(projects.id, actor.projectIds),
        eq(projects.pmUserId, actor.id),
      )
    : eq(projects.pmUserId, actor.id);
  let rows = (
    await base().where(mineFilter).orderBy(asc(projects.code))
  ).filter((p) => !isProjectClosed(p.status));
  let scope: 'MINE' | 'ALL_OPEN' = 'MINE';
  if (rows.length === 0 && !isSiteScopedOnly(actor)) {
    rows = (await base().orderBy(asc(projects.code))).filter(
      (p) => !isProjectClosed(p.status),
    );
    scope = 'ALL_OPEN';
  }
  if (rows.length === 0) return { scope, projects: [] };

  const ids = rows.map((r) => r.id);
  const [taskRows, memberRows] = await Promise.all([
    db
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
      .where(inArray(projectTasks.projectId, ids)),
    db
      .select({
        projectId: projectMembers.projectId,
        id: users.id,
        name: users.name,
      })
      .from(projectMembers)
      .innerJoin(
        users,
        and(eq(users.id, projectMembers.userId), eq(users.active, true)),
      )
      .where(inArray(projectMembers.projectId, ids))
      .orderBy(asc(users.name)),
  ]);

  const tasksBy = new Map<string, ScheduleTask[]>();
  for (const t of taskRows) {
    const list = tasksBy.get(t.projectId) ?? [];
    list.push({ ...t, value: Number(t.value) });
    tasksBy.set(t.projectId, list);
  }
  const teamBy = new Map<string, { id: string; name: string }[]>();
  for (const m of memberRows) {
    const list = teamBy.get(m.projectId) ?? [];
    list.push({ id: m.id, name: m.name });
    teamBy.set(m.projectId, list);
  }

  return {
    scope,
    projects: rows.map((p) => {
      const leaves = leafTasks(tasksBy.get(p.id) ?? []);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        coverImageUrl: p.coverImageUrl,
        clientName: p.clientName,
        pmName: p.pmName,
        location: p.location,
        budget: can(actor, 'project.finance', { projectId: p.id })
          ? Number(p.budget)
          : null,
        progress: computeProjectProgress(tasksBy.get(p.id) ?? []),
        tasksDone: leaves.filter((t) => t.status === 'DONE').length,
        tasksTotal: leaves.length,
        team: teamBy.get(p.id) ?? [],
      };
    }),
  };
}
