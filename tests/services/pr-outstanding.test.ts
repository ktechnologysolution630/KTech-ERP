import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { D } from '@/domain/money';
import { duplicatesOfOutstanding } from '@/domain/pr-outstanding';
import { approvePo, createPo, getPo, submitPo } from '@/server/services/po';
import { approvePr, closePr, createPr, getPr, submitPr } from '@/server/services/pr';
import { listOutstandingPrLines } from '@/server/services/pr-outstanding';
import { cancelReceipt, createReceipt } from '@/server/services/receipt';

describe('what a PR asked for and has not received yet', () => {
  test('ordered 10 and got 3 leaves 7 outstanding under its PR number, until the rest arrives or the PR is closed', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [
        { itemId: f.itemCement, description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(10) },
        { description: 'ตะปู 2 นิ้ว', unitName: 'กล่อง', qty: D(4) },
      ],
    });
    // A draft has asked for nothing yet
    expect(await listOutstandingPrLines(db, f.users.buyer)).toEqual([]);

    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const prDoc = await getPr(db, f.users.buyer, pr.id);
    const cementLine = prDoc.lines.find((l) => l.description === 'ปูนซีเมนต์')!;

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ prLineId: cementLine.id, description: 'ปูนซีเมนต์', unitName: 'ถุง', qty: D(10), unitPrice: D(150), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    const poLineId = (await getPo(db, f.users.buyer, po.id)).lines[0]!.id;
    const first = await createReceipt(db, f.users.foreman, { poId: po.id, receivedAt: '2026-11-02', lines: [{ poLineId, qty: D(3) }] });

    const open = await listOutstandingPrLines(db, f.users.buyer);
    expect(open.map((o) => [o.description, o.qty, o.orderedQty, o.receivedQty, o.outstandingQty])).toEqual([
      ['ปูนซีเมนต์', 10, 10, 3, 7],
      ['ตะปู 2 นิ้ว', 4, 0, 0, 4],
    ]);
    expect(open[0]).toMatchObject({ prId: pr.id, prNumber: prDoc.number, prStatus: 'APPROVED', projectId: f.projectA, itemId: f.itemCement, unitName: 'ถุง' });

    // Site staff see their own projects only
    expect(await listOutstandingPrLines(db, f.users.otherForeman)).toEqual([]);
    expect(await listOutstandingPrLines(db, f.users.buyer, { projectId: f.projectB })).toEqual([]);

    // A cancelled receipt is not goods received
    await cancelReceipt(db, f.users.buyerHead, first.id, 'นับผิด');
    expect((await listOutstandingPrLines(db, f.users.buyer))[0]).toMatchObject({ receivedQty: 0, outstandingQty: 10 });

    // Everything delivered: the line drops off, the other one stays
    await createReceipt(db, f.users.foreman, { poId: po.id, receivedAt: '2026-11-03', lines: [{ poLineId, qty: D(10) }] });
    expect((await listOutstandingPrLines(db, f.users.buyer)).map((o) => o.description)).toEqual(['ตะปู 2 นิ้ว']);

    // Closing the PR says the rest is no longer wanted
    await closePr(db, f.users.buyer, pr.id);
    expect(await listOutstandingPrLines(db, f.users.buyer)).toEqual([]);
  });

  test('a line being typed is matched to outstanding lines of the same project by item or by name', () => {
    const base = { prId: 'p1', prNumber: 'PR-6911-0001', prStatus: 'APPROVED' as const, projectId: 'A', projectCode: 'A', projectName: 'A', unitName: 'ถุง', qty: 10, orderedQty: 10, receivedQty: 3, outstandingQty: 7 };
    const outstanding = [
      { ...base, prLineId: 'l1', itemId: 'cement', description: 'ปูนซีเมนต์' },
      { ...base, prLineId: 'l2', itemId: null, description: 'ตะปู  2 นิ้ว' },
      { ...base, prLineId: 'l3', itemId: 'cement', description: 'ปูนซีเมนต์', projectId: 'B' },
      { ...base, prLineId: 'l4', itemId: 'cement', description: 'ปูนซีเมนต์', prId: 'self' },
    ];
    const find = (line: { itemId: string; description: string }) => duplicatesOfOutstanding(line, outstanding, { projectId: 'A', exceptPrId: 'self' }).map((o) => o.prLineId);
    // Same catalogue item, whatever it is called on the line
    expect(find({ itemId: 'cement', description: 'ปูนถุง' })).toEqual(['l1']);
    // Free text: spacing and letter case do not matter
    expect(find({ itemId: '', description: ' ตะปู 2 นิ้ว ' })).toEqual(['l2']);
    expect(find({ itemId: '', description: 'ปูนซีเมนต์' })).toEqual(['l1']);
    expect(find({ itemId: '', description: '' })).toEqual([]);
    expect(find({ itemId: 'sand', description: 'ทราย' })).toEqual([]);
    expect(duplicatesOfOutstanding({ itemId: 'cement', description: 'x' }, outstanding, { projectId: '' })).toEqual([]);
  });
});
