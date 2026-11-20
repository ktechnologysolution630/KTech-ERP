import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { journalEntries } from '@/db/schema';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { createArInvoice, issueArInvoice, recordArReceipt, upsertCustomer, voidArReceipt } from '@/server/services/ar';
import { cancelSalesDoc, createSalesDoc } from '@/server/services/sales-docs';
import { listGlAccounts, listJournal, repostAll, saveGlAccount, trialBalance } from '@/server/services/gl';
import { resetSystem, SYSTEM_RESET_CONFIRM } from '@/server/services/system-reset';

const RANGE = { from: '2026-01-01', to: '2026-12-31' };

describe('Auto-GL', () => {
  test('an issued invoice and its receipt post balanced entries; voiding the receipt voids its entry', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const customer = await upsertCustomer(db, f.users.finance, { code: 'C-001', name: 'บริษัท ลูกค้า จำกัด', taxId: '0994000123456' });
    const { id } = await createArInvoice(db, f.users.finance, {
      customerId: customer.id,
      docDate: '2026-11-01',
      vatMode: 'EXCLUSIVE',
      lines: [{ description: 'ขายสินค้า', qty: 1, unitPrice: 100_000 }],
    });
    // A draft posts nothing
    expect((await listJournal(db, f.users.finance, {})).total).toBe(0);
    await issueArInvoice(db, f.users.finance, id);
    const rc = await recordArReceipt(db, f.users.finance, id, { amountReceived: 104_000, whtAmount: 3_000, receiptDate: '2026-11-10', method: 'TRANSFER' });

    const journal = await listJournal(db, f.users.finance, {});
    expect(journal.total).toBe(2);
    const iv = journal.rows.find((r) => r.sourceType === 'AR_INVOICE')!;
    expect(iv.number).toMatch(/^JV-\d{4}-0001$/);
    expect(iv.lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['1130', 107000, 0],
      ['4100', 0, 100000],
      ['2121', 0, 7000],
    ]);

    let tb = await trialBalance(db, f.users.finance, RANGE);
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    expect(tb.rows.find((r) => r.code === '1130')).toMatchObject({ closingDebit: 0, closingCredit: 0 });
    expect(tb.rows.find((r) => r.code === '2120')).toMatchObject({ closingCredit: 7000 });

    await voidArReceipt(db, f.users.finance, rc.id, 'บันทึกผิด');
    expect((await listJournal(db, f.users.finance, {})).total).toBe(1);
    tb = await trialBalance(db, f.users.finance, RANGE);
    expect(tb.rows.find((r) => r.code === '1130')).toMatchObject({ closingDebit: 107000 });

    // Other staff cannot read the books
    await expect(listJournal(db, f.users.foreman, {})).rejects.toMatchObject({ status: 403 });
  });

  test('sales documents post and unpost; re-posting is idempotent and catches documents made before', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const rc = await createSalesDoc(db, f.users.finance, { kind: 'RC', docDate: '2026-11-10', customerName: 'ก', payMethod: 'CASH', whtRate: 3, lines: [{ name: 'ขายสินค้า', qty: 1, unitPrice: 10000 }] });
    await createSalesDoc(db, f.users.finance, { kind: 'QT', docDate: '2026-11-10', customerName: 'ก', lines: [{ name: 'เสนอราคา', qty: 1, unitPrice: 5 }] });
    expect((await listJournal(db, f.users.finance, {})).total).toBe(1);

    // As if the receipt was made before Auto-GL existed
    await db.delete(journalEntries).where(eq(journalEntries.sourceId, rc.id));
    expect(await repostAll(db, f.users.finance)).toMatchObject({ posted: 1 });
    expect(await repostAll(db, f.users.finance)).toMatchObject({ posted: 0, unchanged: 1 });

    await cancelSalesDoc(db, f.users.finance, rc.id, 'ยกเลิก');
    const all = await listJournal(db, f.users.finance, { includeVoid: true });
    expect(all.rows.map((r) => r.status)).toEqual(['VOID']);
    const accounts = await listGlAccounts(db, f.users.finance);
    expect(accounts.find((a) => a.code === '1110')).toMatchObject({ systemKey: 'CASH', balance: 0, used: true });
  });

  test('the chart can be extended but system accounts cannot be switched off; reset clears the books', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const cash = (await listGlAccounts(db, f.users.finance)).find((a) => a.systemKey === 'CASH')!;
    await expect(saveGlAccount(db, f.users.finance, { id: cash.id, code: cash.code, name: cash.name, type: 'ASSET', active: false })).rejects.toMatchObject({ code: 'SYSTEM_ACCOUNT' });
    await saveGlAccount(db, f.users.finance, { code: '1121', name: 'ธนาคารกสิกรไทย ออมทรัพย์', type: 'ASSET' });
    await expect(saveGlAccount(db, f.users.finance, { code: '1121', name: 'ซ้ำ', type: 'ASSET' })).rejects.toMatchObject({ status: 409 });

    await createSalesDoc(db, f.users.finance, { kind: 'INC', docDate: '2026-11-10', customerName: 'ก', lines: [{ name: 'ขายเศษวัสดุ', qty: 1, unitPrice: 500 }] });
    await resetSystem(db, f.users.owner, SYSTEM_RESET_CONFIRM);
    expect((await listJournal(db, f.users.finance, { includeVoid: true })).total).toBe(0);
    expect((await listGlAccounts(db, f.users.finance)).some((a) => a.code === '1121')).toBe(true);
  });
});
