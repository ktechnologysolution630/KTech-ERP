import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import {
  countUnreadNotifications,
  listNotifications,
  markAllRead,
  markNotificationRead,
  notify,
} from '@/server/services/notifications';

describe('notifications', () => {
  test('marking one read only touches the owner’s own notification', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await notify(db, [f.users.owner.id, f.users.pm.id], { title: 'ทดสอบ', href: '/inbox', category: 'BOQ', level: 'WARNING' });

    const [ownerRow] = await listNotifications(db, f.users.owner);
    const [pmRow] = await listNotifications(db, f.users.pm);
    expect(ownerRow).toMatchObject({ category: 'BOQ', level: 'WARNING', readAt: null });

    // Someone else's id changes nothing
    await markNotificationRead(db, f.users.owner, pmRow.id);
    expect(await countUnreadNotifications(db, f.users.pm.id)).toBe(1);

    await markNotificationRead(db, f.users.owner, ownerRow.id);
    expect(await countUnreadNotifications(db, f.users.owner.id)).toBe(0);
    expect(await countUnreadNotifications(db, f.users.pm.id)).toBe(1);

    await markAllRead(db, f.users.pm);
    expect(await countUnreadNotifications(db, f.users.pm.id)).toBe(0);
  });

  test('notifications without a category default to GENERAL / INFO', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await notify(db, [f.users.buyer.id], { title: 'ทั่วไป', href: '/po' });
    const [row] = await listNotifications(db, f.users.buyer);
    expect(row).toMatchObject({ category: 'GENERAL', level: 'INFO', projectId: null });
  });
});
