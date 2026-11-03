import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listPoOptions, listProjectOptions, listVendorOptions } from '@/server/services/lookups';
import { PrvFormClient } from './prv-form-client';

export default async function NewPrvPage() {
  await requireUser();

  const db = await getDb();
  const allProjects = await listProjectOptions(db);
  const allVendors = await listVendorOptions(db);
  const rawPos = await listPoOptions(db);

  const cleanPos = rawPos.map((p) => ({
    id: p.id,
    number: p.number,
    projectId: p.projectId || '',
    vendorId: p.vendorId,
    total: p.gross,
  }));

  return (
    <PrvFormClient
      projects={allProjects}
      vendors={allVendors}
      pos={cleanPos}
    />
  );
}
