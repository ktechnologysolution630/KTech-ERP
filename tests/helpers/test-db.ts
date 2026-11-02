import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { type Db } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';

let baseSnapshotPromise: Promise<Blob | File> | null = null;

async function getBaseSnapshot(): Promise<Blob | File> {
  if (!baseSnapshotPromise) {
    baseSnapshotPromise = (async () => {
      const client = new PGlite();
      await client.waitReady;
      const db = drizzle(client, { schema });
      await runMigrations(db);
      const dump = await client.dumpDataDir('none');
      await client.close();
      return dump;
    })();
  }
  return baseSnapshotPromise;
}

export async function createTestDb(): Promise<Db> {
  const dump = await getBaseSnapshot();
  const client = new PGlite({ loadDataDir: dump });
  await client.waitReady;
  return drizzle(client, { schema });
}
