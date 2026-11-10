import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { prLines, prs } from '@/db/schema';
import { D } from '@/domain/money';
import { approvePr, cancelPr, createPr, getPr, submitPr } from '@/server/services/pr';
import { createPo } from '@/server/services/po';
import { deletePrs } from '@/server/services/pr-delete';
import { addComment } from '@/server/services/attachments';
import { seedBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';

const line = { description: 'ปูน', unitName: 'ถุง', category: 'งานโครงสร้าง' as const, qty: 5 };

describe('deleting PRs', () => {
  test('owner deletes test PRs with their lines; one ordered on a PO is kept', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const a = await createPr(db, f.users.foreman, { projectId: f.projectA, lines: [line] });
    await cancelPr(db, f.users.foreman, a.id);
    await addComment(db, f.users.foreman, { entityType: 'PR', entityId: a.id, body: 'ทดสอบ' });
    const b = await createPr(db, f.users.foreman, { projectId: f.projectA, lines: [line] });
    await submitPr(db, f.users.foreman, b.id);
    await approvePr(db, f.users.pm, b.id);
    const bDoc = await getPr(db, f.users.buyer, b.id);
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'PREPAID',
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ prLineId: bDoc.lines[0]!.id, description: 'ปูน', unitName: 'ถุง', qty: D(5), unitPrice: D(100) }],
    });

    await expect(deletePrs(db, f.users.foreman, [a.id])).rejects.toMatchObject({ status: 403 });

    const r = await deletePrs(db, f.users.owner, [a.id, b.id]);
    expect(r.deleted.map((d) => d.id)).toEqual([a.id]);
    expect(r.kept).toEqual([{ id: b.id, number: bDoc.number, poNumbers: [po.number] }]);
    expect(await db.select().from(prs).where(eq(prs.id, a.id))).toHaveLength(0);
    expect(await db.select().from(prLines).where(eq(prLines.prId, a.id))).toHaveLength(0);
    expect(await db.select().from(prs).where(eq(prs.id, b.id))).toHaveLength(1);
  });
});
