import path from 'path';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { type Db, getDb } from './client';

export async function runMigrations(db: Db): Promise<void> {
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  // PGlite vs node-postgres migrator dispatch
  if ('$client' in db && db.$client && 'waitReady' in (db.$client as object)) {
    await migratePglite(db as Parameters<typeof migratePglite>[0], { migrationsFolder });
  } else {
    await migrateNodePg(db as Parameters<typeof migrateNodePg>[0], { migrationsFolder });
  }
}

if (require.main === module) {
  (async () => {
    const db = await getDb();
    await runMigrations(db);
    console.log('Migrations complete');
    process.exit(0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
