import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { users, userRoles } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import {
  AuthConfigError,
  MIN_AUTH_SECRET_LENGTH,
  authenticate,
  resolveAuthSecret,
  signSessionToken,
  verifySessionToken,
} from '@/server/auth/session';

describe('auth', () => {
  test('authenticate rejects wrong password and inactive', async () => {
    const db = await createTestDb();
    const hash = await hashPassword('Secret123!');
    expect(await verifyPassword('Secret123!', hash)).toBe(true);
    expect(await verifyPassword('Wrong', hash)).toBe(false);

    const [u] = await db
      .insert(users)
      .values({
        email: 'test@ktec.local',
        name: 'ผู้ใช้งาน ทดสอบ',
        passwordHash: hash,
        active: true,
      })
      .returning();
    await db.insert(userRoles).values({ userId: u.id, role: 'PURCHASING' });

    expect(await authenticate(db, 'test@ktec.local', 'Wrong')).toBeNull();
    const ok = await authenticate(db, 'test@ktec.local', 'Secret123!');
    expect(ok).toMatchObject({
      id: u.id,
      email: 'test@ktec.local',
      roles: ['PURCHASING'],
    });

    await db.update(users).set({ active: false }).where(eq(users.id, u.id));
    expect(await authenticate(db, 'test@ktec.local', 'Secret123!')).toBeNull();
  });

  test('production requires a real AUTH_SECRET; dev/test fall back', () => {
    const strong = 'x'.repeat(MIN_AUTH_SECRET_LENGTH);
    expect(resolveAuthSecret({ AUTH_SECRET: ` ${strong} `, NODE_ENV: 'production' })).toBe(strong);
    expect(() => resolveAuthSecret({ NODE_ENV: 'production' })).toThrow(AuthConfigError);
    expect(() => resolveAuthSecret({ AUTH_SECRET: 'short', NODE_ENV: 'production' })).toThrow(AuthConfigError);
    expect(() =>
      resolveAuthSecret({ AUTH_SECRET: 'replace-with-at-least-32-character-secret-key', NODE_ENV: 'production' }),
    ).toThrow(AuthConfigError);
    // Unknown environment is treated like production
    expect(() => resolveAuthSecret({})).toThrow(AuthConfigError);
    expect(resolveAuthSecret({ NODE_ENV: 'development' })).toHaveLength(45);
    expect(resolveAuthSecret({ AUTH_SECRET: 'short', NODE_ENV: 'test' })).not.toBe('short');
  });

  test('tokens signed with one secret are rejected under another', async () => {
    const original = process.env.AUTH_SECRET;
    try {
      process.env.AUTH_SECRET = 'a'.repeat(40);
      const token = await signSessionToken('00000000-0000-4000-8000-000000000001');
      expect(await verifySessionToken(token)).toBe('00000000-0000-4000-8000-000000000001');
      process.env.AUTH_SECRET = 'b'.repeat(40);
      expect(await verifySessionToken(token)).toBeNull();
      expect(await verifySessionToken('not-a-jwt')).toBeNull();
    } finally {
      if (original === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = original;
    }
  });
});
