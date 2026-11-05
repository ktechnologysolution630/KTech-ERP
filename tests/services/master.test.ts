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
  listUsersWithRoles,
} from '@/server/services/master';
import { DomainError } from '@/domain/errors';
import { authenticate, loadSessionUserById } from '@/server/auth/session';

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

  test('menu visibility is kept per user and reaches their session', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const base = { email: 'menu@ktec.local', name: 'ทดสอบเมนู', roles: ['ENGINEER' as const], projectIds: [], active: true };

    // A new user sees everything unless told otherwise
    const created = await upsertUser(db, f.users.admin, { ...base, password: 'Passw0rd99' });
    expect((await loadSessionUserById(db, created.id))?.hiddenMenus).toEqual([]);

    await upsertUser(db, f.users.admin, { ...base, id: created.id, hiddenMenus: ['STOCK', 'FINANCE'] });
    expect((await loadSessionUserById(db, created.id))?.hiddenMenus).toEqual(['STOCK', 'FINANCE']);
    const listed = (await listUsersWithRoles(db, f.users.admin)).find((u) => u.id === created.id);
    expect(listed?.hiddenMenus).toEqual(['STOCK', 'FINANCE']);

    // A save that does not mention menus leaves the choice alone; an empty list shows everything again
    await upsertUser(db, f.users.admin, { ...base, id: created.id, name: 'เปลี่ยนชื่อ' });
    expect((await loadSessionUserById(db, created.id))?.hiddenMenus).toEqual(['STOCK', 'FINANCE']);
    await upsertUser(db, f.users.admin, { ...base, id: created.id, hiddenMenus: [] });
    expect((await loadSessionUserById(db, created.id))?.hiddenMenus).toEqual([]);

    // Only known sections, and only people who manage users
    await expect(upsertUser(db, f.users.admin, { ...base, id: created.id, hiddenMenus: ['NOPE' as never] })).rejects.toMatchObject({ code: 'INVALID_USER' });
    await expect(upsertUser(db, f.users.pm, { ...base, id: created.id, hiddenMenus: [] })).rejects.toMatchObject({ status: 403 });
  });

  test('user management guards: passwords, duplicates, self-lockout, last admin', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const base = { name: 'ทดสอบ', roles: ['FOREMAN' as const], projectIds: [], active: true };

    await expect(upsertUser(db, f.users.admin, { ...base, email: 'a@ktec.local' })).rejects.toMatchObject({ code: 'INVALID_USER' });
    await expect(upsertUser(db, f.users.admin, { ...base, email: 'a@ktec.local', password: 'short1' })).rejects.toMatchObject({ code: 'INVALID_USER' });
    await expect(upsertUser(db, f.users.admin, { ...base, email: 'a@ktec.local', password: 'onlyletters' })).rejects.toMatchObject({ code: 'INVALID_USER' });
    await expect(upsertUser(db, f.users.admin, { ...base, email: f.users.pm.email, password: 'Passw0rd99' })).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
    await expect(upsertUser(db, f.users.pm, { ...base, email: 'b@ktec.local', password: 'Passw0rd99' })).rejects.toMatchObject({ status: 403 });
    await expect(listUsersWithRoles(db, f.users.pm)).rejects.toMatchObject({ status: 403 });

    // Editing keeps the password when none is given
    const u = await upsertUser(db, f.users.admin, { ...base, email: 'a@ktec.local', password: 'Passw0rd99' });
    await upsertUser(db, f.users.admin, { ...base, id: u.id, email: 'a@ktec.local', name: 'ชื่อใหม่' });
    expect(await authenticate(db, 'a@ktec.local', 'Passw0rd99')).toMatchObject({ name: 'ชื่อใหม่' });
    // Deactivated users cannot log in
    await upsertUser(db, f.users.admin, { ...base, id: u.id, email: 'a@ktec.local', active: false });
    expect(await authenticate(db, 'a@ktec.local', 'Passw0rd99')).toBeNull();

    // An admin cannot lock themselves out
    const admin = (await listUsersWithRoles(db, f.users.admin)).find((x) => x.id === f.users.admin.id)!;
    await expect(
      upsertUser(db, f.users.admin, { ...admin, roles: ['FINANCE'], password: undefined }),
    ).rejects.toMatchObject({ code: 'SELF_LOCKOUT' });
    // Demoting another admin/owner is fine while the actor still manages users
    const owner = (await listUsersWithRoles(db, f.users.admin)).find((x) => x.id === f.users.owner.id)!;
    await upsertUser(db, f.users.admin, { ...owner, roles: ['FINANCE'] });
    expect((await listUsersWithRoles(db, f.users.admin)).find((x) => x.id === f.users.owner.id)?.roles).toEqual(['FINANCE']);
    await expect(resetPassword(db, f.users.admin, f.users.pm.id, '123')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
  });
});
