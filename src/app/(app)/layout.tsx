import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { countUnreadNotifications } from '@/server/services/notifications';
import { AppShell } from '@/components/app-shell';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const db = await getDb();
  const unreadCount = await countUnreadNotifications(db, user.id);

  return (
    <AppShell user={user} unreadCount={unreadCount}>
      {children}
    </AppShell>
  );
}
