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
    if (target !== 'memory' && target !== '') closeOnExit(client);
    return drizzlePglite(client, { schema });
  }
  const pool = new Pool({ connectionString: url });
  return drizzleNodePg(pool, { schema });
}

/**
 * A file-backed PGlite must be the only writer of its directory and must be closed cleanly:
 * a second instance on the same folder, or a process killed mid-write, corrupts it.
 */
function closeOnExit(client: PGlite) {
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void client.close().catch(() => undefined);
  };
  process.once('beforeExit', close);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      close();
      // Give PGlite a moment to flush, then let the default exit behaviour continue
      setTimeout(() => process.exit(0), 300).unref();
    });
  }
}

// Kept on globalThis so Next.js dev hot reloads reuse one connection instead of
// opening another PGlite on the same data directory (which corrupts it).
const globalForDb = globalThis as unknown as { __ktecDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__ktecDb) {
    const url = process.env.DATABASE_URL || 'pglite:./.pglite';
    globalForDb.__ktecDb = createDb(url).catch((err: unknown) => {
      // Do not cache a failed open; the next request may succeed
      globalForDb.__ktecDb = undefined;
      throw err;
    });
  }
  return globalForDb.__ktecDb;
}
