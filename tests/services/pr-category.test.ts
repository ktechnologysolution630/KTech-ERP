import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { D } from '@/domain/money';
import { createPr, getPr, updatePr } from '@/server/services/pr';

const line = { description: 'ท่อ PVC 4 นิ้ว', unitName: 'เส้น', qty: D(10), estUnitPrice: null, neededDate: null, note: '' };

describe('PR line category', () => {
  test('is saved on create and on edit', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const pr = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [{ ...line, category: 'งานสุขาภิบาล' }] });
    expect((await getPr(db, f.users.pm, pr.id)).lines[0]).toMatchObject({ category: 'งานสุขาภิบาล' });

    await updatePr(db, f.users.pm, pr.id, { lines: [{ ...line, category: 'งานระบบไฟฟ้าและสื่อสาร' }] });
    expect((await getPr(db, f.users.pm, pr.id)).lines[0]).toMatchObject({ category: 'งานระบบไฟฟ้าและสื่อสาร' });
  });

  test('outside the list is refused; none at all is allowed for older callers', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(createPr(db, f.users.pm, { projectId: f.projectA, lines: [{ ...line, category: 'มั่ว' }] })).rejects.toMatchObject({ status: 400 });
    const pr = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [line] });
    expect((await getPr(db, f.users.pm, pr.id)).lines[0]).toMatchObject({ category: null });
  });

  test('the item group is saved with the line and must sit under its category', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const pr = await createPr(db, f.users.pm, { projectId: f.projectA, lines: [{ ...line, category: 'งานสุขาภิบาล', itemGroup: 'ท่อและข้อต่อน้ำดี' }] });
    expect((await getPr(db, f.users.pm, pr.id)).lines[0]).toMatchObject({ category: 'งานสุขาภิบาล', itemGroup: 'ท่อและข้อต่อน้ำดี' });

    await updatePr(db, f.users.pm, pr.id, { lines: [{ ...line, category: 'งานสุขาภิบาล', itemGroup: 'สุขภัณฑ์' }] });
    expect((await getPr(db, f.users.pm, pr.id)).lines[0]).toMatchObject({ itemGroup: 'สุขภัณฑ์' });

    await updatePr(db, f.users.pm, pr.id, { lines: [{ ...line, category: 'งานสุขาภิบาล', itemGroup: '' }] });
    expect((await getPr(db, f.users.pm, pr.id)).lines[0]).toMatchObject({ itemGroup: null });

    await expect(updatePr(db, f.users.pm, pr.id, { lines: [{ ...line, category: 'งานสุขาภิบาล', itemGroup: 'เหล็กเสริม' }] })).rejects.toMatchObject({ code: 'INVALID_PR' });
    await expect(createPr(db, f.users.pm, { projectId: f.projectA, lines: [{ ...line, itemGroup: 'เหล็กเสริม' }] })).rejects.toMatchObject({ code: 'INVALID_PR' });
  });

  test('editing a combined PR keeps which lines are goods and which are work', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const lines = [
      { ...line, lineKind: 'GOODS' as const, estUnitPrice: 150 },
      { ...line, description: 'ค่าแรงเดินท่อ', unitName: 'งาน', lineKind: 'LABOR' as const, estUnitPrice: 180 },
    ];
    const pr = await createPr(db, f.users.pm, { projectId: f.projectA, prType: 'GOODS_AND_LABOR', lines });
    await updatePr(db, f.users.pm, pr.id, { prType: 'GOODS_AND_LABOR', lines });
    expect((await getPr(db, f.users.pm, pr.id)).lines.map((l) => l.lineKind).sort()).toEqual(['GOODS', 'LABOR']);
  });
});
