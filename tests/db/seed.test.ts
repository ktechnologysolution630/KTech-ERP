import { afterEach, describe, expect, test, vi } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { runSeed } from '@/db/seed';
import { authenticate } from '@/server/auth/session';

describe('seed admin account', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test('creates the admin with a trimmed password and only resets it when asked', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const db = await createTestDb();
    vi.stubEnv('SEED_ADMIN_EMAIL', ' Owner@Example.com ');
    // Pasted into a hosting dashboard with a trailing newline
    vi.stubEnv('SEED_ADMIN_PASSWORD', 'First#Pass1\n');
    await runSeed(db);
    expect(await authenticate(db, 'owner@example.com', 'First#Pass1')).toMatchObject({ email: 'owner@example.com' });

    // Changing the env alone does not touch an existing account
    vi.stubEnv('SEED_ADMIN_PASSWORD', 'Second#Pass2');
    await runSeed(db);
    expect(await authenticate(db, 'owner@example.com', 'Second#Pass2')).toBeNull();
    expect(await authenticate(db, 'owner@example.com', 'First#Pass1')).not.toBeNull();

    // The explicit recovery flag re-applies it
    vi.stubEnv('SEED_ADMIN_RESET_PASSWORD', 'true');
    await runSeed(db);
    expect(await authenticate(db, 'owner@example.com', 'Second#Pass2')).not.toBeNull();
    expect(await authenticate(db, 'owner@example.com', 'First#Pass1')).toBeNull();
  });
});
