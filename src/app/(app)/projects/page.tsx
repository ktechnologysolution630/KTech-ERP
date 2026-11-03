import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listProjects } from '@/server/services/master';
import { ProjectsClient } from './projects-client';

export default async function ProjectsPage() {
  const actor = await requireUser();
  const db = await getDb();
  const projects = await listProjects(db, actor);

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
        startDate: p.startDate,
        endDate: p.endDate,
        createdAt: p.createdAt,
      }))}
    />
  );
}
