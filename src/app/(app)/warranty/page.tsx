import { getDb } from '@/db/client';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listWarranties } from '@/server/services/handover';
import { WarrantyClient } from './warranty-client';

export default async function WarrantyPage() {
  const actor = await requireUser();
  const db = await getDb();
  const rows = await listWarranties(db, actor);
  return <WarrantyClient rows={rows} today={bangkokDateString()} canDelete={can(actor, 'data.delete')} />;
}
