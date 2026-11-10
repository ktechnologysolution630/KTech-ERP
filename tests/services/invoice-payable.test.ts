import { beforeEach, describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { eq } from 'drizzle-orm';
import { invoices, pos, vendors } from '@/db/schema';
import { approvePo, createPo, getPo, submitPo } from '@/server/services/po';
import {
  cancelInvoice,
  createInvoice,
  matchInvoice,
  poMoneyFacts,
} from '@/server/services/invoice';
import {
  listOpenPayables,
  requestInstallment,
  requestPrepaid,
} from '@/server/services/payable';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { receiveAll } from '../helpers/receive';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

describe('invoice and payable services', () => {
  let db: Db;
  let f: SeededBasics;
  let creditPo: string;
  let prepaidPo: string;
  let installmentPo: string;

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);

    const cPo = await createPo(db, f.users.buyer, {
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
          qty: D(10),
          unitName: 'ถุง',
          unitPrice: D(107),
          discount: D(0),
        },
      ],
    });
    creditPo = cPo.id;
    await submitPo(db, f.users.buyer, creditPo);
    await approvePo(db, f.users.buyerHead, creditPo);
    await receiveAll(db, f.users.foreman, creditPo);

    const pPo = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'PREPAID',
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'เครื่องมือช่าง',
          qty: D(10),
          unitName: 'ชุด',
          unitPrice: D(107),
          discount: D(0),
        },
      ],
    });
    prepaidPo = pPo.id;
    await submitPo(db, f.users.buyer, prepaidPo);
    await approvePo(db, f.users.buyerHead, prepaidPo);

    const iPo = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'INSTALLMENT',
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'โครงสร้างเหล็ก',
          qty: D(10),
          unitName: 'ชุด',
          unitPrice: D(107),
          discount: D(0),
        },
      ],
      installments: [
        { name: 'มัดจำ 30%', condition: 'BEFORE_PRODUCTION', percent: D(30), amount: D(321) },
        { name: 'งวดสุดท้าย 70%', condition: 'AFTER_DELIVERY', percent: D(70), amount: D(749) },
      ],
    });
    installmentPo = iPo.id;
    await submitPo(db, f.users.buyer, installmentPo);
    await approvePo(db, f.users.buyerHead, installmentPo);
  });

  test('credit invoice creates payable with due date from credit days', async () => {
    const inv = await createInvoice(db, f.users.finance, {
      poId: creditPo,
      invoiceNo: 'IV1',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(70),
    });
    expect(inv.warnings).toEqual([]);
    const [p] = await listOpenPayables(db, f.users.finance, {});
    expect(p).toMatchObject({
      sourceType: 'CREDIT_INVOICE',
      gross: '1070.00',
      dueDate: '2026-12-02',
    });
  });

  test('prepaid: request creates payable, later tax invoice is matched not double-counted', async () => {
    const payableId = await requestPrepaid(db, f.users.buyer, prepaidPo);
    const inv = await createInvoice(db, f.users.finance, {
      poId: prepaidPo,
      invoiceNo: 'TAX-PRE-1',
      invoiceDate: '2026-11-05',
      beforeVat: D(1000),
      vat: D(70),
    });
    expect((await listOpenPayables(db, f.users.finance, {})).length).toBe(1);
    await matchInvoice(db, f.users.finance, inv.id, [
      { payableId, gross: D('1070.00') },
    ]);
    const facts = await poMoneyFacts(db, prepaidPo);
    expect(facts.payablesGross.toFixed(2)).toBe('1070.00');
    expect(facts.matchedGross.toFixed(2)).toBe('1070.00');
  });

  test('second prepaid request with nothing left fails', async () => {
    await requestPrepaid(db, f.users.buyer, prepaidPo);
    await expect(requestPrepaid(db, f.users.buyer, prepaidPo)).rejects.toMatchObject({
      code: 'NOTHING_TO_REQUEST',
    });
  });

  test('installment request marks REQUESTED and creates payable of its amount', async () => {
    const poView = await getPo(db, f.users.buyer, installmentPo);
    const inst1 = poView.installments[0]!;
    const payableId = await requestInstallment(db, f.users.buyer, inst1.id, 'ขอเบิกมัดจำ');
    expect(payableId).toBeTruthy();

    const updatedPo = await getPo(db, f.users.buyer, installmentPo);
    expect(updatedPo.installments[0]!.status).toBe('REQUESTED');

    const [p] = await listOpenPayables(db, f.users.finance, {});
    expect(p).toMatchObject({
      id: payableId,
      sourceType: 'INSTALLMENT',
      gross: '321.00',
      beforeVat: '300.00',
      vat: '21.00',
    });
  });

  test('a credit bill cannot exceed what has been received', async () => {
    await expect(
      createInvoice(db, f.users.finance, {
        poId: creditPo,
        invoiceNo: 'IV-OVER',
        invoiceDate: '2026-11-02',
        beforeVat: D(1100),
        vat: D(77),
      }),
    ).rejects.toMatchObject({ code: 'INVOICE_EXCEEDS_RECEIVED' });
  });

  test('foreman cannot create invoice', async () => {
    await expect(
      createInvoice(db, f.users.foreman, {
        poId: creditPo,
        invoiceNo: 'IV-FORBID',
        invoiceDate: '2026-11-02',
        beforeVat: D(1000),
        vat: D(70),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test('cancelInvoice cancels open CREDIT_INVOICE payable', async () => {
    const inv = await createInvoice(db, f.users.finance, {
      poId: creditPo,
      invoiceNo: 'IV-CANCEL',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(70),
    });
    await cancelInvoice(db, f.users.finance, inv.id, 'ออกใบแจ้งหนี้ผิด');
    expect((await listOpenPayables(db, f.users.finance, {})).length).toBe(0);
  });
});

describe('billing and cheque terms', () => {
  test('a PO takes its vendor terms, and the bill falls due on the cheque round', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await db
      .update(vendors)
      .set({ billingSchedule: 'M:25', creditBasis: 'BILLING', chequeSchedule: 'M:5,20', defaultPayMethod: 'CHEQUE' })
      .where(eq(vendors.id, f.vendorCo));
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ปูน', qty: D(10), unitName: 'ถุง', unitPrice: D(107), discount: D(0) }],
    });
    const [saved] = await db.select().from(pos).where(eq(pos.id, po.id));
    expect(saved).toMatchObject({ billingSchedule: 'M:25', creditBasis: 'BILLING', chequeSchedule: 'M:5,20', payMethod: 'CHEQUE' });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);

    await expect(
      createInvoice(db, f.users.finance, { poId: po.id, invoiceNo: 'IV-T', invoiceDate: '2026-11-10', beforeVat: D(1000), vat: D(70) }),
    ).rejects.toMatchObject({ code: 'NOT_RECEIVED' });

    await receiveAll(db, f.users.owner, po.id, '2026-11-08');
    const inv = await createInvoice(db, f.users.finance, { poId: po.id, invoiceNo: 'IV-T', invoiceDate: '2026-11-10', beforeVat: D(1000), vat: D(70) });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row).toMatchObject({ billingDate: '2026-11-25', dueDate: '2027-01-05' });
    const [p] = await listOpenPayables(db, f.users.finance, {});
    expect(p!.dueDate).toBe('2027-01-05');
  });

  test('terms chosen on the PO override the vendor', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 15,
      terms: { chequeSchedule: 'W:5', creditBasis: 'INVOICE' },
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ทราย', qty: D(1), unitName: 'คิว', unitPrice: D(500), discount: D(0) }],
    });
    const [saved] = await db.select().from(pos).where(eq(pos.id, po.id));
    expect(saved).toMatchObject({ chequeSchedule: 'W:5', creditBasis: 'INVOICE', billingSchedule: '' });
    await expect(
      createPo(db, f.users.buyer, {
        projectId: f.projectA,
        vendorId: f.vendorCo,
        paymentType: 'CREDIT',
        terms: { chequeSchedule: 'M:45' },
        vatMode: 'NONE',
        billDiscount: D(0),
        shipping: D(0),
        lines: [{ description: 'ทราย', qty: D(1), unitName: 'คิว', unitPrice: D(500), discount: D(0) }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TERMS' });
  });
});
