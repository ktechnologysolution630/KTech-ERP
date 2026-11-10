import { describe, expect, test } from 'vitest';
import { computeSalesTotals } from '@/domain/sales-doc';
import { cancelSalesDoc, createSalesDoc, getSalesDoc, listSalesDocs } from '@/server/services/sales-docs';
import { seedBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';

describe('sales document totals', () => {
  test('discount, VAT on top or inside the price, and withholding on the amount before VAT', () => {
    const lines = [{ qty: 2, unitPrice: 500 }, { isSection: true, qty: 9, unitPrice: 9 }, { qty: 1, unitPrice: 1000 }];
    const ex = computeSalesTotals({ lines, discountType: 'PERCENT', discountValue: 10, vatMode: 'EXCLUSIVE', whtRate: 3 });
    expect([ex.subtotal, ex.discount, ex.afterDiscount, ex.vat, ex.total, ex.wht, ex.payable].map((d) => d.toFixed(2))).toEqual(['2000.00', '200.00', '1800.00', '126.00', '1926.00', '54.00', '1872.00']);
    const inc = computeSalesTotals({ lines: [{ qty: 1, unitPrice: 1070 }], discountType: 'AMOUNT', discountValue: 0, vatMode: 'INCLUSIVE', whtRate: 0 });
    expect([inc.beforeVat, inc.vat, inc.total].map((d) => d.toFixed(2))).toEqual(['1000.00', '70.00', '1070.00']);
    const none = computeSalesTotals({ lines: [{ qty: 1, unitPrice: 100 }], discountType: 'AMOUNT', discountValue: 500, vatMode: 'NONE', whtRate: 0 });
    expect(none.total.toFixed(2)).toBe('0.00');
  });
});

describe('sales documents', () => {
  test('finance issues a quotation with an area heading, lists it and cancels it', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(createSalesDoc(db, f.users.foreman, { kind: 'QT', docDate: '2026-11-10', customerName: 'ลูกค้า', lines: [{ name: 'งาน', qty: 1, unitPrice: 1 }] })).rejects.toMatchObject({ status: 403 });
    const qt = await createSalesDoc(db, f.users.finance, {
      kind: 'QT',
      docDate: '2026-11-10',
      dueDate: '2026-12-10',
      customerName: 'บริษัท ลูกค้า จำกัด',
      projectId: f.projectA,
      vatMode: 'EXCLUSIVE',
      lines: [
        { isSection: true, name: 'ห้องโถง' },
        { name: 'ปูกระเบื้อง', detail: '60x60', qty: 20, unit: 'ตร.ม.', unitPrice: 350 },
      ],
    });
    expect(qt.number).toMatch(/^QT-\d{4}-0001$/);
    const doc = await getSalesDoc(db, f.users.finance, qt.id);
    expect(doc).toMatchObject({ subtotal: '7000.00', vat: '490.00', total: '7490.00', payable: '7490.00', customerName: 'บริษัท ลูกค้า จำกัด' });
    expect(doc.lines.map((l) => [l.isSection, l.name, l.amount])).toEqual([
      [true, 'ห้องโถง', '0.00'],
      [false, 'ปูกระเบื้อง', '7000.00'],
    ]);
    expect(await listSalesDocs(db, f.users.finance, 'QT')).toHaveLength(1);
    await cancelSalesDoc(db, f.users.finance, qt.id, 'ลูกค้ายกเลิกงาน');
    expect(await listSalesDocs(db, f.users.finance, 'QT')).toHaveLength(0);
    expect(await listSalesDocs(db, f.users.finance, 'QT', { includeCancelled: true })).toHaveLength(1);
    await expect(cancelSalesDoc(db, f.users.finance, qt.id, 'ซ้ำ')).rejects.toMatchObject({ status: 409 });
  });

  test('a debit note needs the original invoice; an abbreviated tax invoice must include VAT', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(createSalesDoc(db, f.users.finance, { kind: 'DN', docDate: '2026-11-10', customerName: 'ก', lines: [{ name: 'เพิ่ม', qty: 1, unitPrice: 100 }] })).rejects.toMatchObject({ code: 'INVALID_SALES_DOC' });
    await expect(createSalesDoc(db, f.users.finance, { kind: 'STI', docDate: '2026-11-10', vatMode: 'EXCLUSIVE', lines: [{ name: 'ขาย', qty: 1, unitPrice: 100 }] })).rejects.toMatchObject({ code: 'INVALID_SALES_DOC' });
    const sti = await createSalesDoc(db, f.users.finance, { kind: 'STI', docDate: '2026-11-10', vatMode: 'INCLUSIVE', lines: [{ name: 'ขาย', qty: 1, unitPrice: 107 }] });
    expect(sti.number).toMatch(/^STI-/);
    const rc = await createSalesDoc(db, f.users.finance, { kind: 'RC', docDate: '2026-11-10', customerName: 'ก', payMethod: 'CHEQUE', bank: 'ธนาคารกรุงไทย จำกัด (มหาชน)', accountNo: '000123', whtRate: 3, lines: [{ name: 'รับเงินงวด 1', qty: 1, unitPrice: 10000 }] });
    expect(await getSalesDoc(db, f.users.finance, rc.id)).toMatchObject({ payMethod: 'CHEQUE', wht: '300.00', payable: '10400.00' });
  });
});

describe('income, expense and company accounts', () => {
  test('a payment voucher to a vendor with retention, an income voucher, and the account balance', async () => {
    const { listCompanyAccounts, saveCompanyAccount } = await import('@/server/services/sales-docs');
    const db = await createTestDb();
    const f = await seedBasics(db);
    const acc = await saveCompanyAccount(db, f.users.finance, { bank: 'ธนาคารกสิกรไทย จำกัด (มหาชน)', accountName: 'บจก. ทดสอบ', accountNo: '111-1-11111-1', openingBalance: 50000, isDefaultPay: true, isDefaultReceive: true });
    const exp = await createSalesDoc(db, f.users.finance, {
      kind: 'EXP',
      docDate: '2026-11-10',
      vendorId: f.vendorCo,
      accountId: acc,
      projectId: f.projectA,
      vatMode: 'EXCLUSIVE',
      whtRate: 3,
      retentionRate: 5,
      payMethod: 'PROMPTPAY',
      lines: [{ name: 'ค่าแรงงานเทพื้น', qty: 1, unitPrice: 10000 }],
    });
    expect(exp.number).toMatch(/^EXP-/);
    const doc = await getSalesDoc(db, f.users.finance, exp.id);
    // 10,000 + VAT 700 − WHT 300 − retention 500
    expect(doc).toMatchObject({ vendorId: f.vendorCo, customerId: null, total: '10700.00', wht: '300.00', retention: '500.00', payable: '9900.00', payMethod: 'PROMPTPAY' });
    expect(doc.customerName).not.toBe('');
    await createSalesDoc(db, f.users.finance, { kind: 'INC', docDate: '2026-11-11', customerName: 'ร้านรับซื้อเศษเหล็ก', accountId: acc, vatMode: 'NONE', lines: [{ name: 'ขายเศษเหล็ก', qty: 1, unitPrice: 2500 }] });
    const [a] = await listCompanyAccounts(db, f.users.finance);
    expect(a).toMatchObject({ moneyIn: 2500, moneyOut: 9900, balance: 42600 });
    expect(a!.recent).toHaveLength(2);
    // A cancelled voucher no longer moves the balance
    await cancelSalesDoc(db, f.users.finance, exp.id, 'บันทึกผิด');
    expect((await listCompanyAccounts(db, f.users.finance))[0]!.balance).toBe(52500);
    await expect(createSalesDoc(db, f.users.finance, { kind: 'EXP', docDate: '2026-11-10', lines: [{ name: 'x', qty: 1, unitPrice: 1 }] })).rejects.toMatchObject({ code: 'INVALID_SALES_DOC' });
  });
});
