import { eq } from 'drizzle-orm';
import { getDb, type Db } from './client';
import { runMigrations } from './migrate';
import { units, userRoles, users } from './schema';
import { hashPassword } from '@/server/auth/password';
import { getSettings } from '@/server/services/settings';

const DEFAULT_UNITS = ['ถุง', 'คิว', 'เส้น', 'ชิ้น', 'ตร.ม.', 'ม.', 'กก.', 'ตัน', 'ชุด', 'งาน'];

export async function runSeed(db: Db): Promise<void> {
  await getSettings(db);

  for (const name of DEFAULT_UNITS) {
    await db.insert(units).values({ name }).onConflictDoNothing();
  }

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@ktec.local').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin1234';

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId: string;
  if (existing.length === 0) {
    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: 'ผู้ดูแลระบบ / เจ้าของ',
        passwordHash,
        active: true,
      })
      .returning();
    userId = created.id;
  } else {
    userId = existing[0].id;
  }

  await db
    .insert(userRoles)
    .values([
      { userId, role: 'ADMIN' },
      { userId, role: 'OWNER' },
    ])
    .onConflictDoNothing();
}

if (require.main === module) {
  (async () => {
    const db = await getDb();
    await runMigrations(db);
    await runSeed(db);
    console.log('Seed complete');
    process.exit(0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
