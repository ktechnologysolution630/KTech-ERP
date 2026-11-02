import { and, desc, eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { activityLogs, users, type EntityType } from '@/db/schema';

export async function logActivity(
  tx: Db,
  entry: {
    entityType: EntityType;
    entityId: string;
    action: string;
    userId: string;
    note?: string;
    data?: unknown;
  },
): Promise<void> {
  await tx.insert(activityLogs).values({
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    userId: entry.userId,
    note: entry.note ?? null,
    data: entry.data ?? null,
  });
}

export async function listActivity(
  db: Db,
  entityType: EntityType,
  entityId: string,
) {
  return db
    .select({
      id: activityLogs.id,
      entityType: activityLogs.entityType,
      entityId: activityLogs.entityId,
      action: activityLogs.action,
      userId: activityLogs.userId,
      userName: users.name,
      note: activityLogs.note,
      data: activityLogs.data,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .innerJoin(users, eq(users.id, activityLogs.userId))
    .where(and(eq(activityLogs.entityType, entityType), eq(activityLogs.entityId, entityId)))
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id));
}
