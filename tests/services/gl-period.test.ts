import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { cancelSalesDoc, createSalesDoc } from '@/server/services/sales-docs';
import { listJournal, repostAll, trialBalance } from '@/server/services/gl';
import { closePeriod, closeYear, closedThrough, previewYearClose, reopenLatest } from '@/server/services/gl-period';

describe('period close (ปิดงวด / ปิดบัญชีสิ้นปี)', () => {
  test('a closed month refuses new, changed and cancelled postings; reopening lets them through', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const rc = await createSalesDoc(db, f.users.finance, { kind: 'RC', docDate: '2026-10-10', customerName: 'ก', payMethod: 'CASH', lines: [{ name: 'ขายเศษวัสดุ', qty: 1, unitPrice: 1000 }] });

    expect(await closePeriod(db, f.users.finance, { through: '2026-10-15' })).toBe('2026-10-31');
    expect(await closedThrough(db)).toBe('2026-10-31');
    await expect(closePeriod(db, f.users.finance, { through: '2026-09-01' })).rejects.toMatchObject({ code: 'ALREADY_CLOSED' });

    // New document dated in the closed month
    await expect(
      createSalesDoc(db, f.users.finance, { kind: 'RC', docDate: '2026-10-20', customerName: 'ข', payMethod: 'CASH', lines: [{ name: 'x', qty: 1, unitPrice: 10 }] }),
    ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
    // Cancelling one that posted in it
    await expect(cancelSalesDoc(db, f.users.finance, rc.id, 'ผิด')).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
    // An open month is fine
    await createSalesDoc(db, f.users.finance, { kind: 'RC', docDate: '2026-11-02', customerName: 'ข', payMethod: 'CASH', lines: [{ name: 'x', qty: 1, unitPrice: 10 }] });
    // A full re-post leaves the closed month alone
    await repostAll(db, f.users.finance);
    expect((await listJournal(db, f.users.finance, {})).rows.filter((r) => r.status === 'POSTED')).toHaveLength(2);

    // Only owner/admin reopen
    await expect(reopenLatest(db, f.users.finance, 'แก้')).rejects.toMatchObject({ status: 403 });
    await reopenLatest(db, f.users.owner, 'แก้ใบเสร็จผิด');
    expect(await closedThrough(db)).toBeNull();
    await cancelSalesDoc(db, f.users.finance, rc.id, 'ผิด');
  });

  test('year-end close moves profit to retained earnings and locks the year', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await createSalesDoc(db, f.users.finance, { kind: 'RC', docDate: '2025-06-10', customerName: 'ก', payMethod: 'CASH', lines: [{ name: 'ขาย', qty: 1, unitPrice: 10_000 }] });
    await createSalesDoc(db, f.users.finance, { kind: 'EXP', docDate: '2025-07-10', customerName: 'ร้าน', payMethod: 'CASH', lines: [{ name: 'ค่าน้ำมัน', qty: 1, unitPrice: 4_000 }] });

    const p = await previewYearClose(db, f.users.finance, 2025);
    const r = await closeYear(db, f.users.finance, 2025);
    expect(r.netProfit).toBe(p.netProfit);
    expect(r.netProfit).toBeGreaterThan(0);

    const tb = await trialBalance(db, f.users.finance, { from: '2025-01-01', to: '2025-12-31' });
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    // Income and expense accounts are zero after the closing; retained earnings carries the profit
    for (const row of tb.rows.filter((x) => x.type === 'INCOME' || x.type === 'EXPENSE')) {
      expect(row.closingDebit + row.closingCredit).toBe(0);
    }
    expect(tb.rows.find((x) => x.code === '3200')).toMatchObject({ closingCredit: r.netProfit });
    expect(await closedThrough(db)).toBe('2025-12-31');

    // Reopening voids the closing entry
    await reopenLatest(db, f.users.owner, 'ปรับปรุงก่อนปิดใหม่');
    const after = await trialBalance(db, f.users.finance, { from: '2025-01-01', to: '2025-12-31' });
    expect(after.rows.find((x) => x.code === '3200')).toBeUndefined();
  });
});
