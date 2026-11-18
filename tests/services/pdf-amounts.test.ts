import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { createInvoice } from '@/server/services/invoice';
import { listOpenPayables } from '@/server/services/payable';
import { renderDocPdf } from '@/server/services/pdf';
import { approvePo, createPo, reviewPo, submitPo } from '@/server/services/po';
import { approvePv, createPv, getPv, markPvPaid, submitPv } from '@/server/services/pv';
// Issues the 50 ทวิ on payment and renders it, as the PV actions and the PDF route load it
import '@/server/services/wht-cert';
import { seedBasics } from '../helpers/fixtures';
import { pdfText } from '../helpers/pdf-text';
import { EARLY_PAY_REASON, receiveAll } from '../helpers/receive';
import { createTestDb } from '../helpers/test-db';

describe('printed amounts', () => {
  test('the payment voucher and its 50 ทวิ group thousands with commas', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'เหล็กโครงสร้าง', unitName: 'งาน', qty: D(1), unitPrice: D(1500600), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await reviewPo(db, f.users.buyerHead, po.id);
    await approvePo(db, f.users.owner, po.id);
    await receiveAll(db, f.users.owner, po.id);
    await createInvoice(db, f.users.finance, {
      poId: po.id,
      invoiceNo: 'IV-COMMA',
      invoiceDate: '2026-11-02',
      beforeVat: D(1500600),
      vat: D(105042),
    });
    const [p] = await listOpenPayables(db, f.users.finance, { vendorId: f.vendorCo });
    const created = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [p!.id],
      whtRates: { [p!.id]: 3 },
    });

    // before VAT 1,500,600.00 + VAT 105,042.00 = 1,605,642.00, less 3% WHT 45,018.00 = 1,560,624.00
    const pvText = await pdfText(await renderDocPdf(db, f.users.finance, 'pv', created.id));
    for (const amount of ['1,500,600.00', '105,042.00', '1,605,642.00', '45,018.00', '1,560,624.00']) {
      expect(pvText).toContain(amount);
    }
    expect(pvText).not.toMatch(/\d{4}\.\d{2}/);

    await submitPv(db, f.users.finance, created.id);
    await approvePv(db, f.users.owner, created.id, EARLY_PAY_REASON);
    await markPvPaid(db, f.users.finance, created.id, { paidAt: '2026-11-15', payMethod: 'TRANSFER' });
    const pv = await getPv(db, f.users.finance, created.id);

    const whtText = await pdfText(await renderDocPdf(db, f.users.finance, 'wht', pv.whtCertId!));
    expect(whtText).toContain('1,500,600.00');
    expect(whtText).toContain('45,018.00');
    expect(whtText).not.toMatch(/\d{4}\.\d{2}/);
  });
});
