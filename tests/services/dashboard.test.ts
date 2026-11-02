import { describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { createPo, submitPo, approvePo } from '@/server/services/po';
import { createInvoice } from '@/server/services/invoice';
import { requestPrepaid } from '@/server/services/payable';
import { createPv, submitPv, approvePv, markPvPaid } from '@/server/services/pv';
import { getOwnerDashboard } from '@/server/services/dashboard';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

describe('dashboard service', () => {
  test('dashboard dueSoon/overdue split by today', async () => {
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
      lines: [{ description: 'วัสดุ', unitName: 'ชุด', qty: D(2), unitPrice: D(1000), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);

    await createInvoice(db, f.users.finance, {
      poId: po.id,
      invoiceNo: 'IV-SOON',
      invoiceDate: '2026-10-25',
      beforeVat: D(1000),
      vat: D(0),
      dueDate: '2026-11-05',
    });

    await createInvoice(db, f.users.finance, {
      poId: po.id,
      invoiceNo: 'IV-OVERDUE',
      invoiceDate: '2026-10-01',
      beforeVat: D(1000),
      vat: D(0),
      dueDate: '2026-10-30',
    });

    const dash = await getOwnerDashboard(db, f.users.owner, {
      today: new Date('2026-11-02T03:00:00Z'),
    });
    expect(dash.dueSoon.length).toBe(1);
    expect(dash.dueSoon[0]!.dueDate).toBe('2026-11-05');
    expect(dash.overdue.length).toBe(1);
    expect(dash.overdue[0]!.dueDate).toBe('2026-10-30');
    expect(dash.outstandingByVendor.length).toBe(1);
    expect(dash.outstandingByVendor[0]!.gross).toBe('2000.00');
  });

  test('paidNotReceived lists prepaid PO after payment', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'PREPAID',
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'เครื่องปั่นไฟ', unitName: 'เครื่อง', qty: D(1), unitPrice: D(15000), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);

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

    const dash = await getOwnerDashboard(db, f.users.owner, {
      today: new Date('2026-11-02T03:00:00Z'),
    });
    expect(dash.paidNotReceived.length).toBe(1);
    expect(dash.paidNotReceived[0]).toMatchObject({
      poId: po.id,
      amount: '15000.00',
    });
  });
});
