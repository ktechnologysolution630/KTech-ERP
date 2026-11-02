import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { requireUser } from '@/server/auth/current-user';
import { AppShell } from '@/components/app-shell';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const db = await getDb();
  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));

  return (
    <AppShell user={user} unreadCount={unread.length}>
      {children}
    </AppShell>
  );
}
