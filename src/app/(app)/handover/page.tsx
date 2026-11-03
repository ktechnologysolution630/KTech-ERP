import { getDb } from '@/db/client';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listHandovers } from '@/server/services/handover';
import { HandoverClient } from './handover-client';

export default async function HandoverPage() {
  const actor = await requireUser();
  const db = await getDb();
  const rows = await listHandovers(db, actor);
  return <HandoverClient rows={rows} today={bangkokDateString()} />;
}
