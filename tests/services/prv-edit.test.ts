import { beforeEach, describe, expect, it } from 'vitest';
import { listActivity } from '@/server/services/activity';
import { createPrv, getPrvById, transitionPrv, updatePrv, type CreatePrvInput } from '@/server/services/prv';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

describe('editing a payment claim (PRV)', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let f: Awaited<ReturnType<typeof seedBasics>>;

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
  });

  const claim = (overrides: Partial<CreatePrvInput> = {}): CreatePrvInput => ({
    projectId: f.projectA,
    vendorId: f.vendorPerson,
    category: 'CONTRACTOR_PROGRESS',
    installmentNo: 1,
    retentionPercent: 5,
    whtRate: 3,
    vatRate: 7,
    notes: 'เบิกงวดที่ 1',
    items: [{ description: 'งานเทเสาเข็ม', quantity: 1, unit: 'งาน', unitPrice: 200000, progressPercent: 50 }],
    ...overrides,
  });

  it('a draft is changed in place: lines replaced, totals worked out again, number kept', async () => {
    const prv = await createPrv(db, f.users.foreman, claim());
    const updated = await updatePrv(
      db,
      f.users.foreman,
      prv.id,
      claim({
        installmentNo: 2,
        vendorId: f.vendorCo,
        notes: 'เบิกงวดที่ 2',
        items: [
          { description: 'งานเทเสาเข็ม', quantity: 1, unit: 'งาน', unitPrice: 200000, progressPercent: 100 },
          { description: 'งานตอกเข็มเพิ่ม', quantity: 2, unit: 'ต้น', unitPrice: 5000, progressPercent: 100 },
        ],
      }),
    );
    // 200,000 + 10,000 = 210,000; retention 5% = 10,500; WHT 3% of 199,500 = 5,985; VAT 7% of 210,000 = 14,700
    expect(updated).toMatchObject({
      prvNumber: prv.prvNumber,
      status: 'DRAFT',
      installmentNo: 2,
      vendorId: f.vendorCo,
      totalAmount: '210000.00',
      retentionAmount: '10500.00',
      whtAmount: '5985.00',
      vatAmount: '14700.00',
      netAmount: '208215.00',
      notes: 'เบิกงวดที่ 2',
    });
    const detail = await getPrvById(db, f.users.foreman, prv.id);
    expect(detail?.items.map((i) => [i.description, i.amount])).toEqual([
      ['งานเทเสาเข็ม', '200000.00'],
      ['งานตอกเข็มเพิ่ม', '10000.00'],
    ]);
    expect(detail?.allowed.edit).toBe(true);
    expect((await listActivity(db, 'PRV', prv.id)).map((a) => a.action)).toContain('UPDATE');
  });

  it('a claim sent back can be changed and sent again; one under review cannot', async () => {
    const prv = await createPrv(db, f.users.foreman, claim());
    await transitionPrv(db, f.users.foreman, prv.id, 'submit');
    expect((await getPrvById(db, f.users.foreman, prv.id))?.allowed.edit).toBe(false);
    await expect(updatePrv(db, f.users.foreman, prv.id, claim())).rejects.toMatchObject({ code: 'INVALID_STATE' });

    await transitionPrv(db, f.users.pm, prv.id, 'reject', 'ตัวเลขงวดไม่ตรง');
    expect((await getPrvById(db, f.users.foreman, prv.id))?.allowed.edit).toBe(true);
    const fixed = await updatePrv(db, f.users.foreman, prv.id, claim({ installmentNo: 3 }));
    expect(fixed).toMatchObject({ status: 'REJECTED', installmentNo: 3 });
    await transitionPrv(db, f.users.foreman, prv.id, 'submit');
    expect((await getPrvById(db, f.users.foreman, prv.id))?.status).toBe('SUBMITTED');
  });

  it('only those who may send it may change it, and not into a project they cannot claim for', async () => {
    const prv = await createPrv(db, f.users.foreman, claim());
    // Another project's foreman may not touch it
    await expect(updatePrv(db, f.users.otherForeman, prv.id, claim())).rejects.toMatchObject({ status: 403 });
    // The foreman of project A cannot move it to project B
    await expect(updatePrv(db, f.users.foreman, prv.id, claim({ projectId: f.projectB }))).rejects.toMatchObject({ status: 403 });
    // Purchasing may change anyone's draft
    const byBuyer = await updatePrv(db, f.users.buyer, prv.id, claim({ notes: 'แก้โดยจัดซื้อ' }));
    expect(byBuyer.notes).toBe('แก้โดยจัดซื้อ');
    await expect(updatePrv(db, f.users.foreman, prv.id, claim({ items: [] }))).rejects.toMatchObject({ code: 'INVALID_PRV' });
  });
});
