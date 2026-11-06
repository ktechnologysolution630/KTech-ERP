import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { items, units, vendors } from '@/db/schema';
import { UNKNOWN_UNIT, type VendorImportRow } from '@/domain/master-import';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { importItemCatalog, importVendorDirectory, importVendors, importItems } from '@/server/services/import';

describe('importing the vendor and item lists of a workbook', () => {
  // Made-up ids
  const row = (over: Partial<VendorImportRow> = {}): VendorImportRow => ({ name: 'ร้านใหม่ จำกัด', type: 'COMPANY', taxId: '0105551112223', branch: '00000', address: 'ที่อยู่ใหม่', phone: '02-111-1111', email: '', fax: '', ...over });

  test('issues a code for each new vendor', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const r = await importVendorDirectory(db, f.users.buyer, [row(), row({ name: 'ร้านสอง', taxId: null })]);
    expect(r).toEqual({ created: 2, updated: 0, unchanged: 0, errors: [] });
    const saved = await db.select().from(vendors).where(eq(vendors.name, 'ร้านใหม่ จำกัด'));
    expect(saved[0]).toMatchObject({ taxId: '0105551112223', address: 'ที่อยู่ใหม่', defaultCreditDays: 30, defaultWhtRate: 0, active: true });
    expect(saved[0]!.code).toMatch(/^V-/);
  });

  test('importing the same file again changes nothing', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await importVendorDirectory(db, f.users.buyer, [row()]);
    const before = await db.select().from(vendors);
    expect(await importVendorDirectory(db, f.users.buyer, [row()])).toEqual({ created: 0, updated: 0, unchanged: 1, errors: [] });
    expect(await db.select().from(vendors)).toEqual(before);
  });

  test('a vendor already here only has blanks filled, and keeps what people set', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await db.insert(vendors).values({ code: 'V-OLD', name: 'ร้านเดิม', taxId: null, address: '', phone: '099', bankName: 'กสิกรไทย', defaultCreditDays: 7, defaultWhtRate: 3 });
    const r = await importVendorDirectory(db, f.users.buyer, [row({ name: 'ร้านเดิม', phone: '02-222-2222', email: 'shop@example.com', fax: '02-333-3333' })]);
    expect(r).toMatchObject({ created: 0, updated: 1 });
    const [saved] = await db.select().from(vendors).where(eq(vendors.code, 'V-OLD'));
    expect(saved).toMatchObject({ taxId: '0105551112223', address: 'ที่อยู่ใหม่', phone: '099', email: 'shop@example.com', fax: '02-333-3333', bankName: 'กสิกรไทย', defaultCreditDays: 7, defaultWhtRate: 3 });
  });

  test('recognises a vendor by tax id even under another name', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await db.insert(vendors).values({ code: 'V-OLD', name: 'ชื่อเดิม', taxId: '0105551112223', address: 'x', phone: 'y' });
    expect(await importVendorDirectory(db, f.users.buyer, [row()])).toMatchObject({ created: 0, unchanged: 1 });
    expect(await db.select().from(vendors).where(eq(vendors.taxId, '0105551112223'))).toHaveLength(1);
  });

  test('another branch of the same company is another vendor', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await importVendorDirectory(db, f.users.buyer, [row(), row({ name: 'ร้านใหม่ จำกัด สาขา 2', branch: '00002' })]);
    expect(await db.select().from(vendors).where(eq(vendors.taxId, '0105551112223'))).toHaveLength(2);
  });

  test('adds new items with their unit, and leaves items already here alone', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const r = await importItemCatalog(db, f.users.buyer, [
      { code: 'N-1', name: 'ท่อ PVC', unitName: 'เส้น' },
      { code: 'N-2', name: 'ของที่ไม่รู้หน่วย', unitName: null },
      { code: 'MAT-001', name: 'ชื่อที่ไม่ควรทับ', unitName: 'ตัน' },
    ]);
    expect(r).toEqual({ created: 2, updated: 0, unchanged: 1, errors: [] });
    const rows = await db.select({ code: items.code, name: items.name, unit: units.name }).from(items).innerJoin(units, eq(units.id, items.unitId));
    expect(rows.find((i) => i.code === 'N-1')?.unit).toBe('เส้น');
    expect(rows.find((i) => i.code === 'N-2')?.unit).toBe(UNKNOWN_UNIT);
    expect(rows.find((i) => i.code === 'MAT-001')).toMatchObject({ name: 'ปูนซีเมนต์ปอร์ตแลนด์', unit: 'ถุง' });
  });

  test('only people who manage master data may import, and bad input is refused whole', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(importVendorDirectory(db, f.users.foreman, [row()])).rejects.toMatchObject({ status: 403 });
    await expect(importItemCatalog(db, f.users.finance, [{ code: 'A', name: 'B', unitName: null }])).rejects.toMatchObject({ status: 403 });
    await expect(importVendorDirectory(db, f.users.buyer, [row({ taxId: '123' })])).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    expect(await db.select().from(vendors).where(eq(vendors.name, 'ร้านใหม่ จำกัด'))).toEqual([]);
  });
});

describe('import service', () => {
  test('import vendors upserts by code and reports bad rows', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const r = await importVendors(db, f.users.buyer, [
      { รหัส: 'V100', ชื่อ: 'ร้าน ก', ประเภท: 'นิติบุคคล', เลขผู้เสียภาษี: '0105551112223' },
      { รหัส: '', ชื่อ: 'x' },
    ]);
    expect(r).toMatchObject({ created: 1, updated: 0 });
    expect(r.errors[0].row).toBe(2);

    const r2 = await importVendors(db, f.users.buyer, [
      { รหัส: 'V100', ชื่อ: 'ร้าน ก (แก้ไข)', ประเภท: 'นิติบุคคล' },
    ]);
    expect(r2).toMatchObject({ created: 0, updated: 1 });
  });

  test('import items creates unknown unit and upserts by code', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const r = await importItems(db, f.users.buyer, [
      { รหัส: 'M-100', ชื่อ: 'ท่อ PVC 4 นิ้ว', หน่วย: 'ท่อน', หมวด: 'ประปา' },
      { รหัส: 'M-101', ชื่อ: '', หน่วย: 'ท่อน' },
    ]);
    expect(r).toMatchObject({ created: 1, updated: 0 });
    expect(r.errors[0].row).toBe(2);
  });
});
