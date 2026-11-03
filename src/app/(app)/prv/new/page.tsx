import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listProjectOptions, listVendorOptions } from '@/server/services/lookups';
import { PrvFormClient } from './prv-form-client';

export default async function NewPrvPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [allProjects, allVendors] = await Promise.all([listProjectOptions(db), listVendorOptions(db)]);
  return (
    <PrvFormClient
      projects={allProjects.filter((p) => can(actor, 'prv.create', { projectId: p.id }))}
      vendors={allVendors.sort((a, b) => a.name.localeCompare(b.name, 'th'))}
    />
  );
}
