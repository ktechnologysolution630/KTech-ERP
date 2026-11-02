import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

export async function createDb(url: string): Promise<Db> {
  if (url.startsWith('pglite:')) {
    const target = url.slice('pglite:'.length);
    const client = target === 'memory' || target === '' ? new PGlite() : new PGlite(target);
    await client.waitReady;
    return drizzlePglite(client, { schema });
  }
  const pool = new Pool({ connectionString: url });
  return drizzleNodePg(pool, { schema });
}

let singletonPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!singletonPromise) {
    const url = process.env.DATABASE_URL || 'pglite:./.pglite';
    singletonPromise = createDb(url);
  }
  return singletonPromise;
}
