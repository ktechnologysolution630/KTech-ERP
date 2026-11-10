import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { payables, projects } from '@/db/schema';
import { D, formatMoneyDisplay } from '@/domain/money';
import { computeEvm, groupBoqBudget, lastMonthKeys, monthRange } from '@/domain/project-finance';
import { bangkokDateString } from '@/domain/thai';
import { createArInvoice, issueArInvoice, recordArReceipt, upsertCustomer } from '@/server/services/ar';
import { createInvoice } from '@/server/services/invoice';
import { listOpenPayables } from '@/server/services/payable';
import { approvePo, createPo, submitPo } from '@/server/services/po';
import { getProjectCashflow, getProjectCostPerformance } from '@/server/services/project-finance';
import { createPrv, transitionPrv } from '@/server/services/prv';
import { approvePv, createPv, markPvPaid, submitPv } from '@/server/services/pv';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { EARLY_PAY_REASON, receiveAll } from '../helpers/receive';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

describe('project finance domain', () => {
  it('builds month windows across year ends', () => {
    expect(lastMonthKeys('2027-02-15', 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthRange('2026-11-20', '2027-01-02')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(monthRange('2027-01-01', '2026-12-31')).toEqual([]);
  });

  it('computes EVM and avoids meaningless ratios', () => {
    expect(computeEvm({ bac: 1_000_000, plannedPercent: 40, actualPercent: 30, ac: 250_000 })).toMatchObject({
      pv: 400_000,
      ev: 300_000,
      cv: 50_000,
      sv: -100_000,
      cpi: 1.2,
      spi: 0.75,
      eac: 833_333.33,
    });
    // Money spent with nothing earned yet: no CPI, the overspend is added to the budget
    expect(computeEvm({ bac: 1_000, plannedPercent: 0, actualPercent: 0, ac: 300 })).toMatchObject({ cpi: null, spi: null, eac: 1_300 });
  });

  it('a budget added up from floats leaves no remainder in the variance', () => {
    expect(computeEvm({ bac: 54_340_998.650000024, plannedPercent: 0, actualPercent: 0, ac: 0 })).toMatchObject({ bac: 54_340_998.65, eac: 54_340_998.65, vac: 0 });
  });

  it('shows a very small number as money, not in scientific notation', () => {
    expect(formatMoneyDisplay(-2e-8)).toBe('-0.00');
    expect(formatMoneyDisplay(1234.5)).toBe('1,234.50');
    expect(formatMoneyDisplay('1,234.5')).toBe('1,234.50');
  });

  it('groups BOQ direct cost under category headers', () => {
    const line = (id: string, isCategory: boolean, qty: string | null, m: string | null, l: string | null, description = id) => ({
      id,
      isCategory,
      no: '',
      description,
      qty,
      materialRate: m,
      laborRate: l,
    });
    const groups = groupBoqBudget([
      line('loose', false, '1', '100', null),
      line('c1', true, null, null, null, 'งานโครงสร้าง'),
      line('a', false, '2', '1000', '250.50'),
      line('c-empty', true, null, null, null),
      line('c2', true, null, null, null, 'งานสถาปัตย์'),
      line('b', false, '10', null, '35'),
    ]);
    expect(groups.map((g) => [g.name, g.budget, g.lineIds])).toEqual([
      ['งานทั่วไป', 100, ['loose']],
      ['งานโครงสร้าง', 2501, ['a']],
      ['งานสถาปัตย์', 350, ['b']],
    ]);
  });
});

describe('project finance services', () => {
  let db: Db;
  let f: SeededBasics;
  const today = bangkokDateString();

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
  });

  async function seedMoney() {
    // Income: bill the customer 100,000 + VAT, receive 50,000 cash + 1,000 WHT
    const customer = await upsertCustomer(db, f.users.finance, { code: 'C-1', name: 'ลูกค้า', creditDays: 30 });
    const { id: invoiceId } = await createArInvoice(db, f.users.finance, {
      customerId: customer.id,
      projectId: f.projectA,
      docDate: today,
      vatMode: 'EXCLUSIVE',
      lines: [{ description: 'งวดที่ 1', qty: 1, unitPrice: 100_000 }],
    });
    await issueArInvoice(db, f.users.finance, invoiceId);
    await recordArReceipt(db, f.users.finance, invoiceId, { amountReceived: 50_000, whtAmount: 1_000, receiptDate: today });

    // Expense paid: credit PO 1,070 invoiced and paid by PV
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ปูน', qty: D(10), unitName: 'ถุง', unitPrice: D(107), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    await receiveAll(db, f.users.owner, po.id);
    await createInvoice(db, f.users.finance, { poId: po.id, invoiceNo: 'IV-1', invoiceDate: today, beforeVat: D(1000), vat: D(70) });
    const [payable] = await listOpenPayables(db, f.users.finance, {});
    expect(payable!.projectId).toBe(f.projectA);
    const pv = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [payable!.id] });
    await submitPv(db, f.users.finance, pv.id);
    await approvePv(db, f.users.owner, pv.id, EARLY_PAY_REASON);
    await markPvPaid(db, f.users.finance, pv.id, { paidAt: today, payMethod: 'TRANSFER', payFromAccount: 'K-1', payRef: 'S-1' });

    // Expense still open: approved contractor claim 100,000 − 5% retention, VAT 7,000
    const prv = await createPrv(db, f.users.foreman, {
      projectId: f.projectA,
      vendorId: f.vendorPerson,
      category: 'CONTRACTOR_PROGRESS',
      installmentNo: 1,
      retentionPercent: 5,
      whtRate: 3,
      vatRate: 7,
      notes: '',
      items: [{ description: 'เสาเข็ม', quantity: 1, unit: 'งาน', unitPrice: 200_000, progressPercent: 50 }],
    });
    await transitionPrv(db, f.users.foreman, prv.id, 'submit');
    await transitionPrv(db, f.users.pm, prv.id, 'verify');
    await transitionPrv(db, f.users.owner, prv.id, 'approve');
    const [claimPayable] = await db.select().from(payables).where(eq(payables.sourceType, 'CONTRACTOR_CLAIM'));
    expect(claimPayable!.projectId).toBe(f.projectA);
  }

  it('cashflow sums receipts, paid vouchers and open items of the project only', async () => {
    await seedMoney();
    const cf = await getProjectCashflow(db, f.users.pm, f.projectA);
    expect(cf).toMatchObject({
      billed: 107_000,
      received: 51_000,
      receivable: 56_000,
      paid: 1_070,
      payableOpen: 102_000,
      poCommitted: 1_070,
      net: 49_930,
      thisMonth: { income: 51_000, expense: 1_070 },
      canCreateIncome: false,
      canCreateExpense: true,
    });
    expect(cf.monthly).toHaveLength(12);
    expect(cf.monthly.at(-1)).toMatchObject({ month: today.slice(0, 7), cumulative: 49_930 });
    expect(cf.expenseGroups).toEqual([{ label: 'ค่าวัสดุ/สั่งซื้อ (PO)', amount: 1_070 }]);
    expect(cf.entries.map((e) => [e.kind, e.status, e.amount]).sort()).toEqual(
      [
        ['EXPENSE', 'DONE', 1_070],
        ['EXPENSE', 'PENDING', 102_000],
        ['INCOME', 'DONE', 51_000],
        ['INCOME', 'PENDING', 107_000],
      ].sort(),
    );

    const other = await getProjectCashflow(db, f.users.owner, f.projectB);
    expect(other).toMatchObject({ received: 0, paid: 0, payableOpen: 0, entries: [] });
    expect((await getProjectCashflow(db, f.users.finance, f.projectA)).canCreateIncome).toBe(true);
  });

  it('only management, office money roles and the project PM see project finance', async () => {
    await expect(getProjectCashflow(db, f.users.foreman, f.projectA)).rejects.toMatchObject({ status: 403 });
    await expect(getProjectCostPerformance(db, f.users.foreman, f.projectA)).rejects.toMatchObject({ status: 403 });
    await expect(getProjectCashflow(db, f.users.pm, f.projectB)).rejects.toMatchObject({ status: 403 });
    await expect(getProjectCashflow(db, f.users.owner, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
  });

  it('cost performance uses the project budget when there is no BOQ and counts booked cost', async () => {
    let cp = await getProjectCostPerformance(db, f.users.owner, f.projectA);
    expect(cp).toMatchObject({ budgetSource: 'NONE', categories: [], curve: [] });

    await db.update(projects).set({ budget: '1000000.00', startDate: today, endDate: today }).where(eq(projects.id, f.projectA));
    await seedMoney();
    cp = await getProjectCostPerformance(db, f.users.owner, f.projectA);
    expect(cp.budgetSource).toBe('PROJECT');
    // AC = payables before VAT: PO 1,000 + claim 95,000; nothing earned yet
    expect(cp.evm).toMatchObject({ bac: 1_000_000, ac: 96_000, ev: 0, cpi: null, eac: 1_096_000 });
    expect(cp.unlinkedCommitted).toBe(1_000);
    expect(cp.curve).toEqual([{ month: today.slice(0, 7), planned: 0, actualCost: 9.6 }]);
  });
});
