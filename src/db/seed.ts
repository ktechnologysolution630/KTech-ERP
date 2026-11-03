import { eq } from 'drizzle-orm';
import { getDb, type Db } from './client';
import { runMigrations } from './migrate';
import {
  units,
  userRoles,
  users,
  projects,
  stockItems,
  stockBalances,
  stockMovements,
  prvs,
  vendors,
} from './schema';
import { hashPassword } from '@/server/auth/password';
import { getSettings } from '@/server/services/settings';

const DEFAULT_UNITS = ['ถุง', 'คิว', 'เส้น', 'ชิ้น', 'ตร.ม.', 'ม.', 'กก.', 'ตัน', 'ชุด', 'งาน'];

export async function runSeed(db: Db): Promise<void> {
  await getSettings(db);

  for (const name of DEFAULT_UNITS) {
    await db.insert(units).values({ name }).onConflictDoNothing();
  }

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@ktec.local').trim().toLowerCase();
  // Hosting dashboards often keep a trailing newline/space from copy-paste; it would silently
  // become part of the password
  const password = (process.env.SEED_ADMIN_PASSWORD || 'admin1234').trim();
  if (!process.env.SEED_ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
    console.warn('seed: SEED_ADMIN_PASSWORD is not set; using the default password');
  }

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
    console.log(`seed: created admin ${email}`);
  } else {
    userId = existing[0].id;
    // Opt-in recovery: re-applies SEED_ADMIN_PASSWORD to an existing admin. Remove the flag
    // afterwards, or every deploy will overwrite a password changed in the app.
    if (process.env.SEED_ADMIN_RESET_PASSWORD === 'true') {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(password), active: true })
        .where(eq(users.id, userId));
      console.log(`seed: reset password for existing admin ${email}`);
    } else {
      console.log(`seed: admin ${email} already exists; password unchanged`);
    }
  }

  await db
    .insert(userRoles)
    .values([
      { userId, role: 'ADMIN' },
      { userId, role: 'OWNER' },
    ])
    .onConflictDoNothing();

  // Seed sample construction project if none
  const existingProjects = await db.select().from(projects).limit(1);
  let sampleProjectId: string;
  if (existingProjects.length === 0) {
    const [createdPrj] = await db
      .insert(projects)
      .values({
        code: 'K69-001',
        name: 'โครงการก่อสร้างอาคารสำนักงานใหญ่ K-Tec (พระราม 9)',
      })
      .returning();
    sampleProjectId = createdPrj.id;
  } else {
    sampleProjectId = existingProjects[0].id;
  }

  // Seed sample stock items if none
  const existingStock = await db.select().from(stockItems).limit(1);
  if (existingStock.length === 0) {
    const sampleItems = [
      { sku: 'MAT-6901', name: 'ปูนซีเมนต์ปอร์ตแลนด์ ตราช้าง (ถุง 50 กก.)', category: 'วัสดุโครงสร้าง', unit: 'ถุง', unitCost: '155.00', reorderPoint: '50.00' },
      { sku: 'MAT-6902', name: 'เหล็กข้ออ้อย DB16 SD40 (ยาว 10 ม.)', category: 'งานเหล็กเสริม', unit: 'เส้น', unitCost: '420.00', reorderPoint: '40.00' },
      { sku: 'MAT-6903', name: 'อิฐมวลเบา Q-CON ขนาด 7.5 ซม.', category: 'งานก่อฉาบ', unit: 'ก้อน', unitCost: '22.00', reorderPoint: '200.00' },
      { sku: 'MAT-6904', name: 'แผ่นตัดเหล็ก 14 นิ้ว (ดูโฮม Code: 10389197)', category: 'วัสดุสิ้นเปลือง', unit: 'ใบ', unitCost: '85.00', reorderPoint: '10.00' },
      { sku: 'MAT-6905', name: 'ถุงขยะดำ ขนาด 30x40 นิ้ว (ดูโฮม Code: 10418187)', category: 'วัสดุสิ้นเปลือง', unit: 'แพ็ค', unitCost: '45.00', reorderPoint: '15.00' },
    ];

    for (const it of sampleItems) {
      const [created] = await db.insert(stockItems).values(it).returning();

      // Initial balance
      const qty = it.sku === 'MAT-6902' ? '25.000' : '150.000'; // MAT-6902 triggers low stock alert!
      await db.insert(stockBalances).values({
        stockItemId: created.id,
        projectId: sampleProjectId,
        warehouseName: 'คลังหน้างาน พระราม 9',
        location: 'โซนจัดเก็บ A1',
        quantity: qty,
      });

      // Initial receive movement
      await db.insert(stockMovements).values({
        movementNumber: `SM-2611-${created.sku.slice(-4)}`,
        stockItemId: created.id,
        projectId: sampleProjectId,
        type: 'RECEIVE',
        quantity: qty,
        unitCost: it.unitCost,
        totalValue: String(Number(qty) * Number(it.unitCost)),
        referenceType: 'MANUAL',
        performedBy: userId,
        locationUsed: 'หน้างาน',
        notes: 'ยอดยกมาเริ่มต้นคลังสินค้า',
      });
    }

    // Seed sample PRV for a contractor that exists as a vendor, so it can be paid through a PV
    const contractorName = 'หจก. ช่างวิเชียร งานก่อสร้าง (ผู้รับเหมาฐานราก)';
    const [contractor] = await db
      .insert(vendors)
      .values({ code: 'CONT-0001', name: contractorName, type: 'INDIVIDUAL', defaultCreditDays: 0, defaultWhtRate: 3 })
      .onConflictDoUpdate({ target: vendors.code, set: { name: contractorName } })
      .returning();
    await db.insert(prvs).values({
      prvNumber: 'PRV-2611-0001',
      date: new Date().toISOString().slice(0, 10),
      projectId: sampleProjectId,
      vendorId: contractor.id,
      payeeName: contractorName,
      category: 'CONTRACTOR_PROGRESS',
      installmentNo: 1,
      totalAmount: '100000.00',
      retentionPercent: '5.00',
      retentionAmount: '5000.00',
      whtRate: '3.00',
      whtAmount: '2850.00',
      vatAmount: '0.00',
      netAmount: '92150.00',
      status: 'PM_VERIFIED',
      requestedBy: userId,
      verifiedBy: userId,
      verifiedAt: new Date(),
      notes: 'ขอเบิกงวดที่ 1 ผลงานเทเสาเข็มและคานคอดินอาคารสำนักงานแล้วเสร็จ 100%',
    });
  }
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
