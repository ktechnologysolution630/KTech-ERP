import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { createPr, submitPr, approvePr, getPr } from '@/server/services/pr';
import { createPo, submitPo, approvePo, markOrdered, getPo } from '@/server/services/po';
import { createReceipt } from '@/server/services/receipt';
import { createInvoice, getPoSummary } from '@/server/services/invoice';
import { listOpenPayables } from '@/server/services/payable';
import { createPv, submitPv, approvePv, markPvPaid } from '@/server/services/pv';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

describe('e2e flow: credit PO', () => {
  test('PR -> approve -> PO credit 30d -> approve(buyerHead) -> ordered -> receive 60%+40% -> invoice -> PV -> approve -> paid -> COMPLETED', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [
        {
          description: 'ปูนซีเมนต์ปอร์ตแลนด์',
          unitName: 'ถุง',
          qty: D(100),
          estUnitPrice: D(100),
        },
      ],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const prDoc = await getPr(db, f.users.buyer, pr.id);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          prLineId: prDoc.lines[0]!.id,
          description: 'ปูนซีเมนต์ปอร์ตแลนด์',
          unitName: 'ถุง',
          qty: D(100),
          unitPrice: D(107),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    await markOrdered(db, f.users.buyer, po.id);

    const poDoc = await getPo(db, f.users.buyer, po.id);
    const poLineId = poDoc.lines[0]!.id;

    // Receive 60% then 40%
    await createReceipt(db, f.users.foreman, {
      poId: po.id,
      receivedAt: '2026-11-02',
      lines: [{ poLineId, qty: D(60) }],
    });
    await createReceipt(db, f.users.foreman, {
      poId: po.id,
      receivedAt: '2026-11-03',
      lines: [{ poLineId, qty: D(40) }],
    });

    // Invoice
    await createInvoice(db, f.users.finance, {
      poId: po.id,
      invoiceNo: 'IV-E2E-CREDIT',
      invoiceDate: '2026-11-04',
      beforeVat: D(10000),
      vat: D(700),
    });

    const [payable] = await listOpenPayables(db, f.users.finance, {});
    const pv = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [payable!.id],
      whtRates: { [payable!.id]: 0 },
    });
    await submitPv(db, f.users.finance, pv.id);
    await approvePv(db, f.users.owner, pv.id);
    await markPvPaid(db, f.users.finance, pv.id, {
      paidAt: '2026-11-05',
      payMethod: 'TRANSFER',
    });

    const summary = await getPoSummary(db, po.id);
    expect(summary.receiveStatus).toBe('FULL');
    expect(summary.payStatus).toBe('PAID');

    const finalPo = await getPo(db, f.users.buyer, po.id);
    expect(finalPo.status).toBe('COMPLETED');
  });
});
