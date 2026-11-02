import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { importVendors, importItems } from '@/server/services/import';

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
