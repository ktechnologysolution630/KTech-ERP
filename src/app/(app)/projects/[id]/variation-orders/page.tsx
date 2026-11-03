import { getDb } from '@/db/client';
import { listProjectVos } from '@/server/services/variation-orders';
import { ProjectVoView } from '@/components/project-vo-view';
import { loadProjectOr404 } from '../load-project';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectVariationOrdersPage({ params }: PageProps) {
  const { id } = await params;
  const { actor, project } = await loadProjectOr404(id);
  const db = await getDb();
  const data = await listProjectVos(db, actor, project.id);

  return (
    <div className="space-y-4">
      <ProjectVoView data={data} location={project.location} />
    </div>
  );
}
