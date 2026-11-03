import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { type Db } from '@/db/client';
import { projectMembers, userRoles, users, type SessionUser } from '@/db/schema';
import { verifyPassword } from './password';

export type { SessionUser };

export const SESSION_COOKIE_NAME = 'ktec_session';

export const MIN_AUTH_SECRET_LENGTH = 32;
const PLACEHOLDER_SECRET = 'replace-with-at-least-32-character-secret-key';
// Only for local development and tests; production refuses to run without a real secret
const DEV_ONLY_SECRET = 'dev-secret-change-in-production-ktec-erp-2026';

/** AUTH_SECRET is missing, too short or still the .env.example placeholder in production. */
export class AuthConfigError extends Error {
  constructor() {
    super(
      `AUTH_SECRET must be set to a random value of at least ${MIN_AUTH_SECRET_LENGTH} characters ` +
        '(e.g. `openssl rand -base64 48`); sessions cannot be signed or verified without it.',
    );
    this.name = 'AuthConfigError';
  }
}

/**
 * Resolves the session signing secret. A known fallback secret would let anyone forge a session
 * cookie for any user, so outside development/test a proper AUTH_SECRET is mandatory.
 */
export function resolveAuthSecret(env: { AUTH_SECRET?: string; NODE_ENV?: string } = process.env): string {
  const secret = env.AUTH_SECRET?.trim() ?? '';
  if (secret.length >= MIN_AUTH_SECRET_LENGTH && secret !== PLACEHOLDER_SECRET) return secret;
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return DEV_ONLY_SECRET;
  throw new AuthConfigError();
}

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(resolveAuthSecret());
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
  const key = getSecretKey();
  try {
    const { payload } = await jwtVerify(token, key);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    // Invalid, expired or tampered token: treat as signed out
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
