import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import {
  upsertVendor,
  upsertProject,
  upsertItem,
  upsertUser,
  setProjectMembers,
  resetPassword,
} from '@/server/services/master';
import { DomainError } from '@/domain/errors';
import { authenticate } from '@/server/auth/session';

describe('master service', () => {
  const baseVendor = {
    code: 'V-NEW',
    name: 'บริษัท ทดสอบ จำกัด',
    type: 'COMPANY' as const,
    taxId: '0105559999999',
    branch: '00000',
    address: 'กรุงเทพฯ',
    phone: '029999999',
    bankName: 'กสิกรไทย',
    bankAccountNo: '001-2-34567-8',
    bankAccountName: 'บจก. ทดสอบ',
    defaultCreditDays: 30,
    defaultWhtRate: 0,
    active: true,
  };

  test('vendor taxId must be 13 digits and branch 5 digits', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(
      upsertVendor(db, f.users.buyer, { ...baseVendor, taxId: '123' }),
    ).rejects.toThrow(DomainError);
    await expect(
      upsertVendor(db, f.users.buyer, { ...baseVendor, branch: '01' }),
    ).rejects.toThrow(DomainError);

    const saved = await upsertVendor(db, f.users.buyer, baseVendor);
    expect(saved.code).toBe('V-NEW');
  });

  test('foreman cannot manage vendors', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(upsertVendor(db, f.users.foreman, baseVendor)).rejects.toMatchObject({
      status: 403,
    });
  });

  test('project, item, user upsert and password reset', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const proj = await upsertProject(db, f.users.admin, {
      code: 'PJ-099',
      name: 'โครงการทดสอบ 99',
      active: true,
    });
    expect(proj.code).toBe('PJ-099');

    const item = await upsertItem(db, f.users.buyer, {
      code: 'IT-099',
      name: 'เหล็กเส้นข้ออ้อย DB12',
      unitName: 'เส้น',
      category: 'เหล็ก',
      active: true,
    });
    expect(item.code).toBe('IT-099');

    const newUser = await upsertUser(db, f.users.admin, {
      email: 'eng1@ktec.local',
      name: 'วิศวกร 1',
      password: 'InitPass123',
      roles: ['ENGINEER'],
      projectIds: [proj.id],
      active: true,
    });
    await setProjectMembers(db, f.users.admin, proj.id, [newUser.id, f.users.pm.id]);
    await resetPassword(db, f.users.admin, newUser.id, 'NewPass456');
    const authUser = await authenticate(db, 'eng1@ktec.local', 'NewPass456');
    expect(authUser?.projectIds).toContain(proj.id);
  });
});
