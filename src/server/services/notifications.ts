import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  notifications,
  projectMembers,
  userRoles,
  users,
  type Role,
  type SessionUser,
} from '@/db/schema';

const SITE_ROLES: Role[] = ['FOREMAN', 'ENGINEER', 'ARCHITECT', 'PM'];

export async function notify(
  tx: Db,
  userIds: string[],
  n: { title: string; href: string },
): Promise<void> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;
  await tx.insert(notifications).values(
    uniqueIds.map((userId) => ({
      userId,
      title: n.title,
      href: n.href,
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

export async function listNotifications(db: Db, actor: SessionUser) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, actor.id))
    .orderBy(desc(notifications.createdAt))
    .limit(30);
}

export async function markAllRead(db: Db, actor: SessionUser) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
}
