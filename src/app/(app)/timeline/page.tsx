import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjectTimeline } from '@/server/services/timeline';
import { TimelineClient } from './timeline-client';

export default async function TimelinePage() {
  const actor = await requireUser();
  const db = await getDb();
  const { today, rows } = await listProjectTimeline(db, actor);
  return <TimelineClient today={today} rows={rows} />;
}
