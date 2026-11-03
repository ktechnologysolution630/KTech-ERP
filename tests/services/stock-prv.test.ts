import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import {
  createOrUpdateStockItem,
  recordStockMovement,
  getStockOverview,
  getAllStockItems,
  createStockAdjustRequest,
  approveStockAdjustRequest,
} from '@/server/services/stock';
import { createPrv, getPrvs, getPrvById, updatePrvStatus } from '@/server/services/prv';

describe('Stock & PRV Services', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let f: Awaited<ReturnType<typeof seedBasics>>;

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
  });

  it('Stock: creates stock item, records receive and issue, updates balance & overview', async () => {
    const item = await createOrUpdateStockItem(db, {
      sku: 'MAT-TEST-01',
      name: 'เหล็กเส้นกลม RB9',
      category: 'งานโครงสร้าง',
      unit: 'เส้น',
      unitCost: 150,
      reorderPoint: 20,
    });

    expect(item.sku).toBe('MAT-TEST-01');

    // Receive 50
    await recordStockMovement(db, {
      stockItemId: item.id,
      projectId: f.projectA,
      type: 'RECEIVE',
      quantity: 50,
      unitCost: 150,
      performedBy: f.users.foreman.id,
      notes: 'รับของเข้าคลังโครงการ A',
    });

    // Overview check
    let overview = await getStockOverview(db);
    expect(overview.totalItems).toBeGreaterThanOrEqual(1);
    expect(overview.totalValue).toBe(7500);

    // Issue 15
    await recordStockMovement(db, {
      stockItemId: item.id,
      projectId: f.projectA,
      type: 'ISSUE',
      quantity: 15,
      performedBy: f.users.foreman.id,
      locationUsed: 'ฐานราก F1',
    });

    const all = await getAllStockItems(db);
    const found = all.find((i) => i.id === item.id);
    expect(found?.totalQty).toBe(35);
    expect(found?.totalValue).toBe(35 * 150);
  });

  it('Stock: adjustment request workflow with approval', async () => {
    const item = await createOrUpdateStockItem(db, {
      sku: 'MAT-TEST-02',
      name: 'ปูนซีเมนต์ปอร์ตแลนด์',
      category: 'งานปูน',
      unit: 'ถุง',
      unitCost: 140,
      reorderPoint: 10,
    });

    // Initial stock 20
    await recordStockMovement(db, {
      stockItemId: item.id,
      projectId: f.projectA,
      type: 'RECEIVE',
      quantity: 20,
      performedBy: f.users.foreman.id,
    });

    // Request adjust from 20 -> 18 (ชำรุด 2 ถุง)
    const req = await createStockAdjustRequest(db, {
      stockItemId: item.id,
      projectId: f.projectA,
      currentQty: 20,
      adjustedQty: 18,
      reason: 'ถุงแตกชำรุดระหว่างฝนตก',
      requestedBy: f.users.foreman.id,
    });

    expect(req.status).toBe('PENDING');
    expect(Number(req.differenceQty)).toBe(-2);

    // Owner approves
    const result = await approveStockAdjustRequest(db, req.id, f.users.owner.id, true);
    expect(result.status).toBe('APPROVED');

    // Check new balance
    const all = await getAllStockItems(db);
    const found = all.find((i) => i.id === item.id);
    expect(found?.totalQty).toBe(18);
  });

  it('PRV: creates Payment Request Voucher, calculates retention & wht, and processes approval', async () => {
    const prv = await createPrv(
      db,
      {
        projectId: f.projectA,
        payeeName: 'หจก. ช่างวิเชียร งานก่อสร้าง',
        category: 'CONTRACTOR_PROGRESS',
        installmentNo: 1,
        retentionPercent: 5,
        whtRate: 3,
        vatRate: 7,
        notes: 'เบิกงวดที่ 1 ฐานราก',
        items: [
          { description: 'งานเทเสาเข็ม', quantity: 1, unit: 'งาน', unitPrice: 100000, progressPercent: 100 },
        ],
      },
      f.users.foreman.id,
    );

    expect(prv.prvNumber).toContain('PRV-');
    expect(Number(prv.totalAmount)).toBe(100000);
    expect(Number(prv.retentionAmount)).toBe(5000); // 5%
    expect(Number(prv.whtAmount)).toBe(3000); // 3%
    expect(Number(prv.vatAmount)).toBe(7000); // 7%
    // Net: 100000 - 5000 - 3000 + 7000 = 99000
    expect(Number(prv.netAmount)).toBe(99000);
    expect(prv.status).toBe('DRAFT');

    // PM verifies
    const verified = await updatePrvStatus(db, prv.id, 'PM_VERIFIED', f.users.pm.id);
    expect(verified.status).toBe('PM_VERIFIED');
    expect(verified.verifiedBy).toBe(f.users.pm.id);

    // Owner approves
    const approved = await updatePrvStatus(db, prv.id, 'APPROVED', f.users.owner.id);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe(f.users.owner.id);

    const fetched = await getPrvById(db, prv.id);
    expect(fetched?.items.length).toBe(1);
    expect(fetched?.project?.name).toBe('โครงการก่อสร้างคลังสินค้า A');
  });
});
