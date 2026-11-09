'use server';

import { z } from 'zod';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listNotifications, markAllRead, markNotificationRead } from '@/server/services/notifications';

/** The signed-in user's latest notifications, for the header bell. */
export async function listMyNotificationsAction() {
  const actor = await requireUser();
  return listNotifications(await getDb(), actor);
}

export async function markMyNotificationReadAction(id: string): Promise<void> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return;
  const actor = await requireUser();
  await markNotificationRead(await getDb(), actor, parsed.data);
}

export async function markAllMyNotificationsReadAction(): Promise<void> {
  const actor = await requireUser();
  await markAllRead(await getDb(), actor);
}
