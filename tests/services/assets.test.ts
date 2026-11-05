import { describe, expect, test } from 'vitest';
import { assetCheckState, computeDepreciation, hasProblem, inspectionDue, nextInspectionDate } from '@/domain/asset';
import { bangkokDateString } from '@/domain/thai';
import { addAttachment } from '@/server/services/attachments';
import { confirmAssetCheck, createAsset, listAssets, listInspections, notifyAssetsDue, recordInspection, updateAsset } from '@/server/services/assets';
import { importAssets } from '@/server/services/import';
import { listNotifications } from '@/server/services/notifications';
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

describe('depreciation', () => {
  const machine = { purchaseValue: 100_000, salvageValue: 0, usefulLifeYears: 5, purchaseDate: '2020-01-01', retiredOn: null };

  test('straight line by the day, 1827 days across five years with a leap year', () => {
    const d = computeDepreciation(machine, '2022-07-02')!;
    expect(d).toMatchObject({ perYear: 20_000, accumulated: 49_972.63, bookValue: 50_027.37, fullyDepreciated: false });
    // 183 of the 1827 days fall in 2022
    expect(d.thisYear).toBe(10_016.42);
  });

  test('nothing before the purchase date, and stops at the salvage value when the life ends', () => {
    expect(computeDepreciation(machine, '2019-06-01')).toMatchObject({ accumulated: 0, bookValue: 100_000 });
    expect(computeDepreciation({ ...machine, salvageValue: 1 }, '2031-03-01')).toMatchObject({ accumulated: 99_999, bookValue: 1, fullyDepreciated: true, thisYear: 0 });
  });

  test('stops on the retirement date, so a later year charges nothing', () => {
    const retired = computeDepreciation({ ...machine, retiredOn: '2021-01-01' }, '2026-11-04')!;
    expect(retired.accumulated).toBe(computeDepreciation(machine, '2021-01-01')!.accumulated);
    expect(retired.thisYear).toBe(0);
  });

  test('a purchase on 29 February ends on a real date', () => {
    expect(computeDepreciation({ ...machine, purchaseDate: '2024-02-29', usefulLifeYears: 1 }, '2025-03-01')).toMatchObject({ fullyDepreciated: true, accumulated: 100_000 });
  });

  test('not depreciated without a useful life or a purchase date', () => {
    expect(computeDepreciation({ ...machine, usefulLifeYears: null }, '2026-01-01')).toBeNull();
    expect(computeDepreciation({ ...machine, purchaseDate: null }, '2026-01-01')).toBeNull();
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

  test('the money figures stay hidden from site staff and retiring records the date', async () => {
    const { db, f, onSite } = await seed();
    const input = { name: 'เครื่องปั่นไฟ', projectId: f.projectA, purchaseValue: 50000, salvageValue: 1, usefulLifeYears: 5, purchaseDate: daysAgo(365) };
    await updateAsset(db, f.users.admin, onSite.id, input);
    expect((await listAssets(db, f.users.admin)).rows.find((r) => r.id === onSite.id)!.depreciation).toMatchObject({ perYear: 9999.8 });
    const site = await listAssets(db, f.users.foreman);
    expect(site.canSeeValue).toBe(false);
    expect(site.rows[0]).toMatchObject({ salvageValue: null, usefulLifeYears: null, depreciation: null });

    await updateAsset(db, f.users.admin, onSite.id, { ...input, status: 'RETIRED' });
    const before = (await listAssets(db, f.users.admin)).rows.find((r) => r.id === onSite.id)!.depreciation!;
    expect(before.accumulated).toBeGreaterThan(0);
    await expect(updateAsset(db, f.users.admin, onSite.id, { ...input, salvageValue: 60000 })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(updateAsset(db, f.users.admin, onSite.id, { ...input, purchaseDate: null })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
  });

  test('announces each due period once, only to people who can check the asset', async () => {
    const { db, f, onSite, office } = await seed();
    expect(await notifyAssetsDue(db)).toBe(2);
    expect(await notifyAssetsDue(db)).toBe(0);

    const titles = async (u: typeof f.users.admin) => (await listNotifications(db, u)).map((n) => n.title);
    expect(await titles(f.users.admin)).toEqual(['ทรัพย์สิน 2 รายการต้องตรวจเช็ค']);
    const [foremanNotice] = await listNotifications(db, f.users.foreman);
    expect(foremanNotice).toMatchObject({ href: `/assets?asset=${onSite.id}` });
    expect(foremanNotice!.title).toContain('ยังไม่เคยตรวจ');
    expect(await titles(f.users.otherForeman)).toEqual([]);

    // Inspected 25 days ago on a 30-day cycle: coming up now, overdue a week later
    await recordInspection(db, f.users.pm, onSite.id, { inspectedOn: daysAgo(25), result: 'GOOD' });
    await updateAsset(db, f.users.admin, office.id, { name: 'เครื่องวัดระยะ', status: 'RETIRED' });
    expect(await notifyAssetsDue(db)).toBe(1);
    expect((await listNotifications(db, f.users.foreman))[0]!.title).toContain('ใกล้ถึงกำหนด');
    expect(await notifyAssetsDue(db)).toBe(0);
    const nextWeek = bangkokDateString(new Date(Date.now() + 7 * 86_400_000));
    expect(await notifyAssetsDue(db, nextWeek)).toBe(1);
    expect((await listNotifications(db, f.users.foreman)).map((n) => n.title).join()).toContain('เกินกำหนดตรวจ');

    // A new check starts a new period that is not due yet
    await recordInspection(db, f.users.pm, onSite.id, { inspectedOn: daysAgo(0), result: 'GOOD' });
    expect(await notifyAssetsDue(db)).toBe(0);
  });

  test('imports good rows, reports bad ones by sheet row, and refuses a serial number twice', async () => {
    const { db, f } = await seed();
    const [project] = (await listAssets(db, f.users.admin)).rows.filter((r) => r.projectId);
    const projectCode = (await db.query.projects.findFirst({ where: (p, { eq }) => eq(p.id, project!.projectId!) }))!.code;
    const rows = [
      { ชื่อทรัพย์สิน: 'รถกระบะ', หมวด: 'ยานพาหนะ', 'หมายเลขเครื่อง/ทะเบียน': 'ABC-1', รหัสโครงการ: projectCode, วันที่ซื้อ: '1/1/2568', มูลค่า: '800,000', 'อายุการใช้งาน(ปี)': '5', 'รอบการตรวจ(วัน)': '30' },
      { ชื่อทรัพย์สิน: '', หมวด: 'ไม่มีชื่อ' },
      { ชื่อทรัพย์สิน: '', หมวด: '' },
      { ชื่อทรัพย์สิน: 'รถซ้ำ', 'หมายเลขเครื่อง/ทะเบียน': 'abc-1' },
      { ชื่อทรัพย์สิน: 'ผิดโครงการ', รหัสโครงการ: 'NOPE' },
      { ชื่อทรัพย์สิน: 'ราคาผิด', มูลค่า: 'แปดแสน' },
      { ชื่อทรัพย์สิน: 'วันผิด', วันที่ซื้อ: '31/2/2026' },
      { ชื่อทรัพย์สิน: 'เครื่องเจาะ' },
    ] as Record<string, string>[];
    const result = await importAssets(db, f.users.admin, rows);
    expect(result.created).toBe(2);
    expect(result.errors.map((e) => e.row)).toEqual([3, 5, 6, 7, 8]);

    const imported = (await listAssets(db, f.users.admin)).rows.find((r) => r.name === 'รถกระบะ')!;
    expect(imported).toMatchObject({ code: expect.stringMatching(/^AST-/), projectId: project!.projectId, purchaseDate: '2025-01-01', purchaseValue: 800000, usefulLifeYears: 5, inspectEveryDays: 30 });

    expect((await importAssets(db, f.users.admin, [rows[0]!])).errors).toHaveLength(1);
    await expect(importAssets(db, f.users.pm, rows)).rejects.toMatchObject({ status: 403 });
    const tooMany = Array.from({ length: 1001 }, () => ({ ชื่อทรัพย์สิน: 'x' }));
    expect(await importAssets(db, f.users.admin, tooMany)).toMatchObject({ created: 0, errors: [{ row: 1 }] });
  });

  describe('the on-site check', () => {
    const photo = () => new File([new Uint8Array([1])], 'check.jpg', { type: 'image/jpeg' });
    const location = { latitude: 13.756331, longitude: 100.501765, accuracyMeters: 12.4 };

    test('saves the photo and location with the result, dated today, and the asset becomes Active', async () => {
      const { db, f, onSite } = await seed();
      await confirmAssetCheck(db, f.users.foreman, onSite.id, { result: 'GOOD', location, photo: photo() });
      const [check] = await listInspections(db, f.users.pm, onSite.id);
      expect(check).toMatchObject({ result: 'GOOD', inspectedOn: daysAgo(0), location: { latitude: 13.756331, longitude: 100.501765, accuracyMeters: 12 } });
      expect(check!.photos.map((p) => p.name)).toEqual(['check.jpg']);
      const row = (await listAssets(db, f.users.foreman)).rows[0]!;
      expect(assetCheckState(row.status, row.lastResult, row.due)).toBe('ACTIVE');
    });

    test('saves nothing without a photo or a real location, including one that was left blank', async () => {
      const { db, f, onSite } = await seed();
      await expect(confirmAssetCheck(db, f.users.foreman, onSite.id, { result: 'GOOD', location, photo: null })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
      for (const bad of [{ ...location, latitude: NaN }, { ...location, latitude: 91 }, { ...location, longitude: -181 }, { ...location, accuracyMeters: NaN }]) {
        await expect(confirmAssetCheck(db, f.users.foreman, onSite.id, { result: 'GOOD', location: bad, photo: photo() })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
      }
      expect(await listInspections(db, f.users.pm, onSite.id)).toEqual([]);
    });

    test('a photo that cannot be stored leaves no check behind', async () => {
      const { db, f, onSite } = await seed();
      const notAnImage = new File(['x'], 'a.pdf', { type: 'application/pdf' });
      await expect(confirmAssetCheck(db, f.users.foreman, onSite.id, { result: 'GOOD', location, photo: notAnImage })).rejects.toMatchObject({ code: 'INVALID_FILE' });
      expect(await listInspections(db, f.users.pm, onSite.id)).toEqual([]);
    });

    test('a problem needs details and is not Active; access follows the project', async () => {
      const { db, f, onSite } = await seed();
      await expect(confirmAssetCheck(db, f.users.foreman, onSite.id, { result: 'MISSING', note: ' ', location, photo: photo() })).rejects.toMatchObject({ code: 'INVALID_ASSET' });
      await expect(confirmAssetCheck(db, f.users.otherForeman, onSite.id, { result: 'GOOD', location, photo: photo() })).rejects.toMatchObject({ status: 403 });
      await confirmAssetCheck(db, f.users.foreman, onSite.id, { result: 'MISSING', note: 'หาไม่พบ', location, photo: photo() });
      const row = (await listAssets(db, f.users.foreman)).rows[0]!;
      expect(assetCheckState(row.status, row.lastResult, row.due)).toBe('PROBLEM');
    });

    test('Active runs out with the check, and a later good check clears a problem', () => {
      expect(assetCheckState('ACTIVE', null, 'NEVER')).toBe('AWAITING_CHECK');
      expect(assetCheckState('ACTIVE', 'GOOD', 'OVERDUE')).toBe('AWAITING_CHECK');
      expect(assetCheckState('ACTIVE', 'GOOD', 'DUE_SOON')).toBe('ACTIVE');
      expect(assetCheckState('ACTIVE', 'DAMAGED', 'OK')).toBe('PROBLEM');
      expect(assetCheckState('RETIRED', 'GOOD', 'RETIRED')).toBe('RETIRED');
    });
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
