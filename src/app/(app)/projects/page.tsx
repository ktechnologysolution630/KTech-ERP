import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listProjectProgress, listProjects } from '@/server/services/master';
import { ProjectsClient } from './projects-client';

export default async function ProjectsPage() {
  const actor = await requireUser();
  const db = await getDb();
  const projects = await listProjects(db, actor);
  const progressByProject = await listProjectProgress(
    db,
    projects.map((p) => p.id),
  );

  return (
    <ProjectsClient
      canCreate={can(actor, 'master.manage')}
      initialProjects={projects.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        clientName: p.clientName,
        location: p.location,
        budget: Number(p.budget),
        progress: progressByProject.get(p.id) ?? 0,
        startDate: p.startDate,
        endDate: p.endDate,
        createdAt: p.createdAt,
      }))}
    />
  );
}
