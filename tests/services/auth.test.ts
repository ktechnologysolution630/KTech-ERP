import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { users, userRoles } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { authenticate } from '@/server/auth/session';

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
});
