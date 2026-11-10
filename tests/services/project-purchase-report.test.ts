import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { type Db } from '@/db/client';
import { D } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import { approvePr, createPr, submitPr } from '@/server/services/pr';
import { approvePo, createPo, getPo, submitPo } from '@/server/services/po';
import { createReceipt } from '@/server/services/receipt';
import { getProjectPurchaseReport } from '@/server/services/project-purchase-report';

async function po(db: Db, f: SeededBasics, vendorId: string, lines: { description: string; qty: number; unitPrice: number; prLineId?: string }[], approve = true) {
  const created = await createPo(db, f.users.buyer, {
    projectId: f.projectA,
    vendorId,
    paymentType: 'CREDIT',
    creditDays: 30,
    vatMode: 'EXCLUSIVE',
    billDiscount: D(0),
    shipping: D(0),
    lines: lines.map((l) => ({ prLineId: l.prLineId, description: l.description, unitName: 'ชิ้น', qty: D(l.qty), unitPrice: D(l.unitPrice), discount: D(0) })),
  });
  await submitPo(db, f.users.buyer, created.id);
  if (approve) await approvePo(db, f.users.owner, created.id);
  return created;
}

describe('project purchasing report', () => {
  test('totals by vendor and category, with the value received so far', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const pr = await createPr(db, f.users.pm, {
      projectId: f.projectA,
      lines: [{ description: 'ท่อ PVC', unitName: 'ชิ้น', qty: D(10), category: 'งานสุขาภิบาล', estUnitPrice: null, neededDate: null }],
    });
    await submitPr(db, f.users.pm, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const { getPr } = await import('@/server/services/pr');
    const prLineId = (await getPr(db, f.users.pm, pr.id)).lines[0]!.id;

    const a = await po(db, f, f.vendorCo, [{ description: 'ท่อ PVC', qty: 10, unitPrice: 100, prLineId }]);
    await po(db, f, f.vendorPerson, [{ description: 'ทราย', qty: 2, unitPrice: 500 }]);
    const lineId = (await getPo(db, f.users.buyer, a.id)).lines[0]!.id;
    await createReceipt(db, f.users.foreman, { poId: a.id, receivedAt: bangkokDateString(), lines: [{ poLineId: lineId, qty: D(4) }] });

    const r = await getProjectPurchaseReport(db, f.users.owner, { projectId: f.projectA });
    expect(r.summary).toMatchObject({ poCount: 2, vendorCount: 2, lineCount: 2, amount: 2000, vat: 140, gross: 2140, receivedAmount: 400, outstandingAmount: 1600 });
    expect(r.byVendor.map((v) => [v.amount, v.share])).toEqual([[1000, 50], [1000, 50]]);
    expect(r.byCategory).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: 'งานสุขาภิบาล', amount: 1000 }), expect.objectContaining({ category: 'ไม่ระบุหมวด', amount: 1000 })]),
    );
    expect(r.pos.find((p) => p.id === a.id)!.lines[0]).toMatchObject({ receivedQty: 4, amount: 1000 });
  });

  test('search keeps a whole PO by number or vendor, otherwise only matching lines; drafts are left out', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const a = await po(db, f, f.vendorCo, [{ description: 'ปูน', qty: 1, unitPrice: 100 }, { description: 'ทราย', qty: 1, unitPrice: 50 }]);
    await createPo(db, f.users.buyer, {
      projectId: f.projectA, vendorId: f.vendorCo, paymentType: 'CREDIT', creditDays: 30, vatMode: 'EXCLUSIVE', billDiscount: D(0), shipping: D(0),
      lines: [{ description: 'ร่าง', unitName: 'ชิ้น', qty: D(1), unitPrice: D(1), discount: D(0) }],
    });

    expect((await getProjectPurchaseReport(db, f.users.owner, { projectId: f.projectA })).summary.poCount).toBe(1);
    expect((await getProjectPurchaseReport(db, f.users.owner, { projectId: f.projectA, q: a.number })).pos[0]!.lines).toHaveLength(2);
    const byLine = await getProjectPurchaseReport(db, f.users.owner, { projectId: f.projectA, q: 'ทราย' });
    expect(byLine.pos[0]!.lines.map((l) => l.description)).toEqual(['ทราย']);
    expect(byLine.summary.amount).toBe(50);
    expect((await getProjectPurchaseReport(db, f.users.owner, { projectId: f.projectA, q: 'ไม่มีแน่นอน' })).pos).toEqual([]);
  });

  test('the date range filters by the day the PO was made', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await po(db, f, f.vendorCo, [{ description: 'ปูน', qty: 1, unitPrice: 100 }]);
    const today = bangkokDateString();
    expect((await getProjectPurchaseReport(db, f.users.owner, { projectId: f.projectA, from: today, to: today })).summary.poCount).toBe(1);
    expect((await getProjectPurchaseReport(db, f.users.owner, { projectId: f.projectA, from: '2000-01-01', to: '2000-12-31' })).summary.poCount).toBe(0);
    await expect(getProjectPurchaseReport(db, f.users.owner, { projectId: f.projectA, from: '2026-12-01', to: '2026-11-01' })).rejects.toMatchObject({ status: 400 });
  });

  test('site staff cannot report on another project', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(getProjectPurchaseReport(db, f.users.otherForeman, { projectId: f.projectA })).rejects.toMatchObject({ status: 403 });
    await expect(getProjectPurchaseReport(db, f.users.owner, { projectId: 'not-a-uuid' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('project purchasing report PDF', () => {
  test('renders through the download route', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await po(db, f, f.vendorCo, [{ description: 'ปูนซีเมนต์', qty: 3, unitPrice: 150 }]);
    const { vi } = await import('vitest');
    vi.doMock('@/db/client', () => ({ getDb: async () => db }));
    vi.doMock('@/server/auth/current-user', () => ({ requireUser: async () => f.users.owner }));
    const { GET } = await import('@/app/api/reports/project-purchase/route');
    const res = await GET(new Request(`http://localhost/api/reports/project-purchase?projectId=${f.projectA}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');

    const bad = await GET(new Request('http://localhost/api/reports/project-purchase?projectId='));
    expect(bad.status).toBe(400);
    vi.doUnmock('@/db/client');
    vi.doUnmock('@/server/auth/current-user');
  }, 60000);
});
