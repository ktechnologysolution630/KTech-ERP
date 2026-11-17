import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { countPendingApprovals, isApprover } from '@/server/services/approvals';
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
  // The approval count is not awaited: the page is sent first and the number streams in after it
  const pendingApprovals = isApprover(user) ? countPendingApprovals(db, user).catch(() => 0) : null;
  const [unreadCount, settings] = await Promise.all([countUnreadNotifications(db, user.id), getSettings(db)]);

  return (
    <AppShell
      user={user}
      unreadCount={unreadCount}
      companyName={settings.companyName}
      pendingApprovalCount={pendingApprovals}
      canManageUsers={can(user, 'users.manage')}
      canManageSettings={can(user, 'settings.manage')}
    >
      {children}
    </AppShell>
  );
}
