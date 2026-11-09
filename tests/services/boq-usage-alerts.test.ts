import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { notifications, type NotificationLevel } from '@/db/schema';
import { boqUsageLevel } from '@/domain/boq-overrun';
import { D } from '@/domain/money';
import { getProjectBoqSheet, saveProjectMainBoq } from '@/server/services/boq';
import { decideBoqOverrun, requestBoqOverrun } from '@/server/services/boq-overrun';
import { approvePo, cancelPo, createPo, getPo, rejectPo, submitPo, updatePo } from '@/server/services/po';
import { type Db } from '@/db/client';

describe('boqUsageLevel', () => {
  test.each([
    [0, 0],
    [49.99, 0],
    [50, 50],
    [79.99, 50],
    [80, 80],
    [99.99, 80],
    [100, 100],
    [100.01, 101],
  ])('%s of 100 → %s', (used, level) => {
    expect(boqUsageLevel(used, 100)).toBe(level);
  });

  test('no budget never alerts', () => {
    expect(boqUsageLevel(500, 0)).toBe(0);
  });
});

async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  // Budget: 10 piles × 20,000 = 200,000
  await saveProjectMainBoq(db, f.users.pm, f.projectA, {
    baseUpdatedAt: null,
    revision: 0,
    estimateDate: null,
    projectTitle: '',
    location: '',
    owner: '',
    workDetail: '',
    estimator: '',
    overheadPercent: 0,
    discountAmount: 0,
    vatPercent: 7,
    remarks: '',
    lines: [
      { isCategory: true, isBold: true, no: '1', description: 'งานฐานราก', qty: '', unit: '', materialRate: '', laborRate: '', note: '' },
      { isCategory: false, isBold: false, no: '1.1', description: 'เสาเข็ม', qty: 10, unit: 'ต้น', materialRate: 20_000, laborRate: 5_000, note: '' },
    ],
  });
  const sheet = await getProjectBoqSheet(db, f.users.pm, f.projectA);
  return { db, f, pileLine: sheet.boq!.lines[1] };
}

function poInput(projectId: string, vendorId: string, boqLineId: string, qty: number) {
  return {
    projectId,
    vendorId,
    paymentType: 'CREDIT' as const,
    creditDays: 30,
    vatMode: 'EXCLUSIVE' as const,
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ boqLineId, description: 'เสาเข็มเจาะ', unitName: 'ต้น', qty: D(qty), unitPrice: D(20_000), discount: D(0) }],
  };
}

async function boqAlerts(db: Db, userId: string): Promise<NotificationLevel[]> {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return rows
    .filter((r) => r.category === 'BOQ' && r.href.endsWith('/boq'))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => r.level);
}

describe('BOQ usage alerts', () => {
  test('owner and the project PM are told at 50%, 80%, 100% and over; other roles are not', async () => {
    const { db, f, pileLine } = await setup();

    const po1 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 6)); // 60%
    await submitPo(db, f.users.buyer, po1.id);
    expect(await boqAlerts(db, f.users.owner.id)).toEqual(['NOTICE']);
    expect(await boqAlerts(db, f.users.pm.id)).toEqual(['NOTICE']);

    await approvePo(db, f.users.owner, po1.id);
    // Approving does not change what is committed, so no repeat
    expect(await boqAlerts(db, f.users.owner.id)).toEqual(['NOTICE']);

    const po2 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 3)); // 90%
    await submitPo(db, f.users.buyer, po2.id);
    expect(await boqAlerts(db, f.users.owner.id)).toEqual(['NOTICE', 'WARNING']);

    const po3 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 2)); // 110%
    await submitPo(db, f.users.buyer, po3.id);
    expect(await boqAlerts(db, f.users.owner.id)).toEqual(['NOTICE', 'WARNING', 'OVER']);
    expect(await boqAlerts(db, f.users.pm.id)).toEqual(['NOTICE', 'WARNING', 'OVER']);

    for (const other of [f.users.buyer, f.users.buyerHead, f.users.finance, f.users.foreman, f.users.admin]) {
      expect(await boqAlerts(db, other.id)).toEqual([]);
    }
  });

  test('a PM of another project is not told', async () => {
    const { db, f, pileLine } = await setup();
    const po = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 10)); // 100%
    await submitPo(db, f.users.buyer, po.id);
    expect(await boqAlerts(db, f.users.owner.id)).toEqual(['CRITICAL']);
    expect(await boqAlerts(db, f.users.otherForeman.id)).toEqual([]);
  });

  test('a rejected or cancelled PO lowers the level so the next purchase alerts again', async () => {
    const { db, f, pileLine } = await setup();

    const po = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 5)); // 50%
    await submitPo(db, f.users.buyer, po.id);
    await rejectPo(db, f.users.owner, po.id, 'ราคาสูง');
    await submitPo(db, f.users.buyer, po.id);
    expect(await boqAlerts(db, f.users.owner.id)).toEqual(['NOTICE', 'NOTICE']);

    await cancelPo(db, f.users.buyer, po.id, 'ไม่ใช้แล้ว');
    const po2 = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 5));
    await submitPo(db, f.users.buyer, po2.id);
    expect(await boqAlerts(db, f.users.owner.id)).toEqual(['NOTICE', 'NOTICE', 'NOTICE']);
  });

  test('an approved revision that raises the amount alerts at the new level', async () => {
    const { db, f, pileLine } = await setup();
    const po = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 6)); // 60%
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.owner, po.id);

    const [line] = (await getPo(db, f.users.buyer, po.id)).lines;
    const revised = poInput(f.projectA, f.vendorCo, pileLine.id, 9); // 90%
    await updatePo(db, f.users.buyer, po.id, {
      ...revised,
      reason: 'เพิ่มจำนวนตามหน้างาน',
      lines: revised.lines.map((l) => ({ ...l, id: line.id })),
    });
    await submitPo(db, f.users.buyer, po.id);
    // The revision only commits once approved
    expect(await boqAlerts(db, f.users.owner.id)).toEqual(['NOTICE']);
    await approvePo(db, f.users.owner, po.id);
    expect(await boqAlerts(db, f.users.owner.id)).toEqual(['NOTICE', 'WARNING']);
  });

  test('an over-BOQ AP request is a BOQ notification for the owner', async () => {
    const { db, f, pileLine } = await setup();
    const po = await createPo(db, f.users.buyer, poInput(f.projectA, f.vendorCo, pileLine.id, 11));
    await submitPo(db, f.users.buyer, po.id);
    const ap = await requestBoqOverrun(db, f.users.buyer, po.id, 'ดินอ่อน');
    await decideBoqOverrun(db, f.users.owner, ap.id, true, '');

    const ownerRows = await db.select().from(notifications).where(eq(notifications.userId, f.users.owner.id));
    expect(ownerRows.find((r) => r.title.includes(ap.number))).toMatchObject({ category: 'BOQ', level: 'OVER', projectId: f.projectA });
    const poRow = ownerRows.find((r) => r.title.includes('รออนุมัติ') && r.href === `/po/${po.id}`);
    expect(poRow).toMatchObject({ category: 'PO' });
  });
});
