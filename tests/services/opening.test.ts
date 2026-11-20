import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { recordArReceipt, upsertCustomer } from '@/server/services/ar';
import { listGlAccounts, listJournal, repostAll, trialBalance } from '@/server/services/gl';
import { listOpenPayables } from '@/server/services/payable';
import { approvePv, createPv, markPvPaid, submitPv } from '@/server/services/pv';
import { addApOpening, addArOpening, getOpeningOverview, removeArOpening, saveOpeningEntry } from '@/server/services/opening';

const RANGE = { from: '2026-01-01', to: '2026-12-31' };

describe('opening balances (ยอดยกมา)', () => {
  test('opening entry, opening AR and AP detail, then receipt and payment clear them', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const acc = new Map((await listGlAccounts(db, f.users.finance)).map((a) => [a.code, a.id]));

    // Unbalanced is refused
    await expect(
      saveOpeningEntry(db, f.users.finance, { date: '2026-01-01', lines: [{ accountId: acc.get('1120')!, debit: 100, credit: 0 }] }),
    ).rejects.toMatchObject({ code: 'GL_UNBALANCED' });

    const lines = [
      { accountId: acc.get('1120')!, debit: 50_000, credit: 0 },
      { accountId: acc.get('1130')!, debit: 10_700, credit: 0 },
      { accountId: acc.get('2110')!, debit: 0, credit: 5_350 },
      { accountId: acc.get('3100')!, debit: 0, credit: 55_350 },
    ];
    await saveOpeningEntry(db, f.users.finance, { date: '2026-01-01', lines });
    // Saving again replaces, it does not add
    await saveOpeningEntry(db, f.users.finance, { date: '2026-01-01', lines });
    expect((await listJournal(db, f.users.finance, {})).rows.filter((r) => r.sourceType === 'OPENING' && r.status === 'POSTED')).toHaveLength(1);

    const customer = await upsertCustomer(db, f.users.finance, { code: 'C-1', name: 'ลูกค้าเก่า' });
    const arId = await addArOpening(db, f.users.finance, { customerId: customer.id, number: 'IV6612-009', docDate: '2025-12-20', dueDate: '2026-01-20', gross: 10_700 });
    await addApOpening(db, f.users.finance, { vendorId: f.vendorCo, docNo: 'B-77', dueDate: '2026-01-31', gross: 5_350, vat: 350 });

    let o = await getOpeningOverview(db, f.users.finance);
    expect(o.check).toEqual({ arDetail: 10_700, arLedger: 10_700, apDetail: 5_350, apLedger: 5_350 });

    // Opening detail posts nothing itself, and a full re-post keeps the opening entry
    await repostAll(db, f.users.finance);
    expect((await listJournal(db, f.users.finance, {})).rows.filter((r) => r.status === 'POSTED').map((r) => r.sourceType)).toEqual(['OPENING']);

    // Receive the old customer bill and pay the old supplier bill
    await recordArReceipt(db, f.users.finance, arId, { amountReceived: 10_700, receiptDate: '2026-01-15', method: 'TRANSFER' });
    await expect(removeArOpening(db, f.users.finance, arId)).rejects.toMatchObject({ code: 'INVOICE_HAS_MOVEMENTS' });
    const [p] = await listOpenPayables(db, f.users.finance, {});
    const pv = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [p!.id], whtRates: { [p!.id]: 0 } });
    await submitPv(db, f.users.finance, pv.id);
    await approvePv(db, f.users.owner, pv.id);
    await markPvPaid(db, f.users.finance, pv.id, { paidAt: '2026-01-31', payMethod: 'TRANSFER', payFromAccount: 'K', payRef: '1' });

    const tb = await trialBalance(db, f.users.finance, RANGE);
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    expect(tb.rows.find((r) => r.code === '1130')).toMatchObject({ closingDebit: 0, closingCredit: 0 });
    expect(tb.rows.find((r) => r.code === '2110')).toMatchObject({ closingDebit: 0, closingCredit: 0 });
    expect(tb.rows.find((r) => r.code === '1120')).toMatchObject({ closingDebit: 55_350 });

    o = await getOpeningOverview(db, f.users.finance);
    expect(o.ar[0]!.status).toBe('PAID');

    // Site staff cannot set opening balances
    await expect(saveOpeningEntry(db, f.users.foreman, { date: '2026-01-01', lines: [] })).rejects.toMatchObject({ status: 403 });
  });
});
