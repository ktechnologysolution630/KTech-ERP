import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import {
  createPr,
  updatePr,
  submitPr,
  approvePr,
  rejectPr,
  cancelPr,
  closePr,
  getPr,
  listPrs,
} from '@/server/services/pr';
import { listActivity } from '@/server/services/activity';
import { D } from '@/domain/money';
import { DomainError } from '@/domain/errors';

describe('PR service', () => {
  const sampleLine = {
    description: 'ปูนซีเมนต์ปอร์ตแลนด์',
    unitName: 'ถุง',
    qty: D(100),
    estUnitPrice: D(150),
    neededDate: '2026-11-15',
    note: 'เทพื้นชั้น 1',
  };

  test('foreman creates, PM approves', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [sampleLine],
    });
    // Numbered per project and month: PR-<project code>-<MM>001
    expect(pr.number).toMatch(/^PR-PJ-001-\d{2}001$/);
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const got = await getPr(db, f.users.pm, pr.id);
    expect(got.status).toBe('APPROVED');
    expect(got.lines[0].remainingQty.toString()).toBe('100');
    expect(got.orderProgress).toBe('NONE');
  });

  test('foreman cannot create PR in other project', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(
      createPr(db, f.users.foreman, {
        projectId: f.projectB,
        lines: [sampleLine],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test('reject requires reason, keeps number and history on resubmit', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [sampleLine],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await expect(rejectPr(db, f.users.pm, pr.id, ' ')).rejects.toThrow(DomainError);

    await rejectPr(db, f.users.pm, pr.id, 'จำนวนเกิน');
    await updatePr(db, f.users.foreman, pr.id, {
      lines: [{ ...sampleLine, qty: D(5) }],
    });
    await submitPr(db, f.users.foreman, pr.id);

    const got = await getPr(db, f.users.pm, pr.id);
    expect(got.number).toBe(pr.number);
    expect(got.status).toBe('SUBMITTED');
    expect(got.lines[0].qty).toBe('5.000');

    const acts = await listActivity(db, 'PR', pr.id);
    expect(acts.map((a) => a.action)).toEqual([
      'submit',
      'update',
      'reject',
      'submit',
      'create',
    ]);
  });

  test('submitting or creating a PR with zero lines fails, cancel and close work', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(
      createPr(db, f.users.foreman, { projectId: f.projectA, lines: [] }),
    ).rejects.toThrow(DomainError);

    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [sampleLine],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    await closePr(db, f.users.pm, pr.id);
    expect((await getPr(db, f.users.pm, pr.id)).status).toBe('CLOSED');

    const pr2 = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [sampleLine],
    });
    await cancelPr(db, f.users.foreman, pr2.id);
    expect((await getPr(db, f.users.foreman, pr2.id)).status).toBe('CANCELLED');

    const listForForeman = await listPrs(db, f.users.foreman, {});
    expect(listForForeman.length).toBe(2);
    const listForOther = await listPrs(db, f.users.otherForeman, {});
    expect(listForOther.length).toBe(0);
  });
});

describe('PR document header', () => {
  test('keeps the printed header, line detail and discount, and a vendor delete drops only the suggestion', async () => {
    const { createTestDb: mk } = await import('../helpers/test-db');
    const { seedBasics: seed } = await import('../helpers/fixtures');
    const { createPr: create, getPr: read, updatePr: update } = await import('@/server/services/pr');
    const { deleteVendors } = await import('@/server/services/vendor-delete');
    const db = await mk();
    const f = await seed(db);
    const pr = await create(db, f.users.foreman, {
      projectId: f.projectA,
      docDate: '2026-11-10',
      needBy: '2026-11-20',
      vendorId: f.vendorPerson,
      department: 'ฝ่ายก่อสร้าง',
      requesterName: 'นายช่าง',
      deliveryPlace: 'หน้างาน PJ-001',
      paymentTerms: 'เครดิต 30 วัน',
      vatMode: 'INCLUSIVE',
      billDiscount: '50',
      lines: [{ description: 'ปูน', detail: 'ปูนซีเมนต์ 50 กก.', unitName: 'ถุง', category: 'งานโครงสร้าง', qty: 10, estUnitPrice: 120, discount: 20 }],
    });
    let doc = await read(db, f.users.foreman, pr.id);
    expect(doc).toMatchObject({
      docDate: '2026-11-10',
      needBy: '2026-11-20',
      vendorId: f.vendorPerson,
      department: 'ฝ่ายก่อสร้าง',
      requesterText: 'นายช่าง',
      deliveryPlace: 'หน้างาน PJ-001',
      paymentTerms: 'เครดิต 30 วัน',
      vatMode: 'INCLUSIVE',
      billDiscount: '50.00',
    });
    expect(doc.lines[0]).toMatchObject({ detail: 'ปูนซีเมนต์ 50 กก.', discount: '20.00', estUnitPrice: '120.00' });

    // Updating the lines alone leaves the header as it was
    await update(db, f.users.foreman, pr.id, { lines: [{ description: 'ปูน', unitName: 'ถุง', category: 'งานโครงสร้าง', qty: 5 }] });
    doc = await read(db, f.users.foreman, pr.id);
    expect(doc.department).toBe('ฝ่ายก่อสร้าง');

    await deleteVendors(db, f.users.admin, [f.vendorPerson]);
    doc = await read(db, f.users.foreman, pr.id);
    expect(doc.vendorId).toBeNull();
  });
});

describe('the three PR forms', () => {
  const goods = { description: 'ปูน', unitName: 'ถุง', category: 'งานโครงสร้าง' as const, qty: 10 };
  const work = { description: 'ค่าแรงก่ออิฐ', unitName: 'ตร.ม.', category: 'งานสถาปัตยกรรม' as const, qty: 40 };

  test('the goods form drops prices; a PR that names no form keeps them', async () => {
    const { createTestDb: mk } = await import('../helpers/test-db');
    const { seedBasics: seed } = await import('../helpers/fixtures');
    const { createPr: create, getPr: read } = await import('@/server/services/pr');
    const db = await mk();
    const f = await seed(db);
    const a = await create(db, f.users.foreman, { projectId: f.projectA, prType: 'GOODS', billDiscount: 50, lines: [{ ...goods, estUnitPrice: 120, discount: 5, lineKind: 'LABOR' }] });
    const doc = await read(db, f.users.foreman, a.id);
    expect(doc).toMatchObject({ prType: 'GOODS', billDiscount: '0.00' });
    expect(doc.lines[0]).toMatchObject({ estUnitPrice: null, discount: '0.00', lineKind: 'GOODS' });
    const legacy = await create(db, f.users.foreman, { projectId: f.projectA, lines: [{ ...goods, estUnitPrice: 120 }] });
    expect((await read(db, f.users.foreman, legacy.id)).lines[0]).toMatchObject({ estUnitPrice: '120.00', lineKind: 'GOODS' });
  });

  test('hired work must be priced; the combined form needs goods and work', async () => {
    const { createTestDb: mk } = await import('../helpers/test-db');
    const { seedBasics: seed } = await import('../helpers/fixtures');
    const { createPr: create, getPr: read, updatePr: update } = await import('@/server/services/pr');
    const db = await mk();
    const f = await seed(db);
    await expect(create(db, f.users.foreman, { projectId: f.projectA, prType: 'LABOR', lines: [work] })).rejects.toMatchObject({ code: 'INVALID_PR' });
    const labor = await create(db, f.users.foreman, { projectId: f.projectA, prType: 'LABOR', needBy: '2026-11-20', workEnd: '2026-12-05', lines: [{ ...work, estUnitPrice: 180 }] });
    expect(await read(db, f.users.foreman, labor.id)).toMatchObject({ prType: 'LABOR', workEnd: '2026-12-05' });
    expect((await read(db, f.users.foreman, labor.id)).lines[0]).toMatchObject({ lineKind: 'LABOR', estUnitPrice: '180.00' });

    await expect(
      create(db, f.users.foreman, { projectId: f.projectA, prType: 'GOODS_AND_LABOR', lines: [{ ...goods, lineKind: 'GOODS' }] }),
    ).rejects.toMatchObject({ code: 'INVALID_PR' });
    const both = await create(db, f.users.foreman, {
      projectId: f.projectA,
      prType: 'GOODS_AND_LABOR',
      lines: [
        { ...goods, lineKind: 'GOODS', estUnitPrice: 150 },
        { ...work, lineKind: 'LABOR', estUnitPrice: 180 },
      ],
    });
    expect((await read(db, f.users.foreman, both.id)).lines.map((l) => l.lineKind)).toEqual(['GOODS', 'LABOR']);
    // Editing without naming the form keeps the form, and its rules
    await expect(update(db, f.users.foreman, both.id, { lines: [{ ...goods, lineKind: 'GOODS' }] })).rejects.toMatchObject({ code: 'INVALID_PR' });
    expect((await read(db, f.users.foreman, both.id)).prType).toBe('GOODS_AND_LABOR');
  });
});
