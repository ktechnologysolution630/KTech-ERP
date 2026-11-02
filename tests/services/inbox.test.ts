import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { createPo, submitPo, approvePo } from '@/server/services/po';
import { getInbox } from '@/server/services/inbox';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

describe('inbox service', () => {
  test('buyer head sees only under-limit POs to approve, owner sees all', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const smallPo = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'ของเล็กน้อย',
          unitName: 'ชิ้น',
          qty: D(10),
          unitPrice: D(1000),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, smallPo.id);

    const bigPo = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'ของใหญ่เกิน 50,000',
          unitName: 'ชุด',
          qty: D(1),
          unitPrice: D(60000),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, bigPo.id);

    const headInbox = await getInbox(db, f.users.buyerHead);
    const headPoGroup = headInbox.find((g) => g.key === 'PO_TO_APPROVE');
    expect(headPoGroup?.count).toBe(1);
    expect(headPoGroup?.items[0]!.id).toBe(smallPo.id);

    const ownerInbox = await getInbox(db, f.users.owner);
    const ownerPoGroup = ownerInbox.find((g) => g.key === 'PO_TO_APPROVE');
    expect(ownerPoGroup?.count).toBe(2);
  });

  test('foreman inbox shows POs to receive only for own project', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const poA = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'เหล็ก A', unitName: 'เส้น', qty: D(5), unitPrice: D(100), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, poA.id);
    await approvePo(db, f.users.buyerHead, poA.id);

    const poB = await createPo(db, f.users.buyer, {
      projectId: f.projectB,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'เหล็ก B', unitName: 'เส้น', qty: D(5), unitPrice: D(100), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, poB.id);
    await approvePo(db, f.users.buyerHead, poB.id);

    const foremanAInbox = await getInbox(db, f.users.foreman);
    const recGroupA = foremanAInbox.find((g) => g.key === 'PO_TO_RECEIVE');
    expect(recGroupA?.count).toBe(1);
    expect(recGroupA?.items[0]!.id).toBe(poA.id);

    const foremanBInbox = await getInbox(db, f.users.otherForeman);
    const recGroupB = foremanBInbox.find((g) => g.key === 'PO_TO_RECEIVE');
    expect(recGroupB?.count).toBe(1);
    expect(recGroupB?.items[0]!.id).toBe(poB.id);
  });
});
