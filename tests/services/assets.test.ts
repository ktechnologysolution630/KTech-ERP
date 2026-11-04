import { describe, expect, test } from 'vitest';
import { hasProblem, inspectionDue, nextInspectionDate } from '@/domain/asset';
import { bangkokDateString } from '@/domain/thai';
import { addAttachment } from '@/server/services/attachments';
import { createAsset, listAssets, listInspections, recordInspection, updateAsset } from '@/server/services/assets';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';

const daysAgo = (n: number) => bangkokDateString(new Date(Date.now() - n * 86_400_000));

describe('inspection schedule', () => {
  test('next date and due state, across a month end', () => {
    expect(nextInspectionDate('2026-01-31', 30)).toBe('2026-03-02');
    expect(nextInspectionDate(null, 30)).toBeNull();
    const today = '2026-11-04';
    expect(inspectionDue('ACTIVE', null, today)).toBe('NEVER');
    expect(inspectionDue('ACTIVE', '2026-11-03', today)).toBe('OVERDUE');
    expect(inspectionDue('ACTIVE', '2026-11-04', today)).toBe('DUE_SOON');
    expect(inspectionDue('ACTIVE', '2026-11-11', today)).toBe('DUE_SOON');
    expect(inspectionDue('ACTIVE', '2026-11-12', today)).toBe('OK');
    expect(inspectionDue('RETIRED', null, today)).toBe('RETIRED');
  });

  test('a problem counts only on an asset in use', () => {
    expect(hasProblem('ACTIVE', 'DAMAGED')).toBe(true);
    expect(hasProblem('ACTIVE', 'GOOD')).toBe(false);
    expect(hasProblem('ACTIVE', null)).toBe(false);
    expect(hasProblem('RETIRED', 'MISSING')).toBe(false);
  });
});

describe('assets', () => {
  const seed = async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const onSite = await createAsset(db, f.users.admin, { name: 'เครื่องปั่นไฟ', category: 'เครื่องจักร', projectId: f.projectA, purchaseValue: 50000, inspectEveryDays: 30 });
    const office = await createAsset(db, f.users.admin, { name: 'เครื่องวัดระยะ' });
    return { db, f, onSite, office };
  };

  test('numbers assets and starts them as never inspected', async () => {
    const { db, f, onSite } = await seed();
    expect(onSite.code).toMatch(/^AST-/);
    const { rows, canManage } = await listAssets(db, f.users.admin);
    expect(canManage).toBe(true);
    expect(rows.find((r) => r.id === onSite.id)).toMatchObject({ due: 'NEVER', lastResult: null, nextDueOn: null, purchaseValue: 50000, canInspect: true });
  });

  test('only office roles manage the register', async () => {
    const { db, f, onSite } = await seed();
    for (const u of [f.users.pm, f.users.foreman, f.users.buyer]) {
      await expect(createAsset(db, u, { name: 'x' })).rejects.toMatchObject({ status: 403 });
      await expect(updateAsset(db, u, onSite.id, { name: 'x' })).rejects.toMatchObject({ status: 403 });
    }
  });

  test('site staff see and inspect only their project, without the cost', async () => {
    const { db, f, onSite, office } = await seed();
    const page = await listAssets(db, f.users.foreman);
    expect(page.canManage).toBe(false);
    expect(page.rows.map((r) => r.id)).toEqual([onSite.id]);
    expect(page.rows[0]).toMatchObject({ purchaseValue: null, canInspect: true });

    await recordInspection(db, f.users.foreman, onSite.id, { inspectedOn: daysAgo(0), result: 'GOOD' });
    await expect(recordInspection(db, f.users.foreman, office.id, { inspectedOn: daysAgo(0), result: 'GOOD' })).rejects.toMatchObject({ status: 403 });
    await expect(recordInspection(db, f.users.otherForeman, onSite.id, { inspectedOn: daysAgo(0), result: 'GOOD' })).rejects.toMatchObject({ status: 403 });
    await expect(listInspections(db, f.users.otherForeman, onSite.id)).rejects.toMatchObject({ status: 403 });
    expect((await listAssets(db, f.users.otherForeman)).rows).toEqual([]);
  });

  test('the latest check decides the condition and next date, whatever order they were entered', async () => {
    const { db, f, onSite } = await seed();
    await recordInspection(db, f.users.pm, onSite.id, { inspectedOn: daysAgo(40), result: 'GOOD' });
    let row = (await listAssets(db, f.users.pm)).rows[0]!;
    expect(row).toMatchObject({ lastResult: 'GOOD', lastInspectedOn: daysAgo(40), due: 'OVERDUE' });

    await recordInspection(db, f.users.pm, onSite.id, { inspectedOn: daysAgo(1), result: 'DAMAGED', note: 'สายไฟขาด' });
    await recordInspection(db, f.users.pm, onSite.id, { inspectedOn: daysAgo(20), result: 'GOOD' });
    row = (await listAssets(db, f.users.pm)).rows[0]!;
    expect(row).toMatchObject({ lastResult: 'DAMAGED', lastInspectedOn: daysAgo(1), nextDueOn: nextInspectionDate(daysAgo(1), 30), due: 'OK' });

    const history = await listInspections(db, f.users.pm, onSite.id);
    expect(history.map((h) => h.result)).toEqual(['DAMAGED', 'GOOD', 'GOOD']);
    expect(history[0]).toMatchObject({ note: 'สายไฟขาด', inspectorName: 'วิชัย ผู้จัดการโครงการ' });
  });

  test('refuses a bad inspection', async () => {
    const { db, f, onSite } = await seed();
    await expect(recordInspection(db, f.users.pm, onSite.id, { inspectedOn: daysAgo(0), result: 'MISSING', note: '  ' })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(recordInspection(db, f.users.pm, onSite.id, { inspectedOn: '2999-01-01', result: 'GOOD' })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(recordInspection(db, f.users.pm, onSite.id, { inspectedOn: daysAgo(0), result: 'NOPE' as never })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(recordInspection(db, f.users.pm, 'not-a-uuid', { inspectedOn: daysAgo(0), result: 'GOOD' })).rejects.toMatchObject({ status: 404 });
  });

  test('refuses a bad asset', async () => {
    const { db, f } = await seed();
    await expect(createAsset(db, f.users.admin, { name: '  ' })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(createAsset(db, f.users.admin, { name: 'x', inspectEveryDays: 0 })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(createAsset(db, f.users.admin, { name: 'x', purchaseValue: -1 })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(createAsset(db, f.users.admin, { name: 'x', projectId: crypto.randomUUID() })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(updateAsset(db, f.users.admin, crypto.randomUUID(), { name: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  test('a retired asset takes no more checks; moving one hands it to the new project', async () => {
    const { db, f, onSite, office } = await seed();
    await updateAsset(db, f.users.admin, onSite.id, { name: 'เครื่องปั่นไฟ', projectId: f.projectA, status: 'RETIRED' });
    await expect(recordInspection(db, f.users.admin, onSite.id, { inspectedOn: daysAgo(0), result: 'GOOD' })).rejects.toMatchObject({ status: 409 });
    expect((await listAssets(db, f.users.admin)).rows.find((r) => r.id === onSite.id)).toMatchObject({ due: 'RETIRED', canInspect: false });

    await updateAsset(db, f.users.admin, office.id, { name: 'เครื่องวัดระยะ', projectId: f.projectB });
    expect((await listAssets(db, f.users.otherForeman)).rows.map((r) => r.id)).toEqual([office.id]);
  });

  test('inspection photos show in the history and follow project access', async () => {
    const { db, f, onSite } = await seed();
    const check = await recordInspection(db, f.users.foreman, onSite.id, { inspectedOn: daysAgo(0), result: 'GOOD' });
    const image = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    await addAttachment(db, f.users.foreman, { entityType: 'ASSET_INSPECTION', entityId: check.id, file: image, kind: 'PHOTO' });
    expect((await listInspections(db, f.users.pm, onSite.id))[0]!.photos.map((p) => p.name)).toEqual(['a.png']);
    await expect(addAttachment(db, f.users.otherForeman, { entityType: 'ASSET_INSPECTION', entityId: check.id, file: image, kind: 'PHOTO' })).rejects.toMatchObject({ status: 403 });
  });
});
