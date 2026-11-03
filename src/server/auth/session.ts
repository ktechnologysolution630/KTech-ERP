import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { type Db } from '@/db/client';
import { projectMembers, userRoles, users, type SessionUser } from '@/db/schema';
import { verifyPassword } from './password';

export type { SessionUser };

export const SESSION_COOKIE_NAME = 'ktec_session';

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'dev-secret-change-in-production-ktec-erp-2026';
  return new TextEncoder().encode(secret);
}

export async function loadSessionUserById(db: Db, userId: string): Promise<SessionUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.active) return null;

  const [rolesRows, memberRows] = await Promise.all([
    db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, user.id)),
    db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, user.id)),
  ]);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roles: rolesRows.map((r) => r.role),
    projectIds: memberRows.map((m) => m.projectId),
  };
}

export async function authenticate(
  db: Db,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const cleanEmail = email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
  if (!user || !user.active) return null;

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;

  return loadSessionUserById(db, user.id);
}

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function createSessionCookie(userId: string): Promise<void> {
  const token = await signSessionToken(userId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
