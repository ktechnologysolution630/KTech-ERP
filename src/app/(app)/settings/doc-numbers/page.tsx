import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { DOC_NUMBER_TYPES, listDocNumberStatus } from '@/server/services/doc-numbers';
import { listProjects } from '@/server/services/master';
import { DocNumbersClient } from './doc-numbers-client';

export default async function DocNumbersPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, 'settings.manage')) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        หน้านี้สำหรับผู้ดูแลระบบหรือเจ้าของเท่านั้น
      </div>
    );
  }
  const { project } = await searchParams;
  const db = await getDb();
  const projects = await listProjects(db, actor);
  const projectId = projects.some((p) => p.id === project) ? project! : null;
  const statuses = await listDocNumberStatus(db, actor, projectId);

  return (
    <DocNumbersClient
      statuses={statuses}
      types={DOC_NUMBER_TYPES.map((t) => ({ key: t.key, label: t.label }))}
      projects={projects.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
      projectId={projectId}
    />
  );
}
