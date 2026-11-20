import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { createArInvoice, issueArInvoice, recordArReceipt, upsertCustomer } from '@/server/services/ar';
import { checkCustomerCredit, customerOutstanding, salesBySalesperson } from '@/server/services/customer-credit';

describe('customer credit limit and salesperson', () => {
  test('outstanding counts open bills less receipts; going over the limit warns', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const c = await upsertCustomer(db, f.users.finance, { code: 'C-9', name: 'ลูกค้าเครดิต', creditLimit: 100_000, salespersonId: f.users.finance.id });
    expect(c.creditLimit).toBe('100000.00');

    const a = await createArInvoice(db, f.users.finance, { customerId: c.id, docDate: '2026-11-01', vatMode: 'EXCLUSIVE', lines: [{ description: 'ขาย', qty: 1, unitPrice: 80_000 }] });
    await issueArInvoice(db, f.users.finance, a.id);
    expect((await customerOutstanding(db, [c.id])).get(c.id)).toBe(85_600);

    // A second bill of 32,100 would take them to 117,700
    let check = await checkCustomerCredit(db, f.users.finance, c.id, 32_100);
    expect(check).toMatchObject({ limit: 100_000, outstanding: 85_600, after: 117_700, over: true, overBy: 17_700 });

    await recordArReceipt(db, f.users.finance, a.id, { amountReceived: 50_000, receiptDate: '2026-11-10', method: 'TRANSFER' });
    check = await checkCustomerCredit(db, f.users.finance, c.id, 32_100);
    expect(check).toMatchObject({ outstanding: 35_600, over: false });

    // No limit, no check
    const free = await upsertCustomer(db, f.users.finance, { code: 'C-10', name: 'ไม่มีวงเงิน' });
    expect(await checkCustomerCredit(db, f.users.finance, free.id, 1_000_000)).toBeNull();

    const sales = await salesBySalesperson(db, f.users.finance, { from: '2026-01-01', to: '2026-12-31' });
    expect(sales).toEqual([{ salespersonId: f.users.finance.id, name: expect.any(String), bills: 1, beforeVat: 80_000 }]);
  });
});
