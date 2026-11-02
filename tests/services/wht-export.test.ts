import ExcelJS from 'exceljs';
import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { createPo, submitPo, approvePo } from '@/server/services/po';
import { createInvoice } from '@/server/services/invoice';
import { listOpenPayables } from '@/server/services/payable';
import { createPv, submitPv, approvePv, markPvPaid, getPv } from '@/server/services/pv';
import { getWhtCert } from '@/server/services/wht-cert';
import { exportMonthly } from '@/server/services/exports';
import { renderDocPdf } from '@/server/services/pdf';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

describe('50 ทวิ certificates and monthly exports', () => {
  test('paying PV with WHT issues PND3 cert for individual vendor and renders PDF', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorPerson,
      paymentType: 'CREDIT',
      creditDays: 7,
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'ค่าบริการขนส่ง',
          unitName: 'เที่ยว',
          qty: D(1),
          unitPrice: D(1000),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);

    await createInvoice(db, f.users.finance, {
      poId: po.id,
      invoiceNo: 'IV-PND3',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(0),
    });
    const [p] = await listOpenPayables(db, f.users.finance, {
      vendorId: f.vendorPerson,
    });
    const pvCreated = await createPv(db, f.users.finance, {
      vendorId: f.vendorPerson,
      payableIds: [p!.id],
      whtRates: { [p!.id]: 3 },
    });
    await submitPv(db, f.users.finance, pvCreated.id);
    await approvePv(db, f.users.owner, pvCreated.id);
    await markPvPaid(db, f.users.finance, pvCreated.id, {
      paidAt: '2026-11-15',
      payMethod: 'TRANSFER',
    });

    const pv = await getPv(db, f.users.finance, pvCreated.id);
    expect(pv.whtCertId).toBeTruthy();

    const cert = await getWhtCert(db, f.users.finance, pv.whtCertId!);
    expect(cert).toMatchObject({
      formType: 'PND3',
      basis: '1000.00',
      wht: '30.00',
    });
    expect(cert.number).toMatch(/^WHT-\d{4}-0001$/);

    const pdfBuf = await renderDocPdf(db, f.users.finance, 'wht', cert.id);
    expect(pdfBuf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdfBuf.length).toBeGreaterThan(2000);
  });

  test('no cert when wht is 0', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

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
          description: 'ปูนซีเมนต์',
          unitName: 'ถุง',
          qty: D(10),
          unitPrice: D(107),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);

    await createInvoice(db, f.users.finance, {
      poId: po.id,
      invoiceNo: 'IV-NOWHT',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(70),
    });
    const [p] = await listOpenPayables(db, f.users.finance, {
      vendorId: f.vendorCo,
    });
    const pvCreated = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [p!.id],
      whtRates: { [p!.id]: 0 },
    });
    await submitPv(db, f.users.finance, pvCreated.id);
    await approvePv(db, f.users.owner, pvCreated.id);
    await markPvPaid(db, f.users.finance, pvCreated.id, {
      paidAt: '2026-11-15',
      payMethod: 'TRANSFER',
    });

    const pv = await getPv(db, f.users.finance, pvCreated.id);
    expect(pv.whtCertId).toBeNull();
  });

  test('wht export splits sheets by form type, and payment on 2026-11-30 counts in November', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorPerson,
      paymentType: 'CREDIT',
      creditDays: 7,
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ค่าขนส่ง', unitName: 'งาน', qty: D(1), unitPrice: D(2000), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);

    await createInvoice(db, f.users.finance, {
      poId: po.id,
      invoiceNo: 'IV-NOV30',
      invoiceDate: '2026-11-30',
      beforeVat: D(2000),
      vat: D(0),
    });
    const [p] = await listOpenPayables(db, f.users.finance, {
      vendorId: f.vendorPerson,
    });
    const pvCreated = await createPv(db, f.users.finance, {
      vendorId: f.vendorPerson,
      payableIds: [p!.id],
      whtRates: { [p!.id]: 3 },
    });
    await submitPv(db, f.users.finance, pvCreated.id);
    await approvePv(db, f.users.owner, pvCreated.id);
    await markPvPaid(db, f.users.finance, pvCreated.id, {
      paidAt: '2026-11-30',
      payMethod: 'TRANSFER',
    });

    const wb = new ExcelJS.Workbook();
    const buf = await exportMonthly(db, f.users.finance, 'wht', {
      year: 2026,
      month: 11,
    });
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['ภ.ง.ด.3', 'ภ.ง.ด.53']);
    expect(wb.getWorksheet('ภ.ง.ด.3')!.rowCount).toBe(2); // header + 1 data row
    expect(wb.getWorksheet('ภ.ง.ด.53')!.rowCount).toBe(1); // header only
  });

  test('buyer cannot export', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(
      exportMonthly(db, f.users.buyer, 'pv-paid', { year: 2026, month: 11 }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
