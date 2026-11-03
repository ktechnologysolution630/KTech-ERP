import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { projects } from '@/db/schema';
import { addMonths, warrantyState } from '@/domain/handover';
import { bangkokDateString } from '@/domain/thai';
import {
  createDefect,
  listDefects,
  listHandovers,
  listWarranties,
  saveHandover,
  updateDefect,
  type HandoverInput,
} from '@/server/services/handover';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

describe('handover domain', () => {
  it('adds months clamping to month end and classifies the warranty', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 14)).toBe('2028-01-15');
    expect(warrantyState('2025-01-01', 12, 60, '2025-12-31')).toMatchObject({ endDate: '2026-01-01', state: 'ACTIVE' });
    expect(warrantyState('2025-01-01', 12, 60, '2026-01-01').state).toBe('STRUCTURAL_ONLY');
    expect(warrantyState('2025-01-01', 12, 60, '2030-01-01')).toMatchObject({ structuralEndDate: '2030-01-01', state: 'EXPIRED' });
  });
});

describe('handover & warranty services', () => {
  let db: Db;
  let f: SeededBasics;
  const today = bangkokDateString();
  const input = (o: Partial<HandoverInput> = {}): HandoverInput => ({
    status: 'SCHEDULED',
    handoverDate: today,
    receivedBy: '',
    note: '',
    warrantyMonths: 12,
    structuralWarrantyMonths: 60,
    ...o,
  });

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
  });

  it('schedules, accepts and then locks the handover; acceptance closes the project', async () => {
    await expect(saveHandover(db, f.users.foreman, f.projectA, input())).rejects.toMatchObject({ status: 403 });
    await saveHandover(db, f.users.pm, f.projectA, input({ handoverDate: '2099-01-01' }));
    let row = (await listHandovers(db, f.users.pm)).find((r) => r.projectId === f.projectA)!;
    expect(row).toMatchObject({ canManage: true, handover: { status: 'SCHEDULED', warrantyNumber: null } });

    await expect(saveHandover(db, f.users.pm, f.projectA, input({ status: 'ACCEPTED' }))).rejects.toMatchObject({
      code: 'INVALID_HANDOVER',
    });
    await expect(
      saveHandover(db, f.users.pm, f.projectA, input({ status: 'ACCEPTED', handoverDate: '2099-01-01', receivedBy: 'คุณลูกค้า' })),
    ).rejects.toMatchObject({ code: 'INVALID_HANDOVER' });

    await saveHandover(db, f.users.pm, f.projectA, input({ status: 'ACCEPTED', receivedBy: 'คุณลูกค้า' }));
    row = (await listHandovers(db, f.users.pm)).find((r) => r.projectId === f.projectA)!;
    expect(row.handover?.warrantyNumber).toMatch(/^WAR-\d{4}-0001$/);
    const [project] = await db.select().from(projects).where(eq(projects.id, f.projectA));
    expect(project!.status).toBe('COMPLETED');

    // Accepted is final except note and warranty terms
    await expect(
      saveHandover(db, f.users.pm, f.projectA, input({ status: 'HANDED_OVER', receivedBy: 'คุณลูกค้า' })),
    ).rejects.toMatchObject({ code: 'HANDOVER_LOCKED' });
    await saveHandover(db, f.users.pm, f.projectA, input({ status: 'ACCEPTED', receivedBy: 'คุณลูกค้า', warrantyMonths: 24, note: 'ขยายประกัน' }));
    const [w] = await listWarranties(db, f.users.owner);
    expect(w).toMatchObject({ projectId: f.projectA, warrantyMonths: 24, state: 'ACTIVE', openDefects: 0 });

    // Site staff of another project do not see it
    expect(await listWarranties(db, f.users.otherForeman)).toEqual([]);
  });

  it('records defects only under warranty and tracks their repair', async () => {
    await expect(
      createDefect(db, f.users.foreman, f.projectA, { title: 'น้ำรั่ว', reportedDate: today }),
    ).rejects.toMatchObject({ code: 'NO_WARRANTY' });
    await saveHandover(db, f.users.pm, f.projectA, input({ status: 'ACCEPTED', receivedBy: 'คุณลูกค้า' }));

    await expect(createDefect(db, f.users.otherForeman, f.projectA, { title: 'x', reportedDate: today })).rejects.toMatchObject({
      status: 403,
    });
    await expect(createDefect(db, f.users.foreman, f.projectA, { title: ' ', reportedDate: today })).rejects.toMatchObject({
      code: 'INVALID_HANDOVER',
    });
    const d = await createDefect(db, f.users.foreman, f.projectA, { title: 'น้ำรั่วห้องน้ำชั้น 2', location: 'ชั้น 2', reportedDate: today });
    expect(d.number).toMatch(/^DF-/);
    expect((await listWarranties(db, f.users.owner))[0]).toMatchObject({ openDefects: 1, totalDefects: 1 });

    await expect(updateDefect(db, f.users.foreman, d.id, { status: 'REJECTED' })).rejects.toMatchObject({ code: 'INVALID_HANDOVER' });
    await updateDefect(db, f.users.foreman, d.id, { status: 'FIXED', resolution: 'เปลี่ยนท่อ' });
    const [fixed] = await listDefects(db, f.users.pm, f.projectA);
    expect(fixed).toMatchObject({ status: 'FIXED', fixedDate: today, resolution: 'เปลี่ยนท่อ' });
    expect((await listWarranties(db, f.users.owner))[0]).toMatchObject({ openDefects: 0, totalDefects: 1 });
    await expect(listDefects(db, f.users.otherForeman, f.projectA)).rejects.toMatchObject({ status: 403 });
  });
});
