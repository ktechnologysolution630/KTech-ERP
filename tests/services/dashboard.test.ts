import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { payables } from '@/db/schema';
import { D } from '@/domain/money';
import { createPo, submitPo, approvePo } from '@/server/services/po';
import { createInvoice } from '@/server/services/invoice';
import { requestPrepaid } from '@/server/services/payable';
import { createPv, submitPv, approvePv, markPvPaid } from '@/server/services/pv';
import { getDashboardOverview, getOwnerDashboard } from '@/server/services/dashboard';
import { createArInvoice, issueArCreditNote, issueArInvoice, recordArReceipt, upsertCustomer } from '@/server/services/ar';
import { compactNumber, niceAxisMax } from '@/domain/chart';
import { bangkokDateString } from '@/domain/thai';
import { createTestDb } from '../helpers/test-db';
import { EARLY_PAY_REASON, receiveAll } from '../helpers/receive';
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

    await receiveAll(db, f.users.owner, po.id);
    await createInvoice(db, f.users.finance, {
      poId: po.id,
      invoiceNo: 'IV-SOON',
      invoiceDate: '2026-10-25',
      beforeVat: D(1000),
      vat: D(0),
      dueDate: '2026-11-05',
    });

    await receiveAll(db, f.users.owner, po.id);
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
    await approvePv(db, f.users.owner, pv.id, EARLY_PAY_REASON);
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


describe('dashboard overview', () => {
  test('axis helpers give clean scales', () => {
    expect(niceAxisMax(0)).toBe(1);
    expect(niceAxisMax(120_000)).toBe(200_000);
    expect(niceAxisMax(2_100)).toBe(2_500);
    expect(niceAxisMax(1_000)).toBe(1_000);
    expect(compactNumber(1_500)).toBe('1.5K');
    expect(compactNumber(2_000_000)).toBe('2M');
    expect(compactNumber(950)).toBe('950');
  });

  test('sums cash, ages receivables and payables, and flags projects', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const now = new Date('2026-11-15T05:00:00Z');
    const today = bangkokDateString(now);

    await expect(getDashboardOverview(db, f.users.pm)).rejects.toMatchObject({ status: 403 });
    const empty = await getDashboardOverview(db, f.users.owner, { today: now });
    expect(empty).toMatchObject({ cashInYtd: 0, cashOutYtd: 0, netYtd: 0, projectCounts: { open: 2 } });
    expect(empty.monthly).toHaveLength(12);

    // Income: 107,000 bill overdue by 15 days, 50,000 + 1,000 WHT received, 10,700 credited
    const customer = await upsertCustomer(db, f.users.finance, { code: 'C-1', name: 'ลูกค้า', creditDays: 30 });
    const { id: invoiceId } = await createArInvoice(db, f.users.finance, {
      customerId: customer.id,
      projectId: f.projectA,
      docDate: '2026-10-01',
      dueDate: '2026-10-31',
      vatMode: 'EXCLUSIVE',
      lines: [{ description: 'งวดที่ 1', qty: 1, unitPrice: 100_000 }],
    });
    await issueArInvoice(db, f.users.finance, invoiceId);
    await recordArReceipt(db, f.users.finance, invoiceId, { amountReceived: 50_000, whtAmount: 1_000, receiptDate: today });
    await issueArCreditNote(db, f.users.finance, invoiceId, { gross: 10_700, reason: 'ปรับลด', docDate: today });

    // Expense: 1,000 credit invoice paid; a second 500 invoice left open and not yet due
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
    await receiveAll(db, f.users.owner, po.id);
    const paid = await createInvoice(db, f.users.finance, { poId: po.id, invoiceNo: 'IV-A', invoiceDate: today, beforeVat: D(1000), vat: D(0), dueDate: '2026-12-01' });
    await receiveAll(db, f.users.owner, po.id);
    await createInvoice(db, f.users.finance, { poId: po.id, invoiceNo: 'IV-B', invoiceDate: today, beforeVat: D(500), vat: D(0), dueDate: '2026-12-01' });
    const [paidPayable] = await db.select().from(payables).where(eq(payables.invoiceId, paid.id));
    const pv = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [paidPayable!.id] });
    await submitPv(db, f.users.finance, pv.id);
    await approvePv(db, f.users.owner, pv.id, EARLY_PAY_REASON);
    await markPvPaid(db, f.users.finance, pv.id, { paidAt: today, payMethod: 'TRANSFER', payFromAccount: 'K-1', payRef: 'S-1' });

    const o = await getDashboardOverview(db, f.users.finance, { today: now });
    expect(o).toMatchObject({
      cashInYtd: 51_000,
      cashOutYtd: 1_000,
      netYtd: 50_000,
      thisMonth: { cashIn: 51_000, cashOut: 1_000 },
      // 107,000 − 51,000 settled − 10,700 credited
      receivable: { total: 45_300, overdue: 45_300, invoices: 1 },
      payable: { total: 500, overdue: 0, items: 1 },
      expenseMix: [{ label: 'ค่าวัสดุ/สั่งซื้อ (PO)', amount: 1_000 }],
    });
    expect(o.aging.find((a) => a.bucket === 'D1_30')).toMatchObject({ receivable: 45_300, payable: 0 });
    expect(o.aging.find((a) => a.bucket === 'NOT_DUE')).toMatchObject({ receivable: 0, payable: 500 });
    expect(o.projects.find((p) => p.id === f.projectA)).toMatchObject({ cost: 1_500, received: 51_000, overBudget: false });
  });
});