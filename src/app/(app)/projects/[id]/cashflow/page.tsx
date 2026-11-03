import { ProjectCashflowView } from '@/components/project-cashflow-view';
import { loadProjectOr404 } from '../load-project';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectCashflowPage({ params }: PageProps) {
  const { id } = await params;
  const { project } = await loadProjectOr404(id);

  return (
    <div className="space-y-4">
      <ProjectCashflowView
        projectId={project.id}
        projectCode={project.code}
        projectName={project.name}
      />
    </div>
  );
}
