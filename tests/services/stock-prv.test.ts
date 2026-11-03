import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import {
  decideStockAdjust,
  getStockPageData,
  recordStockMovement,
  requestStockAdjust,
  summarizeStock,
  upsertStockItem,
} from '@/server/services/stock';
import { createPrv, getPrvs, getPrvById, updatePrvStatus } from '@/server/services/prv';

describe('Stock & PRV Services', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let f: Awaited<ReturnType<typeof seedBasics>>;

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
  });

  const qtyAt = async (itemId: string, projectId: string | null) => {
    const data = await getStockPageData(db, f.users.owner);
    const item = data.items.find((i) => i.id === itemId)!;
    return item.balances.find((b) => b.projectId === projectId)?.quantity ?? 0;
  };

  it('Stock: creates stock item, records receive and issue, updates balance & overview', async () => {
    const item = await upsertStockItem(db, f.users.buyer, {
      sku: 'MAT-TEST-01',
      name: 'เหล็กเส้นกลม RB9',
      category: 'งานโครงสร้าง',
      unit: 'เส้น',
      unitCost: 150,
      reorderPoint: 20,
    });
    expect(item.sku).toBe('MAT-TEST-01');

    await recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, type: 'RECEIVE', quantity: 50, unitCost: 150 });
    let summary = summarizeStock((await getStockPageData(db, f.users.owner)).items);
    expect(summary.totalValue).toBe(7500);

    await recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, type: 'ISSUE', quantity: 15, locationUsed: 'ฐานราก F1' });
    const data = await getStockPageData(db, f.users.owner);
    const found = data.items.find((i) => i.id === item.id);
    expect(found).toMatchObject({ totalQty: 35, totalValue: 35 * 150 });
    // Issues are valued at standard cost and show up in the monthly flow
    const thisMonth = data.monthly.at(-1)!;
    expect(thisMonth).toMatchObject({ receiveValue: 7500, issueValue: 2250, receiveCount: 1, issueCount: 1 });
    summary = summarizeStock(data.items);
    expect(summary.lowStock).toHaveLength(0);
  });

  it('Stock: refuses over-issue, requires a transfer target, and transfers between locations', async () => {
    const item = await upsertStockItem(db, f.users.buyer, { name: 'ทราย', unit: 'คิว', unitCost: 400 });
    expect(item.sku).toMatch(/^MAT-/);
    await recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'RECEIVE', quantity: 10 });

    await expect(
      recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'ISSUE', quantity: 11 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await expect(
      recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'TRANSFER', quantity: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_STOCK' });
    await expect(
      recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'TRANSFER', quantity: 1, targetProjectId: null }),
    ).rejects.toMatchObject({ code: 'INVALID_STOCK' });

    await recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'TRANSFER', quantity: 4, targetProjectId: f.projectA });
    expect(await qtyAt(item.id, null)).toBe(6);
    expect(await qtyAt(item.id, f.projectA)).toBe(4);
    // Nothing changed after a refused movement
    await expect(
      recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, type: 'TRANSFER', quantity: 5, targetProjectId: null }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await qtyAt(item.id, f.projectA)).toBe(4);
  });

  it('Stock: permissions by role and project', async () => {
    const item = await upsertStockItem(db, f.users.buyer, { name: 'ตะปู', unit: 'กล่อง' });
    await expect(upsertStockItem(db, f.users.foreman, { name: 'x' })).rejects.toMatchObject({ status: 403 });
    // Site staff: own project only, not the central store or another project
    await expect(
      recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectB, type: 'RECEIVE', quantity: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: null, type: 'RECEIVE', quantity: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      recordStockMovement(db, f.users.finance, { stockItemId: item.id, projectId: f.projectA, type: 'RECEIVE', quantity: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    // Site staff only see the central store and their own projects
    const seen = await getStockPageData(db, f.users.otherForeman);
    expect(seen.locations.map((l) => l.projectId)).toEqual([null, f.projectB]);
    expect(seen.permissions).toMatchObject({ manageItems: false, approveAdjust: false, moveCentral: false, movableProjectIds: [f.projectB] });
  });

  it('Stock: adjustment request workflow with approval', async () => {
    const item = await upsertStockItem(db, f.users.buyer, { sku: 'MAT-TEST-02', name: 'ปูนซีเมนต์ปอร์ตแลนด์', unit: 'ถุง', unitCost: 140 });
    await recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, type: 'RECEIVE', quantity: 20 });

    // The system quantity is read on the server (20), so the difference is -2
    const req = await requestStockAdjust(db, f.users.foreman, {
      stockItemId: item.id,
      projectId: f.projectA,
      countedQty: 18,
      reason: 'ถุงแตกชำรุดระหว่างฝนตก',
    });
    expect(req).toMatchObject({ status: 'PENDING', currentQty: '20.000', differenceQty: '-2.000' });
    await expect(
      requestStockAdjust(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, countedQty: 20, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_STOCK' });

    await expect(decideStockAdjust(db, f.users.foreman, req.id, true)).rejects.toMatchObject({ status: 403 });
    expect(await decideStockAdjust(db, f.users.owner, req.id, true)).toBe('APPROVED');
    await expect(decideStockAdjust(db, f.users.owner, req.id, true)).rejects.toMatchObject({ status: 409 });
    expect(await qtyAt(item.id, f.projectA)).toBe(18);

    // Approvers cannot approve their own request
    const own = await requestStockAdjust(db, f.users.buyerHead, { stockItemId: item.id, projectId: f.projectA, countedQty: 17, reason: 'นับใหม่' });
    await expect(decideStockAdjust(db, f.users.buyerHead, own.id, true)).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    expect(await decideStockAdjust(db, f.users.owner, own.id, false)).toBe('REJECTED');
    expect(await qtyAt(item.id, f.projectA)).toBe(18);
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
