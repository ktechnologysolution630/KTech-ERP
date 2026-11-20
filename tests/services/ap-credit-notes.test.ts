import { beforeEach, describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { approvePo, createPo, reviewPo, submitPo } from '@/server/services/po';
import { cancelInvoice, createInvoice } from '@/server/services/invoice';
import { listOpenPayables } from '@/server/services/payable';
import { approvePv, createPv, getPv, markPvPaid, submitPv } from '@/server/services/pv';
import { issueApCreditNote, listApCreditNotes, voidApCreditNote } from '@/server/services/ap-credit-notes';
import { listJournal, trialBalance } from '@/server/services/gl';
import { inputVatReport } from '@/server/services/accounting';
import { resetSystem, SYSTEM_RESET_CONFIRM } from '@/server/services/system-reset';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { receiveAll } from '../helpers/receive';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

describe('vendor credit note (ใบลดหนี้ผู้ขาย / ส่งคืนสินค้า)', () => {
  let db: Db;
  let f: SeededBasics;
  let invoiceId: string;

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
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
    const inv = await createInvoice(db, f.users.finance, { poId: po.id, invoiceNo: 'IV-001', invoiceDate: '2026-11-02', beforeVat: D(1000), vat: D(70) });
    invoiceId = inv.id;
  });

  test('reverses the bill in the books, nets on the next voucher, and reduces input VAT', async () => {
    const cn = await issueApCreditNote(db, f.users.finance, invoiceId, { docDate: '2026-11-05', vendorDocNo: 'CN-V-9', reason: 'ส่งคืนปูนชำรุด 2 ถุง', gross: 214 });
    expect(cn.number).toMatch(/^PCN-\d{4}-0001$/);

    // The journal mirrors the bill: Dr AP 214 / Cr stock 200 / Cr input VAT 14
    const journal = await listJournal(db, f.users.finance, {});
    const entry = journal.rows.find((r) => r.sourceType === 'AP_CREDIT_NOTE')!;
    expect(entry.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['2110', 214, 0],
      ['1150', 0, 200],
      ['1140', 0, 14],
    ]);

    // Input VAT report lists it as a negative line
    const vat = await inputVatReport(db, f.users.finance, 2026, 11);
    expect(vat.totalVat).toBe(56);
    expect(vat.rows.find((r) => r.key.startsWith('pcn-'))).toMatchObject({ number: 'CN-V-9', vat: -14 });

    // The payment queue has the bill and the credit; a voucher of the credit alone is refused
    const open = await listOpenPayables(db, f.users.finance, {});
    expect(open.map((p) => p.gross).sort()).toEqual(['-214.00', '1070.00']);
    const credit = open.find((p) => p.sourceType === 'CREDIT_NOTE')!;
    await expect(createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [credit.id] })).rejects.toMatchObject({ code: 'PV_NOT_POSITIVE' });

    // Together they pay 856
    const pv = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: open.map((p) => p.id), whtRates: Object.fromEntries(open.map((p) => [p.id, 0])) });
    await submitPv(db, f.users.finance, pv.id);
    await approvePv(db, f.users.owner, pv.id);
    await markPvPaid(db, f.users.finance, pv.id, { paidAt: '2026-11-10', payMethod: 'TRANSFER', payFromAccount: 'KBANK', payRef: 'S1' });
    expect((await getPv(db, f.users.finance, pv.id)).gross).toBe('856.00');

    // AP is cleared in full
    const tb = await trialBalance(db, f.users.finance, { from: '2026-01-01', to: '2026-12-31' });
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    expect(tb.rows.find((r) => r.code === '2110')).toMatchObject({ closingDebit: 0, closingCredit: 0 });

    // Once netted on a voucher it cannot be cancelled
    await expect(voidApCreditNote(db, f.users.finance, cn.id, 'ผิด')).rejects.toMatchObject({ code: 'PAYABLE_IN_USE' });
  });

  test('cannot credit more than the bill; voiding takes it back and lets the bill be cancelled', async () => {
    await expect(issueApCreditNote(db, f.users.finance, invoiceId, { reason: 'x', gross: 1070.01 })).rejects.toMatchObject({ code: 'OVER_BALANCE' });
    const cn = await issueApCreditNote(db, f.users.finance, invoiceId, { reason: 'ลดราคา', gross: 1000 });
    await expect(issueApCreditNote(db, f.users.finance, invoiceId, { reason: 'x', gross: 100 })).rejects.toMatchObject({ code: 'OVER_BALANCE' });
    await expect(cancelInvoice(db, f.users.finance, invoiceId, 'ผิด')).rejects.toMatchObject({ code: 'HAS_CREDIT_NOTE' });

    await voidApCreditNote(db, f.users.finance, cn.id, 'คีย์ผิด');
    const [row] = await listApCreditNotes(db, f.users.finance, { invoiceId });
    expect(row).toMatchObject({ voided: true, payableStatus: 'CANCELLED' });
    expect((await listJournal(db, f.users.finance, {})).rows.filter((r) => r.sourceType === 'AP_CREDIT_NOTE' && r.status === 'POSTED')).toHaveLength(0);
    await cancelInvoice(db, f.users.finance, invoiceId, 'ผิด');

    // Only finance-side roles may issue
    await expect(issueApCreditNote(db, f.users.foreman, invoiceId, { reason: 'x', gross: 1 })).rejects.toMatchObject({ status: 403 });
  });

  test('system reset removes credit notes', async () => {
    await issueApCreditNote(db, f.users.finance, invoiceId, { reason: 'ลดราคา', gross: 107 });
    await resetSystem(db, f.users.owner, SYSTEM_RESET_CONFIRM);
    expect(await listApCreditNotes(db, f.users.finance)).toHaveLength(0);
  });
});
