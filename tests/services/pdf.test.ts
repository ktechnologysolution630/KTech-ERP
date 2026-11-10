import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { createPo, getPo, submitPo, approvePo } from '@/server/services/po';
import { createPr } from '@/server/services/pr';
import { createInvoice } from '@/server/services/invoice';
import { listOpenPayables } from '@/server/services/payable';
import { createPv } from '@/server/services/pv';
import { renderDocPdf } from '@/server/services/pdf';
import { createTestDb } from '../helpers/test-db';
import { receiveAll } from '../helpers/receive';
import { seedBasics } from '../helpers/fixtures';

describe('pdf service', () => {
  test('pr, po, and pv pdfs render thai text and return valid PDF buffer', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [{ description: 'ปูนซีเมนต์ปอร์ตแลนด์', unitName: 'ถุง', qty: D(50) }],
    });
    const prBuf = await renderDocPdf(db, f.users.foreman, 'pr', pr.id);
    expect(prBuf.subarray(0, 4).toString()).toBe('%PDF');
    expect(prBuf.length).toBeGreaterThan(2000);

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
          description: 'ปูนซีเมนต์ปอร์ตแลนด์',
          unitName: 'ถุง',
          qty: D(10),
          unitPrice: D(107),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);

    const poBuf = await renderDocPdf(db, f.users.buyer, 'po', po.id);
    expect(poBuf.subarray(0, 4).toString()).toBe('%PDF');
    expect(poBuf.length).toBeGreaterThan(2000);
    // The PDF prints this under the vendor's name
    expect((await getPo(db, f.users.buyer, po.id)).vendorAddress).toBe('123 ถนนพระราม 2 กรุงเทพฯ');

    await receiveAll(db, f.users.owner, po.id);
    await createInvoice(db, f.users.finance, {
      poId: po.id,
      invoiceNo: 'IV-PDF-1',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(70),
    });
    const [p] = await listOpenPayables(db, f.users.finance, {});
    const pv = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [p!.id],
      whtRates: { [p!.id]: 3 },
    });

    const pvBuf = await renderDocPdf(db, f.users.finance, 'pv', pv.id);
    expect(pvBuf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pvBuf.length).toBeGreaterThan(2000);
  });

  test('foreman of other project cannot fetch PO pdf', async () => {
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
      lines: [{ description: 'เหล็ก', unitName: 'เส้น', qty: D(5), unitPrice: D(100), discount: D(0) }],
    });

    await expect(
      renderDocPdf(db, f.users.otherForeman, 'po', po.id),
    ).rejects.toMatchObject({ status: 403 });
  });
});
