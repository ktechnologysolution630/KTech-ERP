import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
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

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(loginUrlFor((await headers()).get(RETURN_PATH_HEADER)));
  }
  return user;
}
