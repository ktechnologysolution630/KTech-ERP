import { and, desc, eq, isNull, inArray } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  notifications,
  projectMembers,
  userRoles,
  users,
  type NotificationCategory,
  type NotificationLevel,
  type Role,
  type SessionUser,
} from '@/db/schema';

const SITE_ROLES: Role[] = ['FOREMAN', 'ENGINEER', 'ARCHITECT', 'PROJECT_CLERK', 'PM'];

export interface NotificationInput {
  title: string;
  href: string;
  category?: NotificationCategory;
  level?: NotificationLevel;
  projectId?: string | null;
}

export async function notify(tx: Db, userIds: string[], n: NotificationInput): Promise<void> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;
  await tx.insert(notifications).values(
    uniqueIds.map((userId) => ({
      userId,
      title: n.title,
      href: n.href,
      category: n.category ?? 'GENERAL',
      level: n.level ?? 'INFO',
      projectId: n.projectId ?? null,
    })),
  );
}

export async function usersWithRole(
  tx: Db,
  roles: Role[],
  projectId?: string | null,
): Promise<string[]> {
  if (roles.length === 0) return [];
  const roleRows = await tx
    .select({ userId: userRoles.userId, role: userRoles.role })
    .from(userRoles)
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.active, true)))
    .where(inArray(userRoles.role, roles));

  if (!projectId) {
    return Array.from(new Set(roleRows.map((r) => r.userId)));
  }

  const members = await tx
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  const memberSet = new Set(members.map((m) => m.userId));

  const matched = roleRows.filter((r) => {
    if (SITE_ROLES.includes(r.role)) {
      return memberSet.has(r.userId);
    }
    return true;
  });

  return Array.from(new Set(matched.map((r) => r.userId)));
}

export async function countUnreadNotifications(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows.length;
}

export async function listNotifications(db: Db, actor: SessionUser, category?: NotificationCategory) {
  return db
    .select({
      id: notifications.id,
      title: notifications.title,
      href: notifications.href,
      category: notifications.category,
      level: notifications.level,
      projectId: notifications.projectId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, actor.id),
        category ? eq(notifications.category, category) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(category ? 30 : 50);
}

export async function markAllRead(db: Db, actor: SessionUser) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
}
