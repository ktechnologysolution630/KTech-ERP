import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { createPo, submitPo, approvePo, getPo } from '@/server/services/po';
import { createReceipt } from '@/server/services/receipt';
import { getPoSummary } from '@/server/services/invoice';
import { requestInstallment } from '@/server/services/payable';
import { createPv, submitPv, approvePv, markPvPaid } from '@/server/services/pv';
import { requestCloseShort, approveCloseShort } from '@/server/services/close-short';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

describe('e2e flow: installment PO with close-short', () => {
  test('20/30/40/10 on 100,000 -> pay #1 and #2 -> receive 50% -> close-short approved -> gross 50,000 -> #3 and #4 CANCELLED -> COMPLETED', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'INSTALLMENT',
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'โครงสร้างเหล็กสั่งผลิต',
          unitName: 'ตัน',
          qty: D(10),
          unitPrice: D(10000),
          discount: D(0),
        },
      ],
      installments: [
        { name: 'งวด 1 มัดจำ 20%', condition: 'BEFORE_PRODUCTION', percent: D(20) },
        { name: 'งวด 2 ก่อนส่ง 30%', condition: 'BEFORE_DELIVERY', percent: D(30) },
        { name: 'งวด 3 หลังส่ง 40%', condition: 'AFTER_DELIVERY', percent: D(40) },
        { name: 'งวด 4 ประกัน 10%', condition: 'OTHER', percent: D(10) },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.owner, po.id);

    const poDoc = await getPo(db, f.users.buyer, po.id);
    const inst1 = poDoc.installments[0]!;
    const inst2 = poDoc.installments[1]!;

    const p1 = await requestInstallment(db, f.users.buyer, inst1.id);
    const p2 = await requestInstallment(db, f.users.buyer, inst2.id);

    const pv = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [p1, p2],
    });
    await submitPv(db, f.users.finance, pv.id);
    await approvePv(db, f.users.owner, pv.id);
    await markPvPaid(db, f.users.finance, pv.id, {
      paidAt: '2026-11-02',
      payMethod: 'TRANSFER',
    });

    // Receive 50% (5 tons)
    await createReceipt(db, f.users.foreman, {
      poId: po.id,
      receivedAt: '2026-11-10',
      lines: [{ poLineId: poDoc.lines[0]!.id, qty: D(5) }],
    });

    const csReq = await requestCloseShort(
      db,
      f.users.buyer,
      po.id,
      'ใช้จริงเพียง 5 ตัน ตกลงหยุดผลิตส่วนที่เหลือ',
    );
    await approveCloseShort(db, f.users.owner, csReq.id);

    const finalPo = await getPo(db, f.users.buyer, po.id);
    expect(finalPo.gross).toBe('50000.00');
    expect(finalPo.status).toBe('COMPLETED');
    expect(finalPo.installments.map((i) => i.status)).toEqual([
      'PAID',
      'PAID',
      'CANCELLED',
      'CANCELLED',
    ]);

    const summary = await getPoSummary(db, po.id);
    expect(summary.remainingToPay.toFixed(2)).toBe('0.00');
    expect(summary.refundDue.toFixed(2)).toBe('0.00');
  });
});
