import fs from 'fs';
import path from 'path';
import { SignJWT } from 'jose';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { eq } from 'drizzle-orm';

// Read AUTH_SECRET from .env file directly
let authSecret = 'ktec-procurement-secret-key-32-chars-minimum';
try {
  const envContent = fs.readFileSync(path.resolve('.env'), 'utf-8');
  const match = envContent.match(/AUTH_SECRET=([^\r\n]+)/);
  if (match) {
    authSecret = match[1].trim();
  }
} catch (e) {
  // ignore
}

async function generateTestToken() {
  const db = await getDb();
  const [admin] = await db.select().from(users).where(eq(users.email, 'admin@ktec.local')).limit(1);
  if (!admin) {
    throw new Error('Admin user not found');
  }

  const secret = new TextEncoder().encode(authSecret);
  const token = await new SignJWT({ sub: admin.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);

  return token;
}

const routesToTest = [
  // Workspace
  '/inbox',
  '/dashboard',

  // Projects & Timeline
  '/master/projects',
  '/projects',
  '/projects/00000000-0000-4000-8000-000000000001',
  '/timeline',

  // Stock (all 6 tabs)
  '/stock?tab=overview',
  '/stock?tab=movements',
  '/stock?tab=low-stock',
  '/stock?tab=issues',
  '/stock?tab=material-usage',
  '/stock?tab=all-stock',

  // Purchasing
  '/purchasing',
  '/pr',
  '/po',
  '/purchasing/approve',
  '/purchasing/ap',
  '/purchasing/vendors',
  '/receive',

  // Labor & Payments
  '/labor-payments?tab=payment-milestones',
  '/labor-payments?tab=receive-milestones',
  '/labor-payments?tab=milestones',
  '/labor-payments/contractors',
  '/prv',
  '/payables',

  // Accounting & Finance
  '/invoices',
  '/pv',
  '/exports',

  // After Service
  '/handover',
  '/warranty',

  // Master & Settings
  '/master/users',
  '/billing',
  '/settings',
  '/design-showcase',
];

async function main() {
  const token = await generateTestToken();
  const cookie = `ktec_session=${token}`;

  console.log(`Using authSecret: ${authSecret}`);
  console.log(`Testing ${routesToTest.length} routes with auth on http://localhost:3000 (redirect: 'manual') ...\n`);

  let passed = 0;
  let failed = 0;

  for (const route of routesToTest) {
    const url = `http://localhost:3000${route}`;
    try {
      const res = await fetch(url, {
        headers: {
          Cookie: cookie,
        },
        redirect: 'manual', // do NOT follow redirect - must be 200 OK directly!
      });

      if (res.status === 200) {
        console.log(`✅ [200 OK] ${route}`);
        passed++;
      } else {
        const location = res.headers.get('location') || '';
        console.error(`❌ [${res.status} ${location}] ${route}`);
        failed++;
      }
    } catch (err) {
      console.error(`❌ [ERROR] ${route} -> ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\n================================`);
  console.log(`Total: ${routesToTest.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
