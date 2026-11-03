import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listProjectOptions, listVendorOptions } from '@/server/services/lookups';
import { PrvFormClient } from './prv-form-client';

export default async function NewPrvPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const [actor, sp] = await Promise.all([requireUser(), searchParams]);
  const db = await getDb();
  const [allProjects, allVendors] = await Promise.all([listProjectOptions(db), listVendorOptions(db)]);
  const projects = allProjects.filter((p) => can(actor, 'prv.create', { projectId: p.id }));
  return (
    <PrvFormClient
      initialProjectId={projects.some((p) => p.id === sp.projectId) ? sp.projectId : undefined}
      projects={projects}
      vendors={allVendors.sort((a, b) => a.name.localeCompare(b.name, 'th'))}
    />
  );
}
