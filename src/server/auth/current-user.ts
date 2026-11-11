import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { isViewOnlyRequest, VIEW_ONLY_COOKIE, VIEW_ONLY_PATH } from '@/domain/view-only-device';
import { loginUrlFor, RETURN_PATH_HEADER } from '@/lib/return-path';
import {
  loadSessionUserById,
  SESSION_COOKIE_NAME,
  verifySessionToken,
  type SessionUser,
} from './session';

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const userId = await verifySessionToken(token);
  if (!userId) return null;

  const db = await getDb();
  return loadSessionUserById(db, userId);
});

/** For pages and for actions that only read. Anything that writes asks `requireWriter` instead. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(loginUrlFor((await headers()).get(RETURN_PATH_HEADER)));
  }
  return user;
}

/** Whether this request comes from an iPhone or iPad, which may only look at documents */
export async function isViewOnlyDevice(): Promise<boolean> {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  return isViewOnlyRequest(headerList.get('user-agent'), cookieStore.get(VIEW_ONLY_COOKIE)?.value);
}

/**
 * The signed-in user, for an action that creates, changes, approves or deletes something. On an
 * iPhone or iPad nothing is written: the person is taken to the page that says so. Call it outside
 * any `try`, as with every redirect.
 */
export async function requireWriter(): Promise<SessionUser> {
  const user = await requireUser();
  if (await isViewOnlyDevice()) redirect(VIEW_ONLY_PATH);
  return user;
}
