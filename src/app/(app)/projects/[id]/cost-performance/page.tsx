import { formatThaiDate } from '@/domain/thai';
import { ProjectCostPerformanceView } from '@/components/project-cost-performance-view';
import { loadProjectOr404 } from '../load-project';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectCostPerformancePage({ params }: PageProps) {
  const { id } = await params;
  const { project } = await loadProjectOr404(id);

  return (
    <div className="space-y-4">
      <ProjectCostPerformanceView
        projectId={project.id}
        projectCode={project.code}
        projectName={project.name}
        location={project.location || '-'}
        budget={project.budget.toLocaleString('th-TH')}
        startDate={project.startDate ? formatThaiDate(project.startDate) : '-'}
        endDate={project.endDate ? formatThaiDate(project.endDate) : '-'}
        projectManager={project.pmName ?? '-'}
      />
    </div>
  );
}
