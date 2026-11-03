import { getDb } from '@/db/client';
import { listVendors } from '@/server/services/master';
import { listPrs } from '@/server/services/pr';
import { listPos } from '@/server/services/po';
import { getPrvs } from '@/server/services/prv';
import { listCustomerOptions, listUserContactOptions } from '@/server/services/lookups';
import { getProjectBoqSheet } from '@/server/services/boq';
import { listProjectTasks } from '@/server/services/tasks';
import { listProjectVos } from '@/server/services/variation-orders';
import { computeProjectProgress } from '@/domain/schedule';
import { bangkokDateString } from '@/domain/thai';
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
  const [allPrs, allPos, allPrvs, allVendors, allUsers, boqSheet, taskList, voList, customers] = await Promise.all([
    listPrs(db, actor, {}),
    listPos(db, actor, {}),
    getPrvs(db),
    listVendors(db),
    listUserContactOptions(db),
    getProjectBoqSheet(db, actor, project.id),
    listProjectTasks(db, actor, project.id),
    listProjectVos(db, actor, project.id),
    listCustomerOptions(db),
  ]);

  // Filter linked records for this project
  const projectPrs = allPrs.filter((pr) => pr.projectId === project.id);
  const projectPos = allPos.filter((po) => po.projectId === project.id);
  const projectPrvs = allPrvs.filter((prv) => prv.projectId === project.id);

  return (
    <ProjectWorkspaceClient
      project={{ ...project, progress: computeProjectProgress(taskList.tasks) }}
      taskList={taskList}
      today={bangkokDateString()}
      initialTab={initialTab}
      voData={voList}
      customers={customers}
      initialPrs={projectPrs.map((pr) => ({
        id: pr.id,
        number: pr.number,
        title: pr.note || `ใบขอซื้อ ${pr.number}`,
        status: pr.status,
        totalAmount: 0,
        createdAt: pr.createdAt.toISOString(),
      }))}
      initialPos={projectPos.map((po) => ({
        id: po.id,
        number: po.number,
        vendorName: po.vendorName,
        status: po.status,
        gross: Number(po.gross || 0),
        deliveryDate: po.createdAt ? po.createdAt.toISOString().split('T')[0] : null,
      }))}
      initialPrvs={projectPrvs.map((prv) => ({
        id: prv.id,
        prvNumber: prv.prvNumber,
        title: `ใบสั่งจ่าย ${prv.prvNumber}`,
        vendorName: prv.vendorName || '-',
        category: prv.category,
        totalAmount: Number(prv.totalAmount || 0),
        status: prv.status,
        dueDate: prv.date || null,
      }))}
      allVendors={allVendors.map((v) => ({ id: v.id, name: v.name, code: v.code }))}
      allUsers={allUsers.map((u) => ({ id: u.id, name: u.name, email: u.email }))}
      initialBoq={boqSheet.boq}
      canEditBoq={boqSheet.canEdit}
    />
  );
}
