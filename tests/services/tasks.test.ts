import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { createTask, deleteTask, listProjectTasks, updateTask } from '@/server/services/tasks';
import { createProject } from '@/server/services/master';

describe('task service', () => {
  test('PM builds a two-level WBS listed parent-first', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const prep = await createTask(db, f.users.pm, f.projectA, { title: 'งานเตรียมการ' });
    const found = await createTask(db, f.users.pm, f.projectA, { title: 'งานฐานราก' });
    await createTask(db, f.users.pm, f.projectA, { title: 'สำรวจพื้นที่', parentId: prep.id, value: 50_000 });
    await createTask(db, f.users.pm, f.projectA, { title: 'ขุดดิน', parentId: found.id });
    await createTask(db, f.users.pm, f.projectA, { title: 'ผังบริเวณ', parentId: prep.id });

    const list = await listProjectTasks(db, f.users.pm, f.projectA);
    expect(list.tasks.map((t) => `${t.wbs} ${t.title}`)).toEqual([
      '1 งานเตรียมการ',
      '1.1 สำรวจพื้นที่',
      '1.2 ผังบริเวณ',
      '2 งานฐานราก',
      '2.1 ขุดดิน',
    ]);
    expect(list.tasks[0].hasChildren).toBe(true);
    expect(list.tasks[1].value).toBe(50_000);
    expect(list.canManage).toBe(true);

    await expect(
      createTask(db, f.users.pm, f.projectA, { title: 'ระดับ 3', parentId: list.tasks[1].id }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('DONE forces 100 %, dates must be ordered, deleting a parent removes children', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const parent = await createTask(db, f.users.pm, f.projectA, { title: 'หลัก' });
    const child = await createTask(db, f.users.pm, f.projectA, { title: 'ย่อย', parentId: parent.id });

    await updateTask(db, f.users.pm, child.id, { status: 'DONE', progress: 10 });
    let list = await listProjectTasks(db, f.users.pm, f.projectA);
    expect(list.tasks.find((t) => t.id === child.id)).toMatchObject({ status: 'DONE', progress: 100 });

    await updateTask(db, f.users.pm, child.id, { startDate: '2026-12-01' });
    await expect(updateTask(db, f.users.pm, child.id, { dueDate: '2026-11-30' })).rejects.toMatchObject({
      status: 400,
    });

    await deleteTask(db, f.users.pm, parent.id);
    list = await listProjectTasks(db, f.users.pm, f.projectA);
    expect(list.tasks).toHaveLength(0);
  });

  test('foreman may only report status and progress on own project', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const t = await createTask(db, f.users.pm, f.projectA, { title: 'เทคอนกรีต' });

    await updateTask(db, f.users.foreman, t.id, { progress: 40, status: 'IN_PROGRESS' });
    await expect(updateTask(db, f.users.foreman, t.id, { title: 'เปลี่ยนชื่อ' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(createTask(db, f.users.foreman, f.projectA, { title: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(deleteTask(db, f.users.foreman, t.id)).rejects.toMatchObject({ status: 403 });
    await expect(updateTask(db, f.users.otherForeman, t.id, { progress: 90 })).rejects.toMatchObject({
      status: 403,
    });

    const view = await listProjectTasks(db, f.users.foreman, f.projectA);
    expect(view.canManage).toBe(false);
    expect(view.canUpdateProgress).toBe(true);
    expect(view.tasks[0].progress).toBe(40);
  });
});

describe('createProject', () => {
  test('blank code gets a running number; duplicate codes are rejected, not overwritten', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const auto = await createProject(db, f.users.admin, { name: 'อาคารใหม่' });
    expect(auto.code).toMatch(/^PJ-\d{4}-0001$/);
    expect(auto.status).toBe('PLANNING');

    await expect(createProject(db, f.users.admin, { code: 'PJ-001', name: 'ทับของเดิม' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(createProject(db, f.users.foreman, { name: 'ไม่มีสิทธิ์' })).rejects.toMatchObject({
      status: 403,
    });
  });

  test('cover must be a raster image within the size cap', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' });
    await expect(createProject(db, f.users.admin, { name: 'ก' }, svg)).rejects.toMatchObject({ status: 400 });
    const huge = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await expect(createProject(db, f.users.admin, { name: 'ข' }, huge)).rejects.toMatchObject({ status: 400 });
  });
});
