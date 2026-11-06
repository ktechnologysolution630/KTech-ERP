import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import {
  decideStockAdjust,
  getStockPageData,
  recordStockMovement,
  requestStockAdjust,
  summarizeStock,
  upsertStockItem,
} from '@/server/services/stock';
import { eq } from 'drizzle-orm';
import { attachments, comments, payables, prvItems } from '@/db/schema';
import { listActivity } from '@/server/services/activity';
import { addAttachment, addComment, readStoredFile } from '@/server/services/attachments';
import { listOpenPayables } from '@/server/services/payable';
import { createPrv, deletePrv, getPrvs, getPrvById, transitionPrv, type CreatePrvInput } from '@/server/services/prv';
import { approvePv, cancelPv, createPv, markPvPaid, submitPv } from '@/server/services/pv';

describe('Stock & PRV Services', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let f: Awaited<ReturnType<typeof seedBasics>>;

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
  });

  const qtyAt = async (itemId: string, projectId: string | null) => {
    const data = await getStockPageData(db, f.users.owner);
    const item = data.items.find((i) => i.id === itemId)!;
    return item.balances.find((b) => b.projectId === projectId)?.quantity ?? 0;
  };

  it('Stock: creates stock item, records receive and issue, updates balance & overview', async () => {
    const item = await upsertStockItem(db, f.users.buyer, {
      sku: 'MAT-TEST-01',
      name: 'เหล็กเส้นกลม RB9',
      category: 'งานโครงสร้าง',
      unit: 'เส้น',
      unitCost: 150,
      reorderPoint: 20,
    });
    expect(item.sku).toBe('MAT-TEST-01');

    await recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, type: 'RECEIVE', quantity: 50, unitCost: 150 });
    let summary = summarizeStock((await getStockPageData(db, f.users.owner)).items);
    expect(summary.totalValue).toBe(7500);

    await recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, type: 'ISSUE', quantity: 15, locationUsed: 'ฐานราก F1' });
    const data = await getStockPageData(db, f.users.owner);
    const found = data.items.find((i) => i.id === item.id);
    expect(found).toMatchObject({ totalQty: 35, totalValue: 35 * 150 });
    // Issues are valued at standard cost and show up in the monthly flow
    const thisMonth = data.monthly.at(-1)!;
    expect(thisMonth).toMatchObject({ receiveValue: 7500, issueValue: 2250, receiveCount: 1, issueCount: 1 });
    summary = summarizeStock(data.items);
    expect(summary.lowStock).toHaveLength(0);
  });

  it('Stock: refuses over-issue, requires a transfer target, and transfers between locations', async () => {
    const item = await upsertStockItem(db, f.users.buyer, { name: 'ทราย', unit: 'คิว', unitCost: 400 });
    expect(item.sku).toMatch(/^MAT-/);
    await recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'RECEIVE', quantity: 10 });

    await expect(
      recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'ISSUE', quantity: 11 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await expect(
      recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'TRANSFER', quantity: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_STOCK' });
    await expect(
      recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'TRANSFER', quantity: 1, targetProjectId: null }),
    ).rejects.toMatchObject({ code: 'INVALID_STOCK' });

    await recordStockMovement(db, f.users.buyer, { stockItemId: item.id, projectId: null, type: 'TRANSFER', quantity: 4, targetProjectId: f.projectA });
    expect(await qtyAt(item.id, null)).toBe(6);
    expect(await qtyAt(item.id, f.projectA)).toBe(4);
    // Nothing changed after a refused movement
    await expect(
      recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, type: 'TRANSFER', quantity: 5, targetProjectId: null }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await qtyAt(item.id, f.projectA)).toBe(4);
  });

  it('Stock: permissions by role and project', async () => {
    const item = await upsertStockItem(db, f.users.buyer, { name: 'ตะปู', unit: 'กล่อง' });
    await expect(upsertStockItem(db, f.users.foreman, { name: 'x' })).rejects.toMatchObject({ status: 403 });
    // Site staff: own project only, not the central store or another project
    await expect(
      recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectB, type: 'RECEIVE', quantity: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: null, type: 'RECEIVE', quantity: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      recordStockMovement(db, f.users.finance, { stockItemId: item.id, projectId: f.projectA, type: 'RECEIVE', quantity: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    // Site staff only see the central store and their own projects
    const seen = await getStockPageData(db, f.users.otherForeman);
    expect(seen.locations.map((l) => l.projectId)).toEqual([null, f.projectB]);
    expect(seen.permissions).toMatchObject({ manageItems: false, approveAdjust: false, moveCentral: false, movableProjectIds: [f.projectB] });
  });

  it('Stock: adjustment request workflow with approval', async () => {
    const item = await upsertStockItem(db, f.users.buyer, { sku: 'MAT-TEST-02', name: 'ปูนซีเมนต์ปอร์ตแลนด์', unit: 'ถุง', unitCost: 140 });
    await recordStockMovement(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, type: 'RECEIVE', quantity: 20 });

    // The system quantity is read on the server (20), so the difference is -2
    const req = await requestStockAdjust(db, f.users.foreman, {
      stockItemId: item.id,
      projectId: f.projectA,
      countedQty: 18,
      reason: 'ถุงแตกชำรุดระหว่างฝนตก',
    });
    expect(req).toMatchObject({ status: 'PENDING', currentQty: '20.000', differenceQty: '-2.000' });
    await expect(
      requestStockAdjust(db, f.users.foreman, { stockItemId: item.id, projectId: f.projectA, countedQty: 20, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_STOCK' });

    await expect(decideStockAdjust(db, f.users.foreman, req.id, true)).rejects.toMatchObject({ status: 403 });
    expect(await decideStockAdjust(db, f.users.owner, req.id, true)).toBe('APPROVED');
    await expect(decideStockAdjust(db, f.users.owner, req.id, true)).rejects.toMatchObject({ status: 409 });
    expect(await qtyAt(item.id, f.projectA)).toBe(18);

    // Approvers cannot approve their own request
    const own = await requestStockAdjust(db, f.users.buyerHead, { stockItemId: item.id, projectId: f.projectA, countedQty: 17, reason: 'นับใหม่' });
    await expect(decideStockAdjust(db, f.users.buyerHead, own.id, true)).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    expect(await decideStockAdjust(db, f.users.owner, own.id, false)).toBe('REJECTED');
    expect(await qtyAt(item.id, f.projectA)).toBe(18);
  });

  const claim = (overrides: Partial<CreatePrvInput> = {}): CreatePrvInput => ({
    projectId: f.projectA,
    vendorId: f.vendorPerson,
    category: 'CONTRACTOR_PROGRESS',
    installmentNo: 1,
    retentionPercent: 5,
    whtRate: 3,
    vatRate: 7,
    notes: 'เบิกงวดที่ 1 ฐานราก',
    items: [{ description: 'งานเทเสาเข็ม', quantity: 1, unit: 'งาน', unitPrice: 200000, progressPercent: 50 }],
    ...overrides,
  });

  it('PRV: keeps each line\'s document and PO numbers, and how payment is asked for', async () => {
    const saved = await createPrv(db, f.users.foreman, claim({
      payMethod: 'TRANSFER',
      payBank: 'KBANK/สาขาซอยวัชรพล',
      items: [{ description: 'งานเทเสาเข็ม', documentNo: ' INV-1 ', poNumber: 'K69-001-260001', unitPrice: 200000, progressPercent: 50 }],
    }));
    // Without a quantity the line is one lot, so the amount is price × progress
    expect(saved).toMatchObject({ totalAmount: '100000.00', payMethod: 'TRANSFER', payBank: 'KBANK/สาขาซอยวัชรพล' });
    const detail = await getPrvById(db, f.users.foreman, saved.id);
    expect(detail?.items[0]).toMatchObject({ documentNo: 'INV-1', poNumber: 'K69-001-260001', quantity: '1.000', amount: '100000.00' });

    // Optional, and only the accounts on the form
    const plain = await createPrv(db, f.users.foreman, claim());
    expect(plain).toMatchObject({ payMethod: null, payBank: null });
    expect((await getPrvById(db, f.users.foreman, plain.id))?.items[0]).toMatchObject({ documentNo: '', poNumber: '' });
    await expect(createPrv(db, f.users.foreman, claim({ payBank: 'ธนาคารอื่น' as never }))).rejects.toMatchObject({ code: 'INVALID_PRV' });
    await expect(createPrv(db, f.users.foreman, claim({ payMethod: 'CASH' as never }))).rejects.toMatchObject({ code: 'INVALID_PRV' });
  });

  it('PRV: computes the certificate, enforces the approval chain and raises a payable', async () => {
    const prv = await createPrv(db, f.users.foreman, claim());
    expect(prv.prvNumber).toContain('PRV-');
    // 200,000 × 50% = 100,000 claimed; retention 5% = 5,000; WHT 3% of the 95,000 paid now;
    // VAT 7% of the full 100,000
    expect(prv).toMatchObject({
      totalAmount: '100000.00',
      retentionAmount: '5000.00',
      whtAmount: '2850.00',
      vatAmount: '7000.00',
      netAmount: '99150.00',
      status: 'DRAFT',
    });

    // Steps must follow the chain and come from the right people
    await expect(transitionPrv(db, f.users.owner, prv.id, 'approve')).rejects.toMatchObject({ status: 409 });
    await transitionPrv(db, f.users.foreman, prv.id, 'submit');
    await expect(transitionPrv(db, f.users.foreman, prv.id, 'verify')).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    await expect(transitionPrv(db, f.users.buyer, prv.id, 'verify')).rejects.toMatchObject({ status: 403 });
    await expect(transitionPrv(db, f.users.pm, prv.id, 'reject')).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await transitionPrv(db, f.users.pm, prv.id, 'verify');
    await expect(transitionPrv(db, f.users.pm, prv.id, 'approve')).rejects.toMatchObject({ status: 403 });
    expect(await transitionPrv(db, f.users.owner, prv.id, 'approve')).toBe('APPROVED');

    const fetched = await getPrvById(db, f.users.owner, prv.id);
    expect(fetched).toMatchObject({ verifiedBy: f.users.pm.id, approvedBy: f.users.owner.id, payeeName: expect.any(String) });
    expect(fetched?.items).toHaveLength(1);

    // Approval leaves an open payable for finance: paid now before VAT + VAT
    const [payable] = await db.select().from(payables).where(eq(payables.vendorId, f.vendorPerson));
    expect(payable).toMatchObject({ sourceType: 'CONTRACTOR_CLAIM', beforeVat: '95000.00', vat: '7000.00', gross: '102000.00', status: 'OPEN' });
    expect(payable.note).toContain(prv.prvNumber);
  });

  describe('deleting a PRV', () => {
    const approved = async () => {
      const prv = await createPrv(db, f.users.foreman, claim());
      await transitionPrv(db, f.users.foreman, prv.id, 'submit');
      await transitionPrv(db, f.users.pm, prv.id, 'verify');
      await transitionPrv(db, f.users.owner, prv.id, 'approve');
      const [payable] = await db.select().from(payables).where(eq(payables.vendorId, f.vendorPerson));
      return { prv, payable: payable! };
    };
    const payableStatus = async (id: string) => (await db.select().from(payables).where(eq(payables.id, id)))[0]?.status;

    it('only owner and admin may, and it leaves a record of who did', async () => {
      const prv = await createPrv(db, f.users.foreman, claim());
      for (const u of [f.users.foreman, f.users.pm, f.users.buyer, f.users.buyerHead, f.users.finance]) {
        await expect(deletePrv(db, u, prv.id)).rejects.toMatchObject({ status: 403 });
      }
      await deletePrv(db, f.users.admin, prv.id);
      expect(await getPrvById(db, f.users.admin, prv.id)).toBeNull();
      const [log] = await listActivity(db, 'PRV', prv.id).then((rows) => rows.filter((r) => r.action === 'DELETE'));
      expect(log).toMatchObject({ userId: f.users.admin.id });
      expect(log!.note).toContain(prv.prvNumber);

      await expect(deletePrv(db, f.users.owner, prv.id)).rejects.toMatchObject({ status: 404 });
      await expect(deletePrv(db, f.users.owner, 'not-a-uuid')).rejects.toMatchObject({ status: 404 });
    });

    it('takes its lines, files and comments, and no other PRV is touched', async () => {
      const prv = await createPrv(db, f.users.foreman, claim());
      const other = await createPrv(db, f.users.foreman, claim());
      const file = await addAttachment(db, f.users.foreman, { entityType: 'PRV', entityId: prv.id, file: new File(['x'], 'a.pdf', { type: 'application/pdf' }) });
      await addComment(db, f.users.foreman, { entityType: 'PRV', entityId: prv.id, body: 'ตรวจแล้ว' });

      await deletePrv(db, f.users.owner, prv.id);

      expect(await db.select().from(prvItems).where(eq(prvItems.prvId, prv.id))).toEqual([]);
      expect(await db.select().from(attachments).where(eq(attachments.entityId, prv.id))).toEqual([]);
      expect(await db.select().from(comments).where(eq(comments.entityId, prv.id))).toEqual([]);
      expect(await readStoredFile(db, file.url.split('id=')[1]!)).toBeNull();
      expect(await getPrvById(db, f.users.owner, other.id)).not.toBeNull();
    });

    it('an approved one takes its open payable out of the payment queue, and no other', async () => {
      const { prv, payable } = await approved();
      const before = await createPrv(db, f.users.foreman, claim());
      await transitionPrv(db, f.users.foreman, before.id, 'submit');
      await transitionPrv(db, f.users.pm, before.id, 'verify');
      await transitionPrv(db, f.users.owner, before.id, 'approve');

      await deletePrv(db, f.users.owner, prv.id);

      expect(await payableStatus(payable.id)).toBe('CANCELLED');
      const open = await listOpenPayables(db, f.users.finance, {});
      expect(open.map((p) => p.id)).not.toContain(payable.id);
      expect(open.some((p) => p.note.startsWith(before.prvNumber))).toBe(true);
    });

    it('is refused once on a PV or paid, and allowed again after the PV is cancelled', async () => {
      const { prv, payable } = await approved();
      const pv = await createPv(db, f.users.finance, { vendorId: f.vendorPerson, payableIds: [payable.id], whtRates: { [payable.id]: 3 } });
      await expect(deletePrv(db, f.users.owner, prv.id)).rejects.toMatchObject({ code: 'PRV_IN_USE', status: 409 });
      expect(await getPrvById(db, f.users.owner, prv.id)).not.toBeNull();
      expect(await payableStatus(payable.id)).toBe('IN_PV');

      await cancelPv(db, f.users.finance, pv.id, 'ทำใหม่');
      await deletePrv(db, f.users.owner, prv.id);
      expect(await getPrvById(db, f.users.owner, prv.id)).toBeNull();
      expect(await payableStatus(payable.id)).toBe('CANCELLED');
    });

    it('is refused for good once paid', async () => {
      const { prv, payable } = await approved();
      const pv = await createPv(db, f.users.finance, { vendorId: f.vendorPerson, payableIds: [payable.id], whtRates: { [payable.id]: 3 } });
      await submitPv(db, f.users.finance, pv.id);
      await approvePv(db, f.users.owner, pv.id);
      await markPvPaid(db, f.users.finance, pv.id, { paidAt: '2026-11-05', payMethod: 'TRANSFER' });

      await expect(deletePrv(db, f.users.owner, prv.id)).rejects.toMatchObject({ code: 'PRV_IN_USE' });
      expect(await payableStatus(payable.id)).toBe('PAID');
    });
  });

  it('PRV: validates input, project access and visibility', async () => {
    await expect(createPrv(db, f.users.foreman, claim({ vendorId: '' }))).rejects.toMatchObject({ code: 'INVALID_PRV' });
    await expect(createPrv(db, f.users.foreman, claim({ items: [] }))).rejects.toMatchObject({ code: 'INVALID_PRV' });
    await expect(createPrv(db, f.users.foreman, claim({ projectId: f.projectB }))).rejects.toMatchObject({ status: 403 });
    await createPrv(db, f.users.foreman, claim());
    expect(await getPrvs(db, f.users.otherForeman)).toHaveLength(0);
    expect(await getPrvs(db, f.users.finance)).toHaveLength(1);
  });
});
