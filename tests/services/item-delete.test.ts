import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { D } from '@/domain/money';
import { listItems, upsertItem } from '@/server/services/master';
import { createPr } from '@/server/services/pr';
import { deleteItems } from '@/server/services/item-delete';

describe('deleting items from the register', () => {
  test('unused items go; items on a PR are switched off instead', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await upsertItem(db, f.users.owner, { code: 'AA01-X', name: 'ของทดสอบ', unitName: 'ชิ้น', active: true });
    const before = await listItems(db);
    const spare = before.find((i) => i.code === 'AA01-X')!;
    // The seeded cement is put on a PR, so it must stay
    await createPr(db, f.users.pm, {
      projectId: f.projectA,
      lines: [{ itemId: f.itemCement, description: 'ปูน', unitName: 'ถุง', qty: D(1), estUnitPrice: null, neededDate: null }],
    });

    const r = await deleteItems(db, f.users.owner, [spare.id, f.itemCement]);
    expect(r.deleted).toBe(1);
    expect(r.deactivated.map((d) => d.id)).toEqual([f.itemCement]);
    const after = await listItems(db);
    expect(after.find((i) => i.id === spare.id)).toBeUndefined();
    expect(after.find((i) => i.id === f.itemCement)).toMatchObject({ active: false });
  });

  test('only owner and admin may delete; an empty selection is refused', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(deleteItems(db, f.users.buyer, [f.itemCement])).rejects.toMatchObject({ status: 403 });
    await expect(deleteItems(db, f.users.admin, [])).rejects.toMatchObject({ status: 400 });
    expect((await deleteItems(db, f.users.admin, [f.itemCement])).deleted).toBe(1);
  });
});
