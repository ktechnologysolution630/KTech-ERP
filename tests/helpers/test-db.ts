import { createDb, type Db } from '@/db/client';
import { runMigrations } from '@/db/migrate';

export async function createTestDb(): Promise<Db> {
  const db = await createDb('pglite:memory');
  await runMigrations(db);
  return db;
}
