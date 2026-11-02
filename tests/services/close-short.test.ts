import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { createPr, submitPr, approvePr, orderedQtyByPrLine, getPr } from '@/server/services/pr';
import { createPo, submitPo, approvePo, getPo } from '@/server/services/po';
import { createReceipt } from '@/server/services/receipt';
import {
  requestCloseShort,
  approveCloseShort,
  rejectCloseShort,
} from '@/server/services/close-short';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

describe('close-short service', () => {
  test('approve close-short lowers PO gross to received value and reopens PR qty', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(100) }],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const prDoc = await getPr(db, f.users.buyer, pr.id);
    const prLineId = prDoc.lines[0]!.id;

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'INSTALLMENT',
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          prLineId,
          description: 'ปูนซีเมนต์',
          unitName: 'ถุง',
          qty: D(100),
          unitPrice: D(100),
          discount: D(0),
        },
      ],
      installments: [
        { name: 'งวด 1', condition: 'BEFORE_DELIVERY', percent: D(50), amount: D(5000) },
        { name: 'งวด 2', condition: 'AFTER_DELIVERY', percent: D(50), amount: D(5000) },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    const poDoc = await getPo(db, f.users.buyer, po.id);
    const poLineId = poDoc.lines[0]!.id;

    // Receive 60 out of 100
    await createReceipt(db, f.users.foreman, {
      poId: po.id,
      receivedAt: '2026-11-02',
      lines: [{ poLineId, qty: D(60) }],
    });

    const req = await requestCloseShort(db, f.users.buyer, po.id, 'ร้านค้าของหมด ส่งได้แค่ 60 ถุง');
    await approveCloseShort(db, f.users.owner, req.id);

    const updatedPo = await getPo(db, f.users.buyer, po.id);
    expect(updatedPo.closedShort).toBe(true);
    expect(updatedPo.gross).toBe('6000.00');
    expect(Number(updatedPo.lines[0]!.qty)).toBe(60);

    // PR ordered qty should drop from 100 to 60, reopening 40
    const orderedMap = await orderedQtyByPrLine(db, [prLineId]);
    expect(orderedMap.get(prLineId)!.toNumber()).toBe(60);
  });

  test('cannot close-short PO with no receipts, and can reject close-short request', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'ทรายหยาบ',
          unitName: 'คิว',
          qty: D(10),
          unitPrice: D(500),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);

    await expect(
      requestCloseShort(db, f.users.buyer, po.id, 'ยังไม่ได้รับของเลย'),
    ).rejects.toMatchObject({ status: 409 });

    const poDoc = await getPo(db, f.users.buyer, po.id);
    await createReceipt(db, f.users.foreman, {
      poId: po.id,
      receivedAt: '2026-11-02',
      lines: [{ poLineId: poDoc.lines[0]!.id, qty: D(5) }],
    });

    const req = await requestCloseShort(db, f.users.buyer, po.id, 'ขอปิดยอด');
    await rejectCloseShort(db, f.users.owner, req.id, 'ให้ตามของให้ครบ');
    const afterReject = await getPo(db, f.users.buyer, po.id);
    expect(afterReject.closedShort).toBe(false);
  });
});
