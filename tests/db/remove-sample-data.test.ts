import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { boqs, prs, projects, prvs, stockBalances, stockItems, stockMovements, users, vendors } from '@/db/schema';
import { runSeed } from '@/db/seed';
import { createTestDb } from '../helpers/test-db';

const PROJECT_NAME = 'โครงการก่อสร้างอาคารสำนักงานใหญ่ K-Tec (พระราม 9)';
const CONTRACTOR = 'หจก. ช่างวิเชียร งานก่อสร้าง (ผู้รับเหมาฐานราก)';
const ITEMS = [
  ['MAT-6901', 'ปูนซีเมนต์ปอร์ตแลนด์ ตราช้าง (ถุง 50 กก.)', '150.000'],
  ['MAT-6902', 'เหล็กข้ออ้อย DB16 SD40 (ยาว 10 ม.)', '25.000'],
  ['MAT-6903', 'อิฐมวลเบา Q-CON ขนาด 7.5 ซม.', '150.000'],
  ['MAT-6904', 'แผ่นตัดเหล็ก 14 นิ้ว (ดูโฮม Code: 10389197)', '150.000'],
  ['MAT-6905', 'ถุงขยะดำ ขนาด 30x40 นิ้ว (ดูโฮม Code: 10418187)', '150.000'],
] as const;

/** What older versions of the seed left in a database */
async function insertOldSample(db: Db) {
  const [user] = await db.insert(users).values({ email: 'old@ktec.local', name: 'แอดมินเดิม', passwordHash: 'x' }).returning();
  const [project] = await db.insert(projects).values({ code: 'K69-001', name: PROJECT_NAME }).returning();
  const itemIds: Record<string, string> = {};
  for (const [sku, name, quantity] of ITEMS) {
    const [item] = await db.insert(stockItems).values({ sku, name }).returning();
    itemIds[sku] = item!.id;
    await db.insert(stockBalances).values({ stockItemId: item!.id, projectId: project!.id, warehouseName: 'คลังหน้างาน พระราม 9', location: 'โซนจัดเก็บ A1', quantity });
    await db.insert(stockMovements).values({
      movementNumber: `SM-2611-${sku.slice(-4)}`,
      stockItemId: item!.id,
      projectId: project!.id,
      type: 'RECEIVE',
      quantity,
      referenceType: 'MANUAL',
      performedBy: user!.id,
      notes: 'ยอดยกมาเริ่มต้นคลังสินค้า',
    });
  }
  const [vendor] = await db.insert(vendors).values({ code: 'CONT-0001', name: CONTRACTOR, type: 'INDIVIDUAL' }).returning();
  await db.insert(prvs).values({
    prvNumber: 'PRV-2611-0001',
    date: '2026-11-01',
    projectId: project!.id,
    vendorId: vendor!.id,
    payeeName: CONTRACTOR,
    totalAmount: '100000.00',
    netAmount: '92150.00',
    status: 'PM_VERIFIED',
    requestedBy: user!.id,
    notes: 'ขอเบิกงวดที่ 1 ผลงานเทเสาเข็มและคานคอดินอาคารสำนักงานแล้วเสร็จ 100%',
  });
  return { userId: user!.id, projectId: project!.id, vendorId: vendor!.id, itemIds };
}

/** Runs the migration again, as a database with these rows would at deploy time */
async function runMigration(db: Db) {
  const file = readFileSync(path.resolve(process.cwd(), 'drizzle/0028_remove_sample_data.sql'), 'utf8');
  for (const statement of file.split('--> statement-breakpoint')) await db.execute(sql.raw(statement));
}

describe('removing the sample data', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test('the seed no longer creates any', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const db = await createTestDb();
    await runSeed(db);
    await runSeed(db);
    expect(await db.select().from(projects)).toEqual([]);
    expect(await db.select().from(stockItems)).toEqual([]);
    expect(await db.select().from(vendors)).toEqual([]);
    expect(await db.select().from(prvs)).toEqual([]);
    expect((await db.select().from(users)).length).toBe(1);
  });

  test('an untouched sample is removed completely, and real data around it stays', async () => {
    const db = await createTestDb();
    const { userId } = await insertOldSample(db);
    const [real] = await db.insert(projects).values({ code: 'K69-002', name: 'โครงการจริง' }).returning();
    await db.insert(stockItems).values({ sku: 'REAL-1', name: 'ของจริง' });
    await db.insert(vendors).values({ code: 'V-1', name: 'ผู้ขายจริง', type: 'COMPANY' });

    await runMigration(db);

    expect((await db.select().from(projects)).map((p) => p.id)).toEqual([real!.id]);
    expect((await db.select().from(stockItems)).map((i) => i.sku)).toEqual(['REAL-1']);
    expect((await db.select().from(vendors)).map((v) => v.code)).toEqual(['V-1']);
    expect(await db.select().from(prvs)).toEqual([]);
    expect(await db.select().from(stockMovements)).toEqual([]);
    expect(await db.select().from(stockBalances)).toEqual([]);
    expect((await db.select().from(users).where(eq(users.id, userId))).length).toBe(1);
  });

  test('anything people have used or changed is left alone', async () => {
    const db = await createTestDb();
    const { userId, projectId, vendorId, itemIds } = await insertOldSample(db);

    // Work on the project, stock taken out of one item, and a second claim for the contractor
    await db.insert(boqs).values({ projectId, number: 'BOQ-REAL', createdBy: userId, updatedBy: userId });
    await db.insert(stockMovements).values({ movementNumber: 'SM-REAL', stockItemId: itemIds['MAT-6901']!, projectId, type: 'ISSUE', quantity: '5.000', performedBy: userId });
    await db.update(stockBalances).set({ quantity: '145.000' }).where(eq(stockBalances.stockItemId, itemIds['MAT-6901']!));
    await db.insert(prvs).values({ prvNumber: 'PRV-REAL', date: '2026-11-01', projectId, vendorId, payeeName: CONTRACTOR, totalAmount: '1.00', netAmount: '1.00', requestedBy: userId });
    // A real item that happens to use one of the sample codes
    await db.update(stockItems).set({ name: 'ของที่เปลี่ยนชื่อแล้ว' }).where(eq(stockItems.id, itemIds['MAT-6903']!));
    // A real purchase request keeps the project too
    await db.insert(prs).values({ number: 'PR-REAL', projectId, requestedBy: userId });

    await runMigration(db);

    expect((await db.select().from(projects)).map((p) => p.code)).toEqual(['K69-001']);
    expect((await db.select().from(vendors)).map((v) => v.code)).toEqual(['CONT-0001']);
    expect((await db.select().from(prvs)).map((p) => p.prvNumber)).toEqual(['PRV-REAL']);
    expect((await db.select().from(stockItems)).map((i) => i.sku).sort()).toEqual(['MAT-6901', 'MAT-6903']);
    expect((await db.select().from(stockMovements)).map((m) => m.movementNumber).sort()).toEqual(['SM-2611-6901', 'SM-2611-6903', 'SM-REAL']);
    expect((await db.select().from(stockBalances)).map((b) => b.quantity).sort()).toEqual(['145.000', '150.000']);

    // Running twice changes nothing more and does not fail
    await runMigration(db);
    expect((await db.select().from(stockItems)).length).toBe(2);
  });
});
