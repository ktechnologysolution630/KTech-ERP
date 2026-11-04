import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listPendingApprovals } from '@/server/services/approvals';
import { ApprovalsClient } from './approvals-client';

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const [actor, db, sp] = await Promise.all([requireUser(), getDb(), searchParams]);
  const items = await listPendingApprovals(db, actor);
  return <ApprovalsClient items={items} projectKey={sp.project ?? null} />;
}
