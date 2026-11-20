import { getDb } from '@/db/client';
import { listCustomerOptions, listUserContactOptions } from '@/server/services/lookups';
import { getProjectBoqSheet } from '@/server/services/boq';
import { listProjectTasks } from '@/server/services/tasks';
import { listProjectVos } from '@/server/services/variation-orders';
import { countProjectSite } from '@/server/services/project-site';
import { getSettings } from '@/server/services/settings';
import { computeProjectProgress } from '@/domain/schedule';
import { bangkokDateString } from '@/domain/thai';
import { can } from '@/server/policy';
import { loadProjectOr404 } from './load-project';
import { ProjectWorkspaceClient, type WorkspaceTab } from './project-workspace-client';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

const OPENABLE_TABS: WorkspaceTab[] = ['overview', 'boq', 'vo', 'tasks', 'gantt', 'settings'];

export default async function ProjectWorkspacePage({ params, searchParams }: PageProps) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const initialTab = OPENABLE_TABS.includes(sp.tab as WorkspaceTab) ? (sp.tab as WorkspaceTab) : 'overview';
  const { actor, project } = await loadProjectOr404(id);
  const db = await getDb();

  // Run all queries in parallel for high-speed page loading
  const [allUsers, boqSheet, taskList, voList, customers, siteCounts, settings] = await Promise.all([
    listUserContactOptions(db),
    getProjectBoqSheet(db, actor, project.id),
    listProjectTasks(db, actor, project.id),
    listProjectVos(db, actor, project.id),
    listCustomerOptions(db),
    countProjectSite(db, project.id),
    getSettings(db),
  ]);

  return (
    <ProjectWorkspaceClient
      project={{ ...project, progress: computeProjectProgress(taskList.tasks) }}
      taskList={taskList}
      today={bangkokDateString()}
      initialTab={initialTab}
      voData={voList}
      customers={customers}
      me={actor.id}
      meName={actor.name}
      companyLogoUrl={settings.logoUrl ?? null}
      teamCount={siteCounts.team}
      photoCount={siteCounts.photos}
      allUsers={allUsers.map((u) => ({ id: u.id, name: u.name, email: u.email }))}
      initialBoq={boqSheet.boq}
      canEditBoq={boqSheet.canEdit}
      canDelete={can(actor, 'data.delete')}
    />
  );
}
