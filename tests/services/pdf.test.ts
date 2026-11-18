import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { createPo, getPo, submitPo, approvePo } from '@/server/services/po';
import { approvePr, createPr, getPr, submitPr } from '@/server/services/pr';
import { createInvoice } from '@/server/services/invoice';
import { listOpenPayables } from '@/server/services/payable';
import { createPv } from '@/server/services/pv';
import { poLineRefs, renderDocPdf } from '@/server/services/pdf';
import { createTestDb } from '../helpers/test-db';
import { receiveAll } from '../helpers/receive';
import { seedBasics } from '../helpers/fixtures';
import { pdfText } from '../helpers/pdf-text';

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

  test('each PO line on the PDF carries its item code', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(20) }],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const prDoc = await getPr(db, f.users.buyer, pr.id);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        { prLineId: prDoc.lines[0]!.id, itemId: f.itemCement, description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(20), unitPrice: D(120), discount: D(0) },
        { description: 'ค่าขนส่งพิเศษ', unitName: 'เที่ยว', qty: D(1), unitPrice: D(500), discount: D(0) },
      ],
    });
    const lines = (await getPo(db, f.users.buyer, po.id)).lines;

    const refs = await poLineRefs(db, po.id);
    expect(refs.get(lines[0]!.id)).toEqual({ itemCode: 'MAT-001' });
    expect(refs.get(lines[1]!.id)).toEqual({ itemCode: '' });

    const buf = await renderDocPdf(db, f.users.buyer, 'po', po.id);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
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

describe('PO and PR pdfs print the K TECH form', () => {
  // Matched against squashed text: no spaces, see pdfText
  // สำนักงานใหญ่ follows the company's tax ID (the seeded settings: head office, 0105500000000)
  const HEADER_SHOWN = ['KTECHNOLOGYSOLUTIONCO.,LTD.', 'เลขประจำตัวผู้เสียภาษี0105500000000สำนักงานใหญ่'];
  // The head-office label used to sit before the company's tax ID in the header
  const HEADER_GONE = ['KtechnologySolution', 'สำนักงานใหญ่เลขประจำตัวผู้เสียภาษี'];

  test('the PO has three signature boxes and none of the removed fields', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(20) }],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const prDoc = await getPr(db, f.users.buyer, pr.id);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        { prLineId: prDoc.lines[0]!.id, itemId: f.itemCement, description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(20), unitPrice: D(120), discount: D(0) },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);

    const text = await pdfText(await renderDocPdf(db, f.users.buyer, 'po', po.id));

    for (const shown of [...HEADER_SHOWN, 'ผู้จัดซื้อ', 'ผู้จัดการแผนกจัดซื้อ', 'ผู้มีอำนาจลงนาม', 'กำหนดชำระเงิน:', 'ContactDelivery:', 'รหัสสินค้าMAT-001']) {
      expect(text).toContain(shown);
    }
    for (const gone of [
      ...HEADER_GONE,
      'Contact:',
      'Currency',
      'Suppliershall',
      'PR.No.',
      prDoc.number,
      'DownPayment',
      'Retention',
      'หมายเหตุ/เงื่อนไข',
    ]) {
      expect(text).not.toContain(gone);
    }
  });

  test('an installment PO lists its installments under แบ่งชำระ', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'INSTALLMENT',
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'โครงสร้างเหล็กสั่งผลิต', unitName: 'ตัน', qty: D(1), unitPrice: D(10000), discount: D(0) }],
      installments: [
        { name: 'มัดจำ', condition: 'BEFORE_PRODUCTION', percent: D(30) },
        { name: 'ส่งมอบ', condition: 'AFTER_DELIVERY', percent: D(70) },
      ],
    });

    const text = await pdfText(await renderDocPdf(db, f.users.buyer, 'po', po.id));

    expect(text).toContain('แบ่งชำระ:');
    expect(text).toContain('งวดที่1มัดจำ3,000.00บาท');
    expect(text).toContain('งวดที่2ส่งมอบ7,000.00บาท');
    expect(text).not.toContain('DownPayment');
  });

  test('the PR has the same header and no Contact row', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [{ description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(20) }],
    });

    const text = await pdfText(await renderDocPdf(db, f.users.foreman, 'pr', pr.id));

    for (const shown of HEADER_SHOWN) expect(text).toContain(shown);
    for (const gone of [...HEADER_GONE, 'Contact:', 'Currency']) expect(text).not.toContain(gone);
  });
});
