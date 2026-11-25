import { describe, expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { emptyTakeoffData, type TakeoffData } from '@/domain/boq-takeoff';
import { getProjectBoqSheet, saveProjectMainBoq } from '@/server/services/boq';
import {
  createTakeoff,
  deleteTakeoff,
  getTakeoff,
  listTakeoffs,
  saveTakeoff,
  sendTakeoffToProjectBoq,
} from '@/server/services/boq-takeoff';

const CM = { metersPerUnit: 0.01, label: '1 หน่วย = 1 ซม.' };

const measured = (): TakeoffData => ({
  ...emptyTakeoffData(),
  scales: { '1': CM },
  items: [
    {
      id: 'wall',
      category: 'งานสถาปัตยกรรม',
      description: 'ผนังก่ออิฐมวลเบา',
      kind: 'length',
      unit: 'ตร.ม.',
      factor: 3,
      wastePercent: 0,
      materialRate: 300,
      laborRate: 100,
      color: '#e11d48',
      note: '',
    },
  ],
  measurements: [{ id: 'm1', itemId: 'wall', page: 1, points: [[0, 0], [1000, 0]] }],
});

describe('boq take-off service', () => {
  test('saves a take-off whose stamp has microseconds (Postgres now()), which a JS date cannot hold', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { id } = await createTakeoff(db, f.users.pm, { name: 'แบบสแกน', projectId: f.projectA });
    await db.execute(sql`update boq_takeoffs set updated_at = '2026-11-25 06:40:00.123999+00' where id = ${id}`);
    const loaded = await getTakeoff(db, f.users.pm, id);
    const input = { name: 'แบบสแกน', projectId: f.projectA, fileName: 'a.pdf', fileFingerprint: 'x', pageCount: 1, data: measured() };
    const saved = await saveTakeoff(db, f.users.pm, id, { ...input, baseUpdatedAt: loaded.updatedAt });
    expect(saved.data.items).toHaveLength(1);
    // and the next save from the copy just saved goes through too
    await expect(saveTakeoff(db, f.users.pm, id, { ...input, baseUpdatedAt: saved.updatedAt })).resolves.toBeTruthy();
  });

  test('create, save and reload; a stale copy is refused', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { id, number } = await createTakeoff(db, f.users.pm, { name: 'อาคาร A ชั้น 1', projectId: f.projectA });
    expect(number).toMatch(/^TO-\d{4}-0001$/);

    const loaded = await getTakeoff(db, f.users.pm, id);
    const saved = await saveTakeoff(db, f.users.pm, id, {
      name: 'อาคาร A ชั้น 1',
      projectId: f.projectA,
      baseUpdatedAt: loaded.updatedAt,
      fileName: 'A-101.pdf',
      fileFingerprint: 'abc',
      pageCount: 3,
      data: measured(),
    });
    expect(saved.data.items).toHaveLength(1);
    expect(saved.fileName).toBe('A-101.pdf');

    await expect(
      saveTakeoff(db, f.users.pm, id, { name: 'x', projectId: f.projectA, baseUpdatedAt: loaded.updatedAt, fileName: '', fileFingerprint: '', pageCount: 0, data: measured() }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('a measurement must belong to an item', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { id } = await createTakeoff(db, f.users.pm, { name: 'งาน', projectId: null });
    const t = await getTakeoff(db, f.users.pm, id);
    const data = { ...measured(), measurements: [{ id: 'x', itemId: 'nope', page: 1, points: [[0, 0]] as [number, number][] }] };
    await expect(
      saveTakeoff(db, f.users.pm, id, { name: 'งาน', projectId: null, baseUpdatedAt: t.updatedAt, fileName: '', fileFingerprint: '', pageCount: 0, data }),
    ).rejects.toMatchObject({ code: 'INVALID_TAKEOFF' });
  });

  test('site staff see only take-offs of their projects or their own', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await createTakeoff(db, f.users.owner, { name: 'ของโครงการ B', projectId: f.projectB });
    const mine = await createTakeoff(db, f.users.foreman, { name: 'ของฉัน', projectId: null });
    await createTakeoff(db, f.users.owner, { name: 'ส่วนกลาง', projectId: null });

    expect((await listTakeoffs(db, f.users.foreman)).map((t) => t.name)).toEqual(['ของฉัน']);
    expect((await listTakeoffs(db, f.users.owner)).length).toBe(3);
    await expect(getTakeoff(db, f.users.otherForeman, mine.id)).rejects.toMatchObject({ status: 404 });
    await expect(createTakeoff(db, f.users.foreman, { name: 'x', projectId: f.projectB })).rejects.toMatchObject({ status: 403 });
    // Only the maker or an administrator deletes
    const central = (await listTakeoffs(db, f.users.owner)).find((t) => t.name === 'ส่วนกลาง')!;
    await expect(deleteTakeoff(db, f.users.buyer, central.id)).rejects.toMatchObject({ status: 403 });
    await deleteTakeoff(db, f.users.foreman, mine.id);
    expect(await listTakeoffs(db, f.users.foreman)).toEqual([]);
  });

  test('sending adds the items after the BOQ rows already there', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await saveProjectMainBoq(db, f.users.pm, f.projectA, {
      baseUpdatedAt: null,
      revision: 0,
      estimateDate: '2026-11-23',
      projectTitle: 'คลังสินค้า A',
      location: '',
      owner: '',
      workDetail: '',
      estimator: '',
      overheadPercent: 0,
      discountAmount: 0,
      vatPercent: 7,
      remarks: '',
      lines: [
        { isCategory: true, isBold: true, no: '1', description: 'งานโครงสร้าง', qty: '', unit: '', materialRate: '', laborRate: '', note: '' },
        { isCategory: false, isBold: false, no: '1.1', description: 'เสาเข็ม', qty: 10, unit: 'ต้น', materialRate: 1000, laborRate: 0, note: '' },
      ],
    });
    const { id, number } = await createTakeoff(db, f.users.pm, { name: 'ผนัง', projectId: null });
    const t = await getTakeoff(db, f.users.pm, id);
    await saveTakeoff(db, f.users.pm, id, { name: 'ผนัง', projectId: null, baseUpdatedAt: t.updatedAt, fileName: 'a.pdf', fileFingerprint: '', pageCount: 1, data: measured() });

    // A foreman cannot edit the BOQ
    await expect(sendTakeoffToProjectBoq(db, f.users.foreman, id, f.projectA)).rejects.toMatchObject({ status: 404 });

    const { boq, added } = await sendTakeoffToProjectBoq(db, f.users.pm, id, f.projectA);
    expect(added).toBe(2);
    expect(boq.lines.map((l) => [l.no, l.description, l.qty])).toEqual([
      ['1', 'งานโครงสร้าง', ''],
      ['1.1', 'เสาเข็ม', 10],
      ['2', 'งานสถาปัตยกรรม', ''],
      ['2.1', 'ผนังก่ออิฐมวลเบา', 30],
    ]);
    expect(boq.lines[3]!.note).toBe(`ถอดแบบ ${number}`);
    // 10 × 1,000 + 30 × 400, + 7% VAT
    expect(boq.grandTotal).toBe(23540);

    const after = await getTakeoff(db, f.users.pm, id);
    expect(after.sentBoqNumber).toBe(boq.number);
    expect(after.projectId).toBe(f.projectA);
    const sheet = await getProjectBoqSheet(db, f.users.pm, f.projectA);
    expect(sheet.boq!.lines).toHaveLength(4);
  });

  test('sending to a project without a BOQ creates it', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const { id } = await createTakeoff(db, f.users.owner, { name: 'ผนัง', projectId: f.projectB });
    const t = await getTakeoff(db, f.users.owner, id);
    await saveTakeoff(db, f.users.owner, id, { name: 'ผนัง', projectId: f.projectB, baseUpdatedAt: t.updatedAt, fileName: '', fileFingerprint: '', pageCount: 1, data: measured() });
    const { boq } = await sendTakeoffToProjectBoq(db, f.users.owner, id, f.projectB);
    expect(boq.projectTitle).toBe('โครงการอาคารสำนักงาน B');
    expect(boq.lines.map((l) => l.no)).toEqual(['1', '1.1']);
  });
});
