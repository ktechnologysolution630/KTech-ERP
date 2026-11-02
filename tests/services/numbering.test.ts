import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { nextDocNumber } from '@/server/services/numbering';

describe('numbering service', () => {
  test('numbers increment per prefix/month and use BE year', async () => {
    const db = await createTestDb();
    const at = new Date('2026-11-02T03:00:00Z');
    expect(await nextDocNumber(db, 'PO', at)).toBe('PO-6911-0001');
    expect(await nextDocNumber(db, 'PO', at)).toBe('PO-6911-0002');
    expect(await nextDocNumber(db, 'PR', at)).toBe('PR-6911-0001');
    expect(await nextDocNumber(db, 'PO', new Date('2026-12-01T03:00:00Z'))).toBe('PO-6912-0001');
  });
});
