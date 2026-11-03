import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { createPo, submitPo, approvePo, getPo } from '@/server/services/po';
import { createReceipt } from '@/server/services/receipt';
import { createInvoice, matchInvoice, getPoSummary } from '@/server/services/invoice';
import { requestPrepaid } from '@/server/services/payable';
import { createPv, submitPv, approvePv, markPvPaid } from '@/server/services/pv';
import { getStockPageData } from '@/server/services/stock';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

describe('e2e flow: prepaid PO', () => {
  test('office prepaid PO >= limit -> owner approves -> requestPrepaid -> PV paid -> paidNotReceived:true -> receive all -> tax invoice matched -> COMPLETED', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const po = await createPo(db, f.users.buyer, {
      projectId: null, // office
      vendorId: f.vendorCo,
      paymentType: 'PREPAID',
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'คอมพิวเตอร์สำนักงาน',
          unitName: 'เครื่อง',
          qty: D(2),
          unitPrice: D(26750), // gross 53,500 >= 50,000 limit
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);

    // buyerHead cannot approve >= 50,000
    await expect(approvePo(db, f.users.buyerHead, po.id)).rejects.toMatchObject({
      status: 403,
    });
    await approvePo(db, f.users.owner, po.id);

    const payableId = await requestPrepaid(db, f.users.buyer, po.id);
    const pv = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [payableId],
    });
    await submitPv(db, f.users.finance, pv.id);
    await approvePv(db, f.users.owner, pv.id);
    await markPvPaid(db, f.users.finance, pv.id, {
      paidAt: '2026-11-02',
      payMethod: 'TRANSFER',
    });

    const summaryAfterPay = await getPoSummary(db, po.id);
    expect(summaryAfterPay.paidNotReceived).toBe(true);
    expect(summaryAfterPay.missingTaxInvoice).toBe(true);

    const poDoc = await getPo(db, f.users.buyer, po.id);
    await createReceipt(db, f.users.buyer, {
      poId: po.id,
      receivedAt: '2026-11-05',
      lines: [{ poLineId: poDoc.lines[0]!.id, qty: D(2) }],
    });

    const summaryAfterReceive = await getPoSummary(db, po.id);
    expect(summaryAfterReceive.paidNotReceived).toBe(false);
    // Office POs have no project, so the goods land in the central store
    const stock = await getStockPageData(db, f.users.owner);
    const received = stock.items.find((i) => i.name === poDoc.lines[0]!.description);
    expect(received?.balances).toEqual([expect.objectContaining({ projectId: null, quantity: 2 })]);
    expect(summaryAfterReceive.missingTaxInvoice).toBe(true);

    const inv = await createInvoice(db, f.users.finance, {
      poId: po.id,
      invoiceNo: 'TAX-OFFICE-1',
      invoiceDate: '2026-11-06',
      beforeVat: D(50000),
      vat: D(3500),
    });
    await matchInvoice(db, f.users.finance, inv.id, [
      { payableId, gross: D(53500) },
    ]);

    const finalSummary = await getPoSummary(db, po.id);
    expect(finalSummary.missingTaxInvoice).toBe(false);
    expect((await getPo(db, f.users.buyer, po.id)).status).toBe('COMPLETED');
  });
});
