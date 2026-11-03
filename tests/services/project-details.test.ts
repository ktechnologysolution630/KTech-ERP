import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import {
  getProjectDetail,
  updateProjectDetails,
  upsertProject,
} from '@/server/services/master';

describe('project details', () => {
  test('new projects default to IN_PROGRESS and accept details on create', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const created = await upsertProject(db, f.users.admin, {
      code: 'PJ-100',
      name: 'อาคารเรียน 3 ชั้น',
      clientName: 'องค์การบริหารส่วนตำบล',
      location: 'ขอนแก่น',
      budget: 12_500_000.5,
      startDate: '2026-12-01',
      endDate: '2027-06-30',
    });
    expect(created.status).toBe('IN_PROGRESS');
    expect(created.budget).toBe('12500000.50');

    const detail = await getProjectDetail(db, f.users.owner, created.id);
    expect(detail).toMatchObject({
      clientName: 'องค์การบริหารส่วนตำบล',
      location: 'ขอนแก่น',
      budget: 12_500_000.5,
      startDate: '2026-12-01',
      endDate: '2027-06-30',
      pmName: null,
    });
  });

  test('project PM updates details; omitted fields stay unchanged', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await updateProjectDetails(db, f.users.pm, f.projectA, {
      clientName: 'บริษัท ลูกค้า จำกัด',
      budget: 5_000_000,
    });

    const updated = await updateProjectDetails(db, f.users.pm, f.projectA, {
      status: 'ON_HOLD',
      pmUserId: f.users.pm.id,
      startDate: '2026-11-01',
      endDate: '2027-01-31',
    });
    expect(updated).toMatchObject({
      status: 'ON_HOLD',
      clientName: 'บริษัท ลูกค้า จำกัด',
      budget: 5_000_000,
      pmName: f.users.pm.name,
      canEdit: true,
    });
  });

  test('end date before start date is rejected, including against the saved start', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(
      updateProjectDetails(db, f.users.owner, f.projectA, {
        startDate: '2027-01-01',
        endDate: '2026-12-31',
      }),
    ).rejects.toMatchObject({ status: 400 });

    await updateProjectDetails(db, f.users.owner, f.projectA, { startDate: '2027-01-01' });
    await expect(
      updateProjectDetails(db, f.users.owner, f.projectA, { endDate: '2026-12-31' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('access rules: view by scope, edit by project PM, owner or admin', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    expect((await getProjectDetail(db, f.users.buyer, f.projectA)).canEdit).toBe(false);
    expect((await getProjectDetail(db, f.users.foreman, f.projectA)).canEdit).toBe(false);
    await expect(getProjectDetail(db, f.users.foreman, f.projectB)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      updateProjectDetails(db, f.users.foreman, f.projectA, { location: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateProjectDetails(db, f.users.buyer, f.projectA, { location: 'x' }),
    ).rejects.toMatchObject({ status: 403 });

    const byAdmin = await updateProjectDetails(db, f.users.admin, f.projectB, { status: 'COMPLETED' });
    expect(byAdmin.status).toBe('COMPLETED');
  });

  test('rejects unknown projects, bad status and unknown PM', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(getProjectDetail(db, f.users.owner, 'nope')).rejects.toMatchObject({ status: 404 });
    await expect(
      getProjectDetail(db, f.users.owner, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateProjectDetails(db, f.users.owner, f.projectA, {
        status: 'DONE' as unknown as 'COMPLETED',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      updateProjectDetails(db, f.users.owner, f.projectA, {
        pmUserId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      updateProjectDetails(db, f.users.owner, f.projectA, { budget: -1 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
