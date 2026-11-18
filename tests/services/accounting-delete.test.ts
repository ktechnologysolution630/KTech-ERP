import { describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { activityLogs, arInvoices, arReceipts, customers, invoices, payables, projects, pvs, salesDocs, whtCerts } from '@/db/schema';
import { D } from '@/domain/money';
import {
  ACCOUNTING_WIPE_CONFIRM,
  deleteAccountCategories,
  deleteAdvances,
  deleteApInvoices,
  deleteArCreditNotes,
  deleteArInvoices,
  deleteCompanyAccounts,
  deleteCustomers,
  deletePvs,
  deleteReceiptSubstitutes,
  deleteSalesDocs,
  MUST_CANCEL_FIRST,
  previewAccountingWipe,
  wipeAccounting,
} from '@/server/services/accounting-delete';
import { saveAccountCategory } from '@/server/services/account-categories';
import {
  cancelAdvance,
  createReceiptSubstitute,
  decideAdvance,
  payAdvance,
  requestAdvance,
} from '@/server/services/advances';
import {
  createArInvoice,
  issueArCreditNote,
  issueArInvoice,
  recordArReceipt,
  upsertCustomer,
  voidArCreditNote,
  voidArInvoice,
  voidArReceipt,
} from '@/server/services/ar';
import { setNextDocNumber } from '@/server/services/doc-numbers';
import { cancelInvoice, createInvoice } from '@/server/services/invoice';
import { listOpenPayables, requestInstallment } from '@/server/services/payable';
import { approvePo, createPo, getPo, reviewPo, submitPo } from '@/server/services/po';
import { approvePv, cancelPv, createPv, markPvPaid, submitPv } from '@/server/services/pv';
import { cancelSalesDoc, createSalesDoc, saveCompanyAccount } from '@/server/services/sales-docs';
import '@/server/services/wht-cert';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { EARLY_PAY_REASON, receiveAll } from '../helpers/receive';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  return { db, f };
}

const sale = (db: Db, f: SeededBasics, kind: 'QT' | 'TI' | 'RC' = 'TI') =>
  createSalesDoc(db, f.users.finance, { kind, docDate: '2026-11-10', customerName: 'บริษัท ลูกค้า จำกัด', vatMode: 'EXCLUSIVE', lines: [{ name: 'งานติดตั้ง', qty: 1, unitPrice: 1000 }] });

async function customerWithInvoice(db: Db, f: SeededBasics) {
  const customer = await upsertCustomer(db, f.users.finance, { code: 'C-001', name: 'บริษัท ลูกค้าทดสอบ จำกัด', creditDays: 30 });
  const { id } = await createArInvoice(db, f.users.finance, {
    customerId: customer.id,
    projectId: f.projectA,
    vatMode: 'EXCLUSIVE',
    lines: [{ description: 'งานงวดที่ 1', qty: 1, unitPrice: 10_000 }],
  });
  return { customer, invoiceId: id };
}

/** A credit PO received in full with its vendor bill keyed in: one open payable */
async function billedPo(db: Db, f: SeededBasics, invoiceNo = 'IV-001') {
  const po = await createPo(db, f.users.buyer, {
    projectId: f.projectA,
    vendorId: f.vendorCo,
    paymentType: 'CREDIT',
    creditDays: 30,
    vatMode: 'INCLUSIVE',
    billDiscount: D(0),
    shipping: D(0),
    lines: [{ description: 'ปูนซีเมนต์', qty: D(10), unitName: 'ถุง', unitPrice: D(107), discount: D(0) }],
  });
  await submitPo(db, f.users.buyer, po.id);
  await reviewPo(db, f.users.buyerHead, po.id);
  await approvePo(db, f.users.buyerHead, po.id);
  await receiveAll(db, f.users.foreman, po.id);
  const inv = await createInvoice(db, f.users.finance, { poId: po.id, invoiceNo, invoiceDate: '2026-11-02', beforeVat: D(1000), vat: D(70) });
  const [payable] = await listOpenPayables(db, f.users.finance, {});
  return { poId: po.id, invoiceId: inv.id, payableId: payable!.id };
}

describe('deleting accounting documents', () => {
  test('only the owner and admin may delete', async () => {
    const { db, f } = await setup();
    const doc = await sale(db, f);
    await expect(deleteSalesDocs(db, f.users.finance, [doc.id])).rejects.toMatchObject({ status: 403 });
    await expect(wipeAccounting(db, f.users.finance, ACCOUNTING_WIPE_CONFIRM)).rejects.toMatchObject({ status: 403 });
  });

  test('an issued tax invoice must be cancelled first, and its number is never handed out again', async () => {
    const { db, f } = await setup();
    const doc = await sale(db, f);
    expect((await deleteSalesDocs(db, f.users.owner, [doc.id])).kept).toEqual([{ id: doc.id, number: doc.number, reason: MUST_CANCEL_FIRST }]);

    await cancelSalesDoc(db, f.users.finance, doc.id, 'คีย์ผิด');
    const result = await deleteSalesDocs(db, f.users.admin, [doc.id]);
    expect(result).toEqual({ deleted: [{ id: doc.id, number: doc.number }], kept: [] });
    expect(await db.select().from(salesDocs).where(eq(salesDocs.id, doc.id))).toHaveLength(0);
    const [log] = await db.select().from(activityLogs).where(and(eq(activityLogs.entityId, doc.id), eq(activityLogs.action, 'DELETE')));
    expect(log).toMatchObject({ action: 'DELETE', data: { deletedNumbers: [doc.number] } });

    // Even with the counter set back by hand, the next tax invoice skips the deleted number
    await setNextDocNumber(db, f.users.owner, { key: 'TI', next: 1 });
    const next = await sale(db, f);
    expect(next.number).not.toBe(doc.number);
  });

  test('a customer invoice goes once voided, with its voided receipts; a live receipt holds it', async () => {
    const { db, f } = await setup();
    const { invoiceId } = await customerWithInvoice(db, f);
    const invoiceNumber = await issueArInvoice(db, f.users.finance, invoiceId);
    const rc = await recordArReceipt(db, f.users.finance, invoiceId, { amountReceived: 5_000 });

    expect((await deleteArInvoices(db, f.users.owner, [invoiceId])).kept[0]!.reason).toBe(MUST_CANCEL_FIRST);
    await expect(voidArInvoice(db, f.users.finance, invoiceId, 'ผิด')).rejects.toMatchObject({ code: 'INVOICE_HAS_MOVEMENTS' });

    await voidArReceipt(db, f.users.finance, rc.id, 'ผิด');
    await voidArInvoice(db, f.users.finance, invoiceId, 'ผิด');
    expect(await deleteArInvoices(db, f.users.owner, [invoiceId])).toEqual({ deleted: [{ id: invoiceId, number: invoiceNumber }], kept: [] });
    expect(await db.select().from(arInvoices).where(eq(arInvoices.id, invoiceId))).toHaveLength(0);
    expect(await db.select().from(arReceipts).where(eq(arReceipts.id, rc.id))).toHaveLength(0);
  });

  test('a draft customer invoice goes straight away', async () => {
    const { db, f } = await setup();
    const { invoiceId } = await customerWithInvoice(db, f);
    expect((await deleteArInvoices(db, f.users.owner, [invoiceId])).deleted).toHaveLength(1);
  });

  test('a credit note is voided, then deleted; the invoice owes its amount again', async () => {
    const { db, f } = await setup();
    const { invoiceId } = await customerWithInvoice(db, f);
    await issueArInvoice(db, f.users.finance, invoiceId);
    const cn = await issueArCreditNote(db, f.users.finance, invoiceId, { reason: 'ลดราคา', gross: 1_000 });

    expect((await deleteArCreditNotes(db, f.users.owner, [cn.id])).kept[0]!.reason).toBe(MUST_CANCEL_FIRST);
    await voidArCreditNote(db, f.users.finance, cn.id, 'ออกผิด');
    expect((await deleteArCreditNotes(db, f.users.owner, [cn.id])).deleted).toEqual([{ id: cn.id, number: cn.number }]);
    const [inv] = await db.select().from(arInvoices).where(eq(arInvoices.id, invoiceId));
    expect(inv!.status).toBe('ISSUED');
  });

  test('a customer with an invoice stays; one without goes and leaves its project', async () => {
    const { db, f } = await setup();
    const { customer } = await customerWithInvoice(db, f);
    const spare = await upsertCustomer(db, f.users.finance, { code: 'C-002', name: 'ลูกค้าทดลอง' });
    await db.update(projects).set({ customerId: spare.id }).where(eq(projects.id, f.projectB));

    const result = await deleteCustomers(db, f.users.owner, [customer.id, spare.id]);
    expect(result.deleted.map((d) => d.id)).toEqual([spare.id]);
    expect(result.kept[0]).toMatchObject({ id: customer.id });
    expect(await db.select().from(customers).where(eq(customers.id, spare.id))).toHaveLength(0);
    const [project] = await db.select().from(projects).where(eq(projects.id, f.projectB));
    expect(project!.customerId).toBeNull();
  });

  test('a vendor bill goes once cancelled, with the payable it raised', async () => {
    const { db, f } = await setup();
    const { invoiceId, payableId } = await billedPo(db, f);
    expect((await deleteApInvoices(db, f.users.owner, [invoiceId])).kept[0]!.reason).toBe(MUST_CANCEL_FIRST);

    await cancelInvoice(db, f.users.finance, invoiceId, 'คีย์ซ้ำ');
    expect((await deleteApInvoices(db, f.users.owner, [invoiceId])).deleted).toHaveLength(1);
    expect(await db.select().from(invoices).where(eq(invoices.id, invoiceId))).toHaveLength(0);
    expect(await db.select().from(payables).where(eq(payables.id, payableId))).toHaveLength(0);
  });

  test('a vendor bill that sat in a cancelled PV waits for that PV to go first', async () => {
    const { db, f } = await setup();
    const { invoiceId, payableId } = await billedPo(db, f);
    const pv = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [payableId] });
    await cancelPv(db, f.users.finance, pv.id, 'ทำใหม่');
    await cancelInvoice(db, f.users.finance, invoiceId, 'คีย์ซ้ำ');

    const held = await deleteApInvoices(db, f.users.owner, [invoiceId]);
    expect(held.kept[0]!.reason).toContain(pv.number);
    await deletePvs(db, f.users.owner, [pv.id]);
    expect((await deleteApInvoices(db, f.users.owner, [invoiceId])).deleted).toHaveLength(1);
  });

  test('a draft PV goes and its bill waits to be paid again; an approved or paid PV stays', async () => {
    const { db, f } = await setup();
    const { payableId } = await billedPo(db, f);
    const draft = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [payableId] });
    expect((await db.select().from(payables).where(eq(payables.id, payableId)))[0]!.status).toBe('IN_PV');

    expect((await deletePvs(db, f.users.owner, [draft.id])).deleted).toHaveLength(1);
    expect((await db.select().from(payables).where(eq(payables.id, payableId)))[0]!.status).toBe('OPEN');

    const pv = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [payableId], whtRates: { [payableId]: 3 } });
    await submitPv(db, f.users.finance, pv.id);
    await approvePv(db, f.users.owner, pv.id, EARLY_PAY_REASON);
    expect((await deletePvs(db, f.users.owner, [pv.id])).kept[0]!.reason).toContain('อนุมัติแล้ว');
    await markPvPaid(db, f.users.finance, pv.id, { paidAt: '2026-11-03', payMethod: 'TRANSFER', payFromAccount: 'KBANK-001', payRef: 'SLIP-001' });
    expect((await deletePvs(db, f.users.owner, [pv.id])).kept[0]!.reason).toContain('จ่ายเงินแล้ว');
  });

  test('an advance not paid goes and frees its trip costs; an approved one must be cancelled; a paid one stays', async () => {
    const { db, f } = await setup();
    const pending = await requestAdvance(db, f.users.foreman, { projectId: f.projectA, purpose: 'ซื้อวัสดุ', amount: 1_000 });
    const approved = await requestAdvance(db, f.users.foreman, { projectId: f.projectA, purpose: 'ค่าแรง', amount: 2_000 });
    await decideAdvance(db, f.users.owner, approved.id, true, '');
    const paid = await requestAdvance(db, f.users.foreman, { projectId: f.projectA, purpose: 'ค่าขนส่ง', amount: 3_000 });
    await decideAdvance(db, f.users.owner, paid.id, true, '');
    await payAdvance(db, f.users.finance, paid.id);

    const result = await deleteAdvances(db, f.users.owner, [pending.id, approved.id, paid.id]);
    expect(result.deleted.map((d) => d.id)).toEqual([pending.id]);
    expect(result.kept.map((k) => k.id).sort()).toEqual([approved.id, paid.id].sort());

    await cancelAdvance(db, f.users.owner, approved.id);
    expect((await deleteAdvances(db, f.users.owner, [approved.id])).deleted).toHaveLength(1);
  });

  test('a draft receipt substitute goes', async () => {
    const { db, f } = await setup();
    const rs = await createReceiptSubstitute(db, f.users.foreman, { lines: [{ spentOn: '2026-11-02', description: 'ค่าแรงขนย้าย', paidTo: 'นายสมชาย', amount: 500 }] });
    expect((await deleteReceiptSubstitutes(db, f.users.owner, [rs.id])).deleted).toHaveLength(1);
  });

  test('a bank account money went through stays; an unused one and a category go', async () => {
    const { db, f } = await setup();
    const used = await saveCompanyAccount(db, f.users.finance, { bank: 'ธนาคารกสิกรไทย', accountName: 'บจก. ทดสอบ', accountNo: '111-1', openingBalance: 0 });
    const unused = await saveCompanyAccount(db, f.users.finance, { bank: 'ธนาคารกรุงไทย', accountName: 'บจก. ทดสอบ', accountNo: '222-2', openingBalance: 0 });
    await createSalesDoc(db, f.users.finance, { kind: 'INC', docDate: '2026-11-11', customerName: 'ร้านรับซื้อเศษเหล็ก', accountId: used, vatMode: 'NONE', lines: [{ name: 'ขายเศษเหล็ก', qty: 1, unitPrice: 2500 }] });

    const result = await deleteCompanyAccounts(db, f.users.owner, [used, unused]);
    expect(result.deleted.map((d) => d.id)).toEqual([unused]);
    expect(result.kept[0]!.reason).toContain('1 ใบ');

    const category = await saveAccountCategory(db, f.users.owner, { code: 'X-01', name: 'หมวดทดสอบ', type: 'EXPENSE' });
    expect((await deleteAccountCategories(db, f.users.owner, [category])).deleted).toHaveLength(1);
  });
});

describe('wiping all accounting documents', () => {
  test('asks for the exact words first', async () => {
    const { db, f } = await setup();
    await expect(wipeAccounting(db, f.users.owner, 'ลบ')).rejects.toMatchObject({ code: 'INVALID_CONFIRMATION' });
  });

  test('removes every accounting document and lets the purchasing side be paid again', async () => {
    const { db, f } = await setup();
    const account = await saveCompanyAccount(db, f.users.finance, { bank: 'ธนาคารกสิกรไทย', accountName: 'บจก. ทดสอบ', accountNo: '111-1', openingBalance: 50_000 });
    const tax = await sale(db, f);
    const { customer, invoiceId } = await customerWithInvoice(db, f);
    await issueArInvoice(db, f.users.finance, invoiceId);
    await recordArReceipt(db, f.users.finance, invoiceId, { amountReceived: 5_000 });

    // A paid bill: PV paid with a withholding-tax certificate
    const { poId, payableId } = await billedPo(db, f);
    const pv = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [payableId], whtRates: { [payableId]: 3 } });
    await submitPv(db, f.users.finance, pv.id);
    await approvePv(db, f.users.owner, pv.id, EARLY_PAY_REASON);
    await markPvPaid(db, f.users.finance, pv.id, { paidAt: '2026-11-03', payMethod: 'TRANSFER', payFromAccount: 'KBANK-001', payRef: 'SLIP-001' });

    // A paid PO instalment: its payable must wait in the queue again
    const instPo = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'INSTALLMENT',
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'โครงสร้างเหล็ก', qty: D(10), unitName: 'ชุด', unitPrice: D(107), discount: D(0) }],
      installments: [
        { name: 'มัดจำ 30%', condition: 'BEFORE_PRODUCTION', percent: D(30), amount: D(321) },
        { name: 'งวดสุดท้าย 70%', condition: 'AFTER_DELIVERY', percent: D(70), amount: D(749) },
      ],
    });
    await submitPo(db, f.users.buyer, instPo.id);
    await reviewPo(db, f.users.buyerHead, instPo.id);
    await approvePo(db, f.users.buyerHead, instPo.id);
    const inst = (await getPo(db, f.users.buyer, instPo.id)).installments[0]!;
    const instPayable = await requestInstallment(db, f.users.buyer, inst.id);
    const instPv = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [instPayable] });
    await submitPv(db, f.users.finance, instPv.id);
    await approvePv(db, f.users.owner, instPv.id);
    await markPvPaid(db, f.users.finance, instPv.id, { paidAt: '2026-11-03', payMethod: 'TRANSFER', payFromAccount: 'KBANK-001', payRef: 'SLIP-002' });

    // Received and paid in full, the credit PO closed itself
    expect((await getPo(db, f.users.buyer, poId)).status).toBe('COMPLETED');

    const preview = await previewAccountingWipe(db, f.users.owner);
    expect(preview.documents).toEqual(
      expect.arrayContaining([
        { label: 'ใบกำกับภาษี', count: 1 },
        { label: 'ใบแจ้งหนี้/วางบิล (ลูกค้า)', count: 1 },
        { label: 'ใบสำคัญจ่าย (PV)', count: 2 },
        { label: 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)', count: 1 },
      ]),
    );

    await wipeAccounting(db, f.users.admin, ` ${ACCOUNTING_WIPE_CONFIRM} `);

    for (const table of [salesDocs, arInvoices, arReceipts, invoices, pvs, whtCerts]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
    // The vendor bill's payable went with it; the instalment's waits to be paid again
    expect(await db.select().from(payables).where(eq(payables.id, payableId))).toHaveLength(0);
    expect((await db.select().from(payables).where(eq(payables.id, instPayable)))[0]!.status).toBe('OPEN');
    expect((await getPo(db, f.users.buyer, instPo.id)).installments[0]!.status).toBe('REQUESTED');
    expect((await getPo(db, f.users.buyer, poId)).status).toBe('ORDERED');
    // Master data stays
    expect(await db.select().from(customers).where(eq(customers.id, customer.id))).toHaveLength(1);
    void account;

    const [log] = await db.select().from(activityLogs).where(eq(activityLogs.action, 'WIPE'));
    expect(log!.entityType).toBe('ACCOUNTING');
    expect((log!.data as { deletedNumbers: string[] }).deletedNumbers).toContain(tax.number);
    expect((log!.data as { deletedNumbers: string[] }).deletedNumbers).toContain(pv.number);
  });
});
