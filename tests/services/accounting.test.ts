import { describe, expect, test } from 'vitest';
import { getAccountingOverview, inputVatReport, listLedger } from '@/server/services/accounting';
import { outputVatReport } from '@/server/services/ar';
import { createSalesDoc } from '@/server/services/sales-docs';
import { seedBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';

describe('accounting reports', () => {
  test('income, expense, VAT both ways and the overview come from the issued documents', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await createSalesDoc(db, f.users.finance, { kind: 'RC', docDate: '2026-11-05', customerName: 'ลูกค้า ก', projectId: f.projectA, vatMode: 'EXCLUSIVE', lines: [{ name: 'งวด 1', qty: 1, unitPrice: 100000 }] });
    await createSalesDoc(db, f.users.finance, { kind: 'TI', docDate: '2026-11-06', customerName: 'ลูกค้า ข', vatMode: 'EXCLUSIVE', lines: [{ name: 'ค่าบริการ', qty: 1, unitPrice: 1000 }] });
    await createSalesDoc(db, f.users.finance, { kind: 'EXP', docDate: '2026-11-07', vendorId: f.vendorCo, projectId: f.projectA, vatMode: 'EXCLUSIVE', whtRate: 3, accountCategory: 'ค่าแรง', lines: [{ name: 'ค่าแรง', qty: 1, unitPrice: 20000 }] });
    await createSalesDoc(db, f.users.finance, { kind: 'QT', docDate: '2026-11-08', customerName: 'ลูกค้า ค', lines: [{ name: 'เสนอราคา', qty: 1, unitPrice: 999999 }] });

    const ledger = await listLedger(db, f.users.finance, { from: '2026-11-01', to: '2026-11-30' });
    expect(ledger.filter((r) => r.direction === 'IN').map((r) => r.net)).toEqual([107000]);
    // 20,000 + 1,400 VAT − 600 WHT
    expect(ledger.filter((r) => r.direction === 'OUT').map((r) => r.net)).toEqual([20800]);
    expect(await listLedger(db, f.users.finance, { from: '2026-11-01', to: '2026-11-30', projectId: f.projectB })).toEqual([]);

    const out = await outputVatReport(db, f.users.finance, 2026, 11);
    expect(out.rows.map((r) => r.kind).sort()).toEqual(['RC', 'TI']);
    expect(out.totalVat).toBe(7070);
    const inp = await inputVatReport(db, f.users.finance, 2026, 11);
    expect(inp).toMatchObject({ totalBase: 20000, totalVat: 1400 });

    const o = await getAccountingOverview(db, f.users.finance, { today: '2026-11-30' });
    expect(o.thisMonth).toMatchObject({ income: 107000, expense: 20800 });
    expect(o.ytdProfit).toBe(86200);
    expect(o.categories).toEqual([{ name: 'ค่าแรง', amount: 20800 }]);
    await expect(listLedger(db, f.users.foreman, { from: '2026-11-01', to: '2026-11-30' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('account categories and running numbers', () => {
  test('the chart is seeded, codes are unique, and the next number follows what was issued', async () => {
    const { listAccountCategories, listDocRunning, saveAccountCategory } = await import('@/server/services/account-categories');
    const db = await createTestDb();
    const f = await seedBasics(db);
    const expense = await listAccountCategories(db, f.users.finance, { types: ['EXPENSE'], activeOnly: true });
    expect(expense.some((c) => c.code === '5101' && c.name === 'ค่าวัสดุก่อสร้าง')).toBe(true);
    // What a form is given: the label saved on the document, and the tax the category usually carries
    const { categoryOptions } = await import('@/domain/sales-doc');
    expect(categoryOptions(expense).find((c) => c.label === '5102 ค่าผู้รับเหมาช่วง')).toEqual({ label: '5102 ค่าผู้รับเหมาช่วง', vatDefault: 'VAT7', whtRate: 3 });
    expect(categoryOptions(expense).find((c) => c.label === '5103 ค่าแรงงานโครงการ')).toMatchObject({ vatDefault: 'NONE', whtRate: 3 });
    await expect(saveAccountCategory(db, f.users.finance, { code: '5101', name: 'ซ้ำ', type: 'EXPENSE' })).rejects.toMatchObject({ status: 409 });
    const id = await saveAccountCategory(db, f.users.finance, { code: '5150', name: 'ค่าทดสอบวัสดุ', type: 'EXPENSE', whtRate: 3 });
    await saveAccountCategory(db, f.users.finance, { id, code: '5150', name: 'ค่าทดสอบวัสดุ', type: 'EXPENSE', active: false });
    expect((await listAccountCategories(db, f.users.finance, { types: ['EXPENSE'], activeOnly: true })).some((c) => c.code === '5150')).toBe(false);
    await expect(saveAccountCategory(db, f.users.foreman, { code: '9', name: 'x', type: 'OTHER' })).rejects.toMatchObject({ status: 403 });

    const at = new Date('2026-11-10T05:00:00Z');
    await createSalesDoc(db, f.users.finance, { kind: 'QT', docDate: '2026-11-10', customerName: 'ก', lines: [{ name: 'งาน', qty: 1, unitPrice: 1 }] });
    const qt = (await listDocRunning(db, f.users.finance, at)).find((r) => r.prefix === 'QT')!;
    expect(qt).toMatchObject({ used: 1 });
    expect(qt.next).toMatch(/^QT-\d{4}-0002$/);
  });
});
