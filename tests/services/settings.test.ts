import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { getSettings, updateSettings } from '@/server/services/settings';
import { seedBasics } from '../helpers/fixtures';
import { DomainError } from '@/domain/errors';

describe('settings service', () => {
  test('settings default limit 50000 and owner/admin can update', async () => {
    const db = await createTestDb();
    expect((await getSettings(db)).poApprovalLimit).toBe('50000.00');
    const f = await seedBasics(db);
    const updated = await updateSettings(db, f.users.owner, {
      companyName: 'บริษัท เค เทค จำกัด',
      poApprovalLimit: '100000.00',
    });
    expect(updated.companyName).toBe('บริษัท เค เทค จำกัด');
    expect(updated.poApprovalLimit).toBe('100000.00');
    await expect(
      updateSettings(db, f.users.foreman, { poApprovalLimit: '10.00' }),
    ).rejects.toThrow(DomainError);
  });
});
