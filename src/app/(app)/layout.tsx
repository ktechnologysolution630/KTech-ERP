import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
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
  const [unreadCount, settings] = await Promise.all([countUnreadNotifications(db, user.id), getSettings(db)]);

  return (
    <AppShell user={user} unreadCount={unreadCount} companyName={settings.companyName}>
      {children}
    </AppShell>
  );
}
