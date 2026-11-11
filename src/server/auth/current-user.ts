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

/**
 * The signed-in user, for the vehicle menu only: drivers take vehicles out, send their position and
 * bring them back from a phone too. Every other action that writes asks `requireWriter`.
 */
export async function requireUserOnAnyDevice(): Promise<SessionUser> {
  return requireUser();
}

/**
 * The signed-in user, for an action that approves or refuses a document. Phones and tablets may do
 * this (terms of use): approving is the one thing they are for besides looking. An action that also
 * creates or changes something must keep that part behind `requireWriter`.
 */
export async function requireDecider(): Promise<SessionUser> {
  return requireUser();
}

/** Whether this request comes from a phone or tablet, which may only look and approve */
export async function isViewOnlyDevice(): Promise<boolean> {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  return isViewOnlyRequest(headerList.get('user-agent'), cookieStore.get(VIEW_ONLY_COOKIE)?.value);
}

/**
 * The signed-in user, for an action that creates, changes or deletes something. On a phone or tablet
 * nothing is written: the person is taken to the page that says so, and does it on a computer. Call
 * it outside any `try`, as with every redirect.
 */
export async function requireWriter(): Promise<SessionUser> {
  const user = await requireUser();
  if (await isViewOnlyDevice()) redirect(VIEW_ONLY_PATH);
  return user;
}
