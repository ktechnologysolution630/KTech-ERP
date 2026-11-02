import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { createPo, submitPo, approvePo, getPo } from '@/server/services/po';
import {
  createReceipt,
  cancelReceipt,
  receivedQtyByPoLine,
  listReceivablePos,
} from '@/server/services/receipt';
import { D } from '@/domain/money';

describe('receipt service', () => {
  async function makeApprovedPo(db: Awaited<ReturnType<typeof createTestDb>>, f: Awaited<ReturnType<typeof seedBasics>>, qty = D(100)) {
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'เหล็กเส้น',
          unitName: 'เส้น',
          qty,
          unitPrice: D(200),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    const poDoc = await getPo(db, f.users.buyer, po.id);
    return { poId: po.id, poLineId: poDoc.lines[0].id };
  }

  test('partial receipts accumulate, over-receipt rejected, double tap fails', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { poId, poLineId } = await makeApprovedPo(db, f, D(100));

    await createReceipt(db, f.users.foreman, {
      poId,
      receivedAt: '2026-11-02',
      deliveryNoteNo: 'DN-01',
      lines: [{ poLineId, qty: D(40) }],
    });
    await createReceipt(db, f.users.foreman, {
      poId,
      receivedAt: '2026-11-03',
      lines: [{ poLineId, qty: D(20) }],
    });

    const map = await receivedQtyByPoLine(db, poId);
    expect(map.get(poLineId)!.toString()).toBe('60');

    // Auto-advanced from APPROVED to ORDERED
    expect((await getPo(db, f.users.buyer, poId)).status).toBe('ORDERED');

    // Over-receipt rejected
    await expect(
      createReceipt(db, f.users.foreman, {
        poId,
        receivedAt: '2026-11-04',
        lines: [{ poLineId, qty: D('40.001') }],
      }),
    ).rejects.toMatchObject({ code: 'OVER_RECEIPT' });

    // Receive remaining 40, then second identical submit (double-tap) fails
    await createReceipt(db, f.users.foreman, {
      poId,
      receivedAt: '2026-11-04',
      lines: [{ poLineId, qty: D(40) }],
    });
    await expect(
      createReceipt(db, f.users.foreman, {
        poId,
        receivedAt: '2026-11-04',
        lines: [{ poLineId, qty: D(40) }],
      }),
    ).rejects.toMatchObject({ code: 'OVER_RECEIPT' });
  });

  test('foreman of other project forbidden, cannot receive unapproved PO, decimal qty 2.5 accepted', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { poId, poLineId } = await makeApprovedPo(db, f, D(10));

    await expect(
      createReceipt(db, f.users.otherForeman, {
        poId,
        receivedAt: '2026-11-02',
        lines: [{ poLineId, qty: D(1) }],
      }),
    ).rejects.toMatchObject({ status: 403 });

    const rec = await createReceipt(db, f.users.foreman, {
      poId,
      receivedAt: '2026-11-02',
      lines: [{ poLineId, qty: D('2.5') }],
    });
    expect((await receivedQtyByPoLine(db, poId)).get(poLineId)!.toString()).toBe('2.5');

    const receivableForForeman = await listReceivablePos(db, f.users.foreman);
    expect(receivableForForeman.length).toBe(1);
    const receivableForOther = await listReceivablePos(db, f.users.otherForeman);
    expect(receivableForOther.length).toBe(0);

    await cancelReceipt(db, f.users.buyerHead, rec.id, 'คีย์ผิด');
    expect((await receivedQtyByPoLine(db, poId)).get(poLineId) ?? D(0)).toEqual(D(0));

    // Unapproved PO cannot be received
    const draftPo = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ทราย', unitName: 'คิว', qty: D(5), unitPrice: D(300), discount: D(0) }],
    });
    const draftDoc = await getPo(db, f.users.buyer, draftPo.id);
    await expect(
      createReceipt(db, f.users.foreman, {
        poId: draftPo.id,
        receivedAt: '2026-11-02',
        lines: [{ poLineId: draftDoc.lines[0].id, qty: D(1) }],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
