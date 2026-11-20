import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { createSalesDoc } from '@/server/services/sales-docs';
import { getBankRecView, listCashAccounts, listReconciliations, saveBankReconciliation, undoLastReconciliation } from '@/server/services/bank-rec';

describe('bank reconciliation (กระทบยอดเงินฝากธนาคาร)', () => {
  test('ticks statement lines until they meet the statement; the rest stays outstanding', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await createSalesDoc(db, f.users.finance, { kind: 'RC', docDate: '2026-11-02', customerName: 'ก', payMethod: 'TRANSFER', lines: [{ name: 'รับเงิน', qty: 1, unitPrice: 5000 }] });
    await createSalesDoc(db, f.users.finance, { kind: 'RC', docDate: '2026-11-03', customerName: 'ข', payMethod: 'TRANSFER', lines: [{ name: 'รับเงิน', qty: 1, unitPrice: 2000 }] });
    await createSalesDoc(db, f.users.finance, { kind: 'EXP', docDate: '2026-11-04', customerName: 'ร้าน', payMethod: 'TRANSFER', lines: [{ name: 'จ่ายค่าของ', qty: 1, unitPrice: 1500 }] });

    const bank = (await listCashAccounts(db, f.users.finance)).find((a) => a.isBank)!;
    let view = await getBankRecView(db, f.users.finance, bank.id, '2026-11-30');
    expect(view.open).toHaveLength(3);
    const total = view.open.reduce((s, l) => s + l.amount, 0);
    expect(view.bookBalance).toBeCloseTo(total, 2);

    // The statement shows the 5,000 deposit and the payment, not the 2,000 one yet
    const dep5 = view.open.find((l) => l.date === '2026-11-02')!;
    const dep2 = view.open.find((l) => l.date === '2026-11-03')!;
    const pay = view.open.find((l) => l.amount < 0)!;
    const statement = Math.round((dep5.amount + pay.amount) * 100) / 100;
    await expect(
      saveBankReconciliation(db, f.users.finance, { accountId: bank.id, statementDate: '2026-11-30', statementBalance: statement + 1, lineIds: [dep5.id, pay.id] }),
    ).rejects.toMatchObject({ code: 'REC_DIFFERENCE' });
    await saveBankReconciliation(db, f.users.finance, { accountId: bank.id, statementDate: '2026-11-30', statementBalance: statement, lineIds: [dep5.id, pay.id] });

    view = await getBankRecView(db, f.users.finance, bank.id, '2026-12-31');
    expect(view.open.map((l) => l.id)).toEqual([dep2.id]);
    expect(view.reconciledBalance).toBeCloseTo(statement, 2);
    // A line cannot be reconciled twice
    await expect(
      saveBankReconciliation(db, f.users.finance, { accountId: bank.id, statementDate: '2026-12-31', statementBalance: statement + 5000, lineIds: [dep5.id] }),
    ).rejects.toMatchObject({ code: 'ALREADY_RECONCILED' });

    expect(await listReconciliations(db, f.users.finance, bank.id)).toHaveLength(1);
    await undoLastReconciliation(db, f.users.finance, bank.id);
    expect((await getBankRecView(db, f.users.finance, bank.id, '2026-12-31')).open).toHaveLength(3);
  });
});
