import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { activityLogs } from '@/db/schema';
import {
  getProjectBoqSheet,
  saveProjectMainBoq,
  type SaveBoqInput,
} from '@/server/services/boq';

function sheetInput(overrides: Partial<SaveBoqInput> = {}): SaveBoqInput {
  return {
    baseUpdatedAt: null,
    revision: 0,
    estimateDate: '2026-11-03',
    projectTitle: 'โครงการก่อสร้างคลังสินค้า A',
    location: 'ชลบุรี',
    owner: 'บริษัท เจ้าของ จำกัด',
    workDetail: 'ก่อสร้างคลังสินค้า',
    estimator: 'วิศวกรประมาณราคา',
    overheadPercent: 10,
    discountAmount: 0,
    vatPercent: 7,
    remarks: '',
    lines: [
      {
        isCategory: true,
        isBold: true,
        no: '1',
        description: 'งานฐานราก',
        qty: '',
        unit: '',
        materialRate: '',
        laborRate: '',
        note: '',
      },
      {
        isCategory: false,
        isBold: false,
        no: '1.1',
        description: 'เสาเข็มเจาะ 0.60 ม.',
        qty: 84,
        unit: 'ต้น',
        materialRate: 18500,
        laborRate: 4500,
        note: '',
      },
    ],
    ...overrides,
  };
}

describe('boq service', () => {
  test('project PM creates the main BOQ and reloads it in row order', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const empty = await getProjectBoqSheet(db, f.users.pm, f.projectA);
    expect(empty.boq).toBeNull();
    expect(empty.canEdit).toBe(true);

    const saved = await saveProjectMainBoq(db, f.users.pm, f.projectA, sheetInput());
    expect(saved.number).toMatch(/^BOQ-\d{4}-0001$/);
    // 84 × 23,000 = 1,932,000 → +10% = 2,125,200 → +7% VAT = 2,273,964
    expect(saved.grandTotal).toBe(2_273_964);

    const reloaded = await getProjectBoqSheet(db, f.users.pm, f.projectA);
    expect(reloaded.boq?.lines.map((l) => l.no)).toEqual(['1', '1.1']);
    expect(reloaded.boq?.lines[0]).toMatchObject({ isCategory: true, qty: '', materialRate: '' });
    expect(reloaded.boq?.lines[1]).toMatchObject({ qty: 84, materialRate: 18500, laborRate: 4500 });

    const logs = await db.select().from(activityLogs).where(eq(activityLogs.entityId, saved.id));
    expect(logs.map((l) => l.action)).toEqual(['CREATE']);
  });

  test('saving replaces lines and keeps the document number', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const first = await saveProjectMainBoq(db, f.users.pm, f.projectA, sheetInput());

    const second = await saveProjectMainBoq(
      db,
      f.users.pm,
      f.projectA,
      sheetInput({ baseUpdatedAt: first.updatedAt, revision: 1, lines: [] }),
    );
    expect(second.id).toBe(first.id);
    expect(second.number).toBe(first.number);
    expect(second.revision).toBe(1);
    expect(second.lines).toHaveLength(0);
    expect(second.grandTotal).toBe(0);
  });

  test('stale editor version is rejected with 409', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await saveProjectMainBoq(db, f.users.pm, f.projectA, sheetInput());

    // A second editor that opened the page before the first save still sends baseUpdatedAt: null
    await expect(
      saveProjectMainBoq(db, f.users.owner, f.projectA, sheetInput()),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('only PM/engineer members, owner and admin may edit', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    await expect(
      saveProjectMainBoq(db, f.users.foreman, f.projectA, sheetInput()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      saveProjectMainBoq(db, f.users.pm, f.projectB, sheetInput()),
    ).rejects.toMatchObject({ status: 403 });

    // Purchasing can view every project but not edit its BOQ
    const buyerView = await getProjectBoqSheet(db, f.users.buyer, f.projectB);
    expect(buyerView.canEdit).toBe(false);
    await expect(getProjectBoqSheet(db, f.users.pm, f.projectB)).rejects.toMatchObject({
      status: 403,
    });

    const byAdmin = await saveProjectMainBoq(db, f.users.admin, f.projectB, sheetInput());
    expect(byAdmin.lines).toHaveLength(2);
  });

  test('rejects invalid values and unknown projects', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const bad = sheetInput();
    bad.lines[1] = { ...bad.lines[1], qty: -5 };

    await expect(saveProjectMainBoq(db, f.users.pm, f.projectA, bad)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      saveProjectMainBoq(db, f.users.pm, f.projectA, sheetInput({ overheadPercent: 150 })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(getProjectBoqSheet(db, f.users.owner, 'not-a-uuid')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      getProjectBoqSheet(db, f.users.owner, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
