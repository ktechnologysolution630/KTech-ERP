import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { isApprover, listPendingApprovals } from '@/server/services/approvals';
import { checkAssetsDueOncePerDay } from '@/server/services/assets';
import { countUnreadNotifications } from '@/server/services/notifications';
import { getSettings } from '@/server/services/settings';
import { AppShell } from '@/components/app-shell';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const db = await getDb();
  await checkAssetsDueOncePerDay(db);
  const showApprovals = isApprover(user);
  const [unreadCount, settings, pendingApprovals] = await Promise.all([
    countUnreadNotifications(db, user.id),
    getSettings(db),
    showApprovals ? listPendingApprovals(db, user) : [],
  ]);

  return (
    <AppShell user={user} unreadCount={unreadCount} companyName={settings.companyName} pendingApprovalCount={showApprovals ? pendingApprovals.length : null}>
      {children}
    </AppShell>
  );
}
