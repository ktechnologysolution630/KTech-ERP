import { describe, expect, test } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { milestones, payables, prvs, vendors } from '@/db/schema';
import { D } from '@/domain/money';
import { listActivity } from '@/server/services/activity';
import { upsertVendor } from '@/server/services/master';
import { createPo, getPo } from '@/server/services/po';
import { createPrv, deletePrv, transitionPrv } from '@/server/services/prv';
import { cancelPv, createPv } from '@/server/services/pv';
import { deleteVendors } from '@/server/services/vendor-delete';
import { getVendorDetail, updateVendor } from '@/server/services/vendor-detail';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

const addVendors = async (db: Awaited<ReturnType<typeof createTestDb>>, ...codes: string[]) =>
  (await db.insert(vendors).values(codes.map((code) => ({ code, name: `ร้าน ${code}`, type: 'COMPANY' as const }))).returning()).map((v) => v.id);

describe('a vendor\'s detail', () => {
  test('shows the vendor and its documents to office roles', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [id] = await addVendors(db, 'D-1');
    expect((await getVendorDetail(db, f.users.buyer, id!)).documents).toEqual([]);

    const claim = await createPrv(db, f.users.foreman, { projectId: f.projectA, vendorId: id!, category: 'EXPENSE', items: [{ description: 'งาน', unitPrice: 100 }] });
    for (const u of [f.users.buyer, f.users.buyerHead, f.users.finance, f.users.owner, f.users.admin]) {
      const { vendor, documents } = await getVendorDetail(db, u, id!);
      expect(vendor.code).toBe('D-1');
      expect(documents).toEqual([{ label: 'ใบขอเบิก PRV', number: claim.prvNumber, href: `/prv/${claim.id}`, cancelled: false }]);
    }
  });

  test('site staff are refused, since it shows bank details across projects', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(getVendorDetail(db, f.users.foreman, f.vendorCo)).rejects.toMatchObject({ status: 403 });
    await expect(getVendorDetail(db, f.users.pm, f.vendorCo)).rejects.toMatchObject({ status: 403 });
  });

  test('an unknown or malformed id is not found', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(getVendorDetail(db, f.users.buyer, 'nope')).rejects.toMatchObject({ status: 404 });
    await expect(getVendorDetail(db, f.users.buyer, '00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ status: 404 });
  });
});

describe('editing a vendor', () => {
  const edit = {
    name: 'ร้านแก้แล้ว',
    type: 'INDIVIDUAL' as const,
    taxId: null,
    branch: '00000',
    address: 'ที่อยู่หลัก',
    altAddress: 'ที่อยู่สำรอง',
    contactPerson: 'คุณผู้ติดต่อ',
    phone: '081-000-0000',
    email: 'shop@example.com',
    fax: '02-000-0000',
    suppliedItems: 'ปูน',
    defaultCreditDays: 15,
    defaultWhtRate: 3,
    bankName: 'ธนาคารตัวอย่าง',
    bankAccountNo: '123',
    bankAccountName: 'ร้านแก้แล้ว',
  };

  test('saves every field, keeps the code and active state, and logs the fields changed', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [id] = await addVendors(db, 'E-1');
    await db.update(vendors).set({ active: false }).where(eq(vendors.id, id!));

    const saved = await updateVendor(db, f.users.buyer, id!, edit);

    expect(saved).toMatchObject({ ...edit, code: 'E-1', active: false });
    const [log] = await listActivity(db, 'VENDOR', id!);
    expect(log).toMatchObject({ action: 'UPDATE', userId: f.users.buyer.id });
    expect(log!.note).toContain('bankAccountNo');
    expect(log!.note).not.toContain('branch');
  });

  test('only those who manage master data may', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [id] = await addVendors(db, 'E-1');
    for (const u of [f.users.foreman, f.users.pm, f.users.finance]) {
      await expect(updateVendor(db, u, id!, edit)).rejects.toMatchObject({ status: 403 });
    }
  });

  test('a bad tax id is refused and an unknown vendor is not found', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [id] = await addVendors(db, 'E-1');
    await expect(updateVendor(db, f.users.buyer, id!, { ...edit, taxId: '123' })).rejects.toMatchObject({ code: 'INVALID_VENDOR' });
    await expect(updateVendor(db, f.users.buyer, 'nope', edit)).rejects.toMatchObject({ status: 404 });
  });

  test('a form that does not show the new fields leaves them alone', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [id] = await addVendors(db, 'E-1');
    await updateVendor(db, f.users.buyer, id!, edit);

    await upsertVendor(db, f.users.buyer, { code: 'E-1', name: 'ร้านแก้แล้ว' });
    await upsertVendor(db, f.users.buyer, { id: id!, code: 'E-1', name: 'ร้านแก้แล้ว' });

    const [saved] = await db.select().from(vendors).where(eq(vendors.id, id!));
    expect(saved).toMatchObject({ contactPerson: 'คุณผู้ติดต่อ', altAddress: 'ที่อยู่สำรอง', email: 'shop@example.com', fax: '02-000-0000', suppliedItems: 'ปูน' });
  });

  test('a purchase order reads the details', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [id] = await addVendors(db, 'E-1');
    await updateVendor(db, f.users.buyer, id!, { ...edit, taxId: '0105551112223' });
    const created = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: id!,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ปูน', unitName: 'ถุง', qty: D(1), unitPrice: D(100), discount: D(0) }],
    });

    expect(await getPo(db, f.users.buyer, created.id)).toMatchObject({
      vendorAltAddress: 'ที่อยู่สำรอง',
      vendorContactPerson: 'คุณผู้ติดต่อ',
      vendorTaxId: '0105551112223',
      vendorPhone: '081-000-0000',
      vendorEmail: 'shop@example.com',
      vendorFax: '02-000-0000',
    });
  });
});

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

  test('says which documents hold a vendor, with a page to open each', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [withPo, withClaim, withMilestone] = await addVendors(db, 'U-PO', 'U-PRV', 'U-MS');
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: withPo!,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ปูน', unitName: 'ถุง', qty: D(1), unitPrice: D(100), discount: D(0) }],
    });
    const claim = await createPrv(db, f.users.foreman, { projectId: f.projectA, vendorId: withClaim!, category: 'EXPENSE', items: [{ description: 'งาน', unitPrice: 100 }] });
    await db.insert(milestones).values({ projectId: f.projectA, vendorId: withMilestone, kind: 'PAY', seq: 1, title: 'งวด 1', amount: '100.00', createdBy: f.users.admin.id });

    const { inUse } = await deleteVendors(db, f.users.owner, [withPo!, withClaim!, withMilestone!]);
    const docsOf = (code: string) => inUse.find((v) => v.code === code)?.documents;
    expect(docsOf('U-PO')).toEqual([{ label: 'ใบสั่งซื้อ PO', number: po.number, href: `/po/${po.id}`, cancelled: false }]);
    expect(docsOf('U-PRV')).toEqual([{ label: 'ใบขอเบิก PRV', number: claim.prvNumber, href: `/prv/${claim.id}`, cancelled: false }]);
    expect(docsOf('U-MS')).toEqual([{ label: 'งวดงาน', number: 'งวด 1', href: `/labor-payments/${f.projectA}`, cancelled: false }]);
  });

  test('once its claim is deleted, the cancelled payable left behind does not hold the vendor', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [id] = await addVendors(db, 'U-PRV');
    const claim = await createPrv(db, f.users.foreman, { projectId: f.projectA, vendorId: id!, category: 'EXPENSE', items: [{ description: 'งาน', unitPrice: 100 }] });
    await transitionPrv(db, f.users.foreman, claim.id, 'submit');
    await transitionPrv(db, f.users.pm, claim.id, 'verify');
    await transitionPrv(db, f.users.owner, claim.id, 'approve');

    // The claim and its open payable both show until the claim goes
    const held = await deleteVendors(db, f.users.owner, [id!]);
    expect(held.inUse[0]!.documents.map((d) => d.label).sort()).toEqual(['รายการตั้งจ่าย', 'ใบขอเบิก PRV'].sort());
    expect(held.inUse[0]!.documents.find((d) => d.label === 'รายการตั้งจ่าย')?.number).toBe(claim.prvNumber);

    await deletePrv(db, f.users.owner, claim.id);
    expect((await deleteVendors(db, f.users.owner, [id!])).deletedIds).toEqual([id]);
    expect(await db.select().from(payables).where(eq(payables.vendorId, id!))).toEqual([]);
  });

  test('a cancelled document still holds the vendor, and says it is cancelled', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const [id] = await addVendors(db, 'U-PV');
    const claim = await createPrv(db, f.users.foreman, { projectId: f.projectA, vendorId: id!, category: 'EXPENSE', items: [{ description: 'งาน', unitPrice: 100 }] });
    await transitionPrv(db, f.users.foreman, claim.id, 'submit');
    await transitionPrv(db, f.users.pm, claim.id, 'verify');
    await transitionPrv(db, f.users.owner, claim.id, 'approve');
    const [payable] = await db.select().from(payables).where(eq(payables.vendorId, id!));
    const pv = await createPv(db, f.users.finance, { vendorId: id!, payableIds: [payable!.id], whtRates: { [payable!.id]: 0 } });
    await cancelPv(db, f.users.finance, pv.id, 'ทำใหม่');
    await deletePrv(db, f.users.owner, claim.id);

    const { deletedIds, inUse } = await deleteVendors(db, f.users.owner, [id!]);
    expect(deletedIds).toEqual([]);
    expect(inUse[0]!.documents).toEqual(
      expect.arrayContaining([
        { label: 'ใบสำคัญจ่าย PV', number: pv.number, href: `/pv/${pv.id}`, cancelled: true },
        expect.objectContaining({ label: 'รายการตั้งจ่าย', cancelled: true }),
      ]),
    );
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
    expect((result.rows as { table_name: string }[]).map((r) => r.table_name)).toEqual(['invoices', 'milestones', 'payables', 'pos', 'prs', 'prvs', 'pvs', 'sales_docs', 'stock_docs', 'wht_certs']);
  });
});
