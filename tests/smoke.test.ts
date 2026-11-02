import { expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb } from './helpers/test-db';

test('test db runs migrations and answers', async () => {
  const db = await createTestDb();
  const r = await db.execute(sql`select 1 as ok`);
  expect(r.rows[0].ok).toBe(1);
});
