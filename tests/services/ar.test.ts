import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { agingBucket, splitByInvoiceVat } from '@/domain/ar';
import {
  createArInvoice,
  createInvoiceFromMilestone,
  getArInvoice,
  issueArCreditNote,
  issueArInvoice,
  listArInvoices,
  outputVatReport,
  recordArReceipt,
  upsertCustomer,
  voidArInvoice,
  voidArReceipt,
} from '@/server/services/ar';
import { advanceMilestone, createMilestone, getMilestoneSheet } from '@/server/services/milestones';
import { updateProjectDetails } from '@/server/services/master';

describe('AR maths', () => {
  test('receipt VAT is the invoice VAT ratio of the settled amount', () => {
    const s = splitByInvoiceVat(50_000, { vat: 7_000, gross: 107_000 });
    expect(s.vat.toFixed(2)).toBe('3271.03');
    expect(s.beforeVat.toFixed(2)).toBe('46728.97');
  });

  test('aging buckets by days past due', () => {
    expect(agingBucket('2026-11-03', '2026-11-03').bucket).toBe('NOT_DUE');
    expect(agingBucket('2026-11-01', '2026-11-03')).toEqual({ bucket: 'D1_30', daysOverdue: 2 });
    expect(agingBucket('2026-09-01', '2026-11-03').bucket).toBe('D61_90');
    expect(agingBucket('2026-01-01', '2026-11-03').bucket).toBe('D90_PLUS');
  });
});

async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  const customer = await upsertCustomer(db, f.users.finance, {
    code: 'C-001',
    name: 'บริษัท ลูกค้าทดสอบ จำกัด',
    taxId: '0994000123456',
    creditDays: 30,
  });
  return { db, f, customer };
}

describe('AR service', () => {
  test('milestone invoice → receipt with WHT → paid; milestone follows', async () => {
    const { db, f, customer } = await setup();
    await updateProjectDetails(db, f.users.owner, f.projectA, { customerId: customer.id });
    const { id: milestoneId } = await createMilestone(db, f.users.pm, f.projectA, 'RECEIVE', {
      title: 'งานฐานราก',
      amount: 107_000,
      retentionPercent: 5,
    });

    await expect(createInvoiceFromMilestone(db, f.users.finance, milestoneId)).rejects.toMatchObject({ status: 409 });
    await advanceMilestone(db, f.users.pm, milestoneId);
    const { id } = await createInvoiceFromMilestone(db, f.users.finance, milestoneId);
    await expect(createInvoiceFromMilestone(db, f.users.finance, milestoneId)).rejects.toMatchObject({
      code: 'ALREADY_INVOICED',
    });
    await advanceMilestone(db, f.users.owner, milestoneId);

    const number = await issueArInvoice(db, f.users.finance, id);
    expect(number).toMatch(/^INV-\d{4}-0001$/);
    let inv = await getArInvoice(db, f.users.finance, id);
    expect(inv).toMatchObject({ gross: 107_000, vat: 7_000, beforeVat: 100_000, retentionAmount: 5_350, status: 'ISSUED' });

    // Customer pays the bill less retention and 1% WHT on the base
    await recordArReceipt(db, f.users.finance, id, { amountReceived: 100_650, whtAmount: 1_000, receiptDate: '2026-11-20' });
    inv = await getArInvoice(db, f.users.finance, id);
    expect(inv).toMatchObject({ status: 'PARTIAL', settled: 101_650, wht: 1_000, balance: 5_350 });

    await expect(
      recordArReceipt(db, f.users.finance, id, { amountReceived: 6_000 }),
    ).rejects.toMatchObject({ code: 'OVER_BALANCE' });

    // Retention released later
    await recordArReceipt(db, f.users.finance, id, { amountReceived: 5_350, receiptDate: '2027-11-20' });
    inv = await getArInvoice(db, f.users.finance, id);
    expect(inv.status).toBe('PAID');
    expect((await getMilestoneSheet(db, f.users.pm, f.projectA, 'RECEIVE')).rows[0]).toMatchObject({
      status: 'PAID',
      paidAt: '2027-11-20',
    });

    const nov = await outputVatReport(db, f.users.finance, 2026, 11);
    expect(nov.rows).toHaveLength(1);
    const novVat = nov.totalVat;
    const nextYear = await outputVatReport(db, f.users.finance, 2027, 11);
    expect(novVat + nextYear.totalVat).toBeCloseTo(7_000, 2);
  });

  test('credit note reduces balance and output VAT; voiding a receipt reopens the invoice', async () => {
    const { db, f, customer } = await setup();
    const { id } = await createArInvoice(db, f.users.finance, {
      customerId: customer.id,
      docDate: '2026-11-01',
      vatMode: 'EXCLUSIVE',
      lines: [{ description: 'ค่าก่อสร้างงวดที่ 1', qty: 1, unitPrice: 100_000 }],
    });
    await issueArInvoice(db, f.users.finance, id);

    const cn = await issueArCreditNote(db, f.users.finance, id, { gross: 10_700, reason: 'ปรับลดงานตามจริง', docDate: '2026-11-05' });
    expect(cn.number).toMatch(/^CN-/);
    const rc = await recordArReceipt(db, f.users.finance, id, { amountReceived: 96_300, receiptDate: '2026-11-10' });
    let inv = await getArInvoice(db, f.users.finance, id);
    expect(inv).toMatchObject({ status: 'PAID', balance: 0, credited: 10_700 });

    const vat = await outputVatReport(db, f.users.finance, 2026, 11);
    // VAT is declared on what was received; the credited part was never received, so it adds nothing
    expect(vat.totalVat).toBeCloseTo(6_300, 2);
    expect(vat.rows.map((r) => r.number)).toEqual([rc.number]);

    await expect(voidArInvoice(db, f.users.finance, id, 'ผิด')).rejects.toMatchObject({ status: 409 });
    await voidArReceipt(db, f.users.finance, rc.id, 'โอนเงินผิดบัญชี');
    inv = await getArInvoice(db, f.users.finance, id);
    expect(inv).toMatchObject({ status: 'PARTIAL', balance: 96_300 });
  });

  test('aging lists open invoices; access and validation', async () => {
    const { db, f, customer } = await setup();
    const { id } = await createArInvoice(db, f.users.finance, {
      customerId: customer.id,
      docDate: '2026-08-01',
      lines: [{ description: 'งานเพิ่ม', qty: 2, unitPrice: 5_000 }],
    });
    await issueArInvoice(db, f.users.finance, id);
    const rows = await listArInvoices(db, f.users.finance, '2026-11-03');
    expect(rows[0]).toMatchObject({ dueDate: '2026-08-31', balance: 10_700, aging: 'D61_90', daysOverdue: 64 });

    await expect(listArInvoices(db, f.users.pm)).rejects.toMatchObject({ status: 403 });
    await expect(
      upsertCustomer(db, f.users.finance, { code: 'C-001', name: 'ซ้ำ' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      upsertCustomer(db, f.users.finance, { code: 'C-002', name: 'x', taxId: '123' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createArInvoice(db, f.users.finance, { customerId: customer.id, lines: [] }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
