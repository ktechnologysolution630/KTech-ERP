import { describe, expect, test } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { milestones, prvs, vendors } from '@/db/schema';
import { D } from '@/domain/money';
import { listActivity } from '@/server/services/activity';
import { createPo } from '@/server/services/po';
import { createPrv } from '@/server/services/prv';
import { deleteVendors } from '@/server/services/vendor-delete';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

const addVendors = async (db: Awaited<ReturnType<typeof createTestDb>>, ...codes: string[]) =>
  (await db.insert(vendors).values(codes.map((code) => ({ code, name: `ร้าน ${code}`, type: 'COMPANY' as const }))).returning()).map((v) => v.id);

describe('deleting vendors', () => {
  test('only owner and admin may', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [id] = await addVendors(db, 'X-1');
    for (const u of [f.users.foreman, f.users.pm, f.users.buyer, f.users.buyerHead, f.users.finance]) {
      await expect(deleteVendors(db, u, [id!])).rejects.toMatchObject({ status: 403 });
    }
    expect(await deleteVendors(db, f.users.owner, [id!])).toEqual({ deletedIds: [id], inUse: [] });
    const [other] = await addVendors(db, 'X-2');
    expect((await deleteVendors(db, f.users.admin, [other!])).deletedIds).toEqual([other]);
  });

  test('takes the chosen ones only, and leaves a record of who did it', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [a, b, keep] = await addVendors(db, 'X-1', 'X-2', 'X-3');
    await deleteVendors(db, f.users.admin, [a!, b!]);

    expect((await db.select().from(vendors).where(inArray(vendors.id, [a!, b!, keep!]))).map((v) => v.id)).toEqual([keep]);
    const [log] = await listActivity(db, 'VENDOR', a!);
    expect(log).toMatchObject({ action: 'DELETE', userId: f.users.admin.id });
    expect(log!.note).toContain('X-1');
  });

  test('a vendor documents name stays and is reported, and the others still go', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [withPo, withClaim, withMilestone, free] = await addVendors(db, 'U-PO', 'U-PRV', 'U-MS', 'FREE');

    await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: withPo!,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ปูน', unitName: 'ถุง', qty: D(1), unitPrice: D(100), discount: D(0) }],
    });
    await createPrv(db, f.users.foreman, { projectId: f.projectA, vendorId: withClaim!, category: 'EXPENSE', items: [{ description: 'งาน', unitPrice: 100 }] });
    await db.insert(milestones).values({ projectId: f.projectA, vendorId: withMilestone, kind: 'PAY', seq: 1, title: 'งวด 1', amount: '100.00', createdBy: f.users.admin.id });

    const r = await deleteVendors(db, f.users.owner, [withPo!, withClaim!, withMilestone!, free!]);

    expect(r.deletedIds).toEqual([free]);
    expect(r.inUse.map((v) => v.code).sort()).toEqual(['U-MS', 'U-PO', 'U-PRV']);
    const left = await db.select({ code: vendors.code }).from(vendors).where(inArray(vendors.id, [withPo!, withClaim!, withMilestone!, free!]));
    expect(left.map((v) => v.code).sort()).toEqual(['U-MS', 'U-PO', 'U-PRV']);
    expect(await db.select().from(prvs).where(eq(prvs.vendorId, withClaim!))).toHaveLength(1);
  });

  test('nothing chosen, a bad id, or one already gone is reported', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [id] = await addVendors(db, 'X-1');
    await expect(deleteVendors(db, f.users.owner, [])).rejects.toMatchObject({ code: 'INVALID_VENDOR' });
    await expect(deleteVendors(db, f.users.owner, ['nope'])).rejects.toMatchObject({ code: 'INVALID_VENDOR' });
    await deleteVendors(db, f.users.owner, [id!]);
    await expect(deleteVendors(db, f.users.owner, [id!])).rejects.toMatchObject({ status: 404 });
  });

  test('every table that points at a vendor is checked', async () => {
    const db = await createTestDb();
    // Adding one of these needs a decision in vendor-delete.ts, or a delete fails with a database error
    const result = await db.execute(`
      select distinct c.conrelid::regclass::text as table_name
      from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'vendors'::regclass
      order by 1
    `);
    expect((result.rows as { table_name: string }[]).map((r) => r.table_name)).toEqual(['invoices', 'milestones', 'payables', 'pos', 'prvs', 'pvs', 'wht_certs']);
  });
});
