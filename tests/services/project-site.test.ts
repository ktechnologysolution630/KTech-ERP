import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { projectTasks } from '@/db/schema';
import { addAttachment, deleteAttachment } from '@/server/services/attachments';
import { assertEntityAccess } from '@/server/services/entity-access';
import {
  addProjectMember,
  createProjectEvent,
  deleteProjectEvent,
  getDailyReport,
  getProjectTeam,
  listDailyReports,
  listProjectCalendar,
  listProjectChat,
  listProjectFiles,
  postProjectChat,
  removeProjectMember,
  saveDailyReport,
  submitDailyReport,
} from '@/server/services/project-site';
import { createTask } from '@/server/services/tasks';

const pdf = (name: string) => new File([new Uint8Array(64)], name, { type: 'application/pdf' });

describe('project site services', () => {
  test('team: project managers add/remove members; others only view', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const team = await getProjectTeam(db, f.users.pm, f.projectA);
    expect(team.canManage).toBe(true);
    expect(team.members.map((m) => m.userId)).toEqual(expect.arrayContaining([f.users.foreman.id, f.users.pm.id]));

    await addProjectMember(db, f.users.pm, f.projectA, f.users.otherForeman.id);
    expect((await getProjectTeam(db, f.users.pm, f.projectA)).members.some((m) => m.userId === f.users.otherForeman.id)).toBe(true);
    await expect(addProjectMember(db, f.users.foreman, f.projectA, f.users.buyer.id)).rejects.toMatchObject({ status: 403 });
    await removeProjectMember(db, f.users.owner, f.projectA, f.users.otherForeman.id);
    // Site staff outside the project cannot even look
    await expect(getProjectTeam(db, f.users.otherForeman, f.projectA)).rejects.toMatchObject({ status: 403 });
  });

  test('documents: versions by name per folder, access checks, delete rules', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await addAttachment(db, f.users.foreman, { entityType: 'PROJECT', entityId: f.projectA, file: pdf('แบบ.pdf'), folder: 'แบบก่อสร้าง' });
    const v2 = await addAttachment(db, f.users.pm, { entityType: 'PROJECT', entityId: f.projectA, file: pdf('แบบ.pdf'), folder: 'แบบก่อสร้าง' });
    await addAttachment(db, f.users.pm, { entityType: 'PROJECT', entityId: f.projectA, file: pdf('แบบ.pdf'), folder: 'เอกสารอนุมัติ' });

    const files = await listProjectFiles(db, f.users.pm, f.projectA, 'FILE');
    const drawing = files.filter((x) => x.folder === 'แบบก่อสร้าง');
    expect(drawing.map((x) => [x.version, x.latest])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(files.find((x) => x.folder === 'เอกสารอนุมัติ')).toMatchObject({ version: 1, latest: true });

    // Photos must be images; other projects and unknown documents are refused
    await expect(
      addAttachment(db, f.users.foreman, { entityType: 'PROJECT', entityId: f.projectA, file: pdf('x.pdf'), kind: 'PHOTO' }),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(
      addAttachment(db, f.users.otherForeman, { entityType: 'PROJECT', entityId: f.projectA, file: pdf('x.pdf') }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(assertEntityAccess(db, f.users.owner, 'NOPE', f.projectA)).rejects.toMatchObject({ status: 404 });
    await expect(assertEntityAccess(db, f.users.owner, 'PO', crypto.randomUUID())).rejects.toMatchObject({ status: 404 });

    // Only the uploader or a project manager may delete
    await expect(deleteAttachment(db, f.users.foreman, v2.id)).rejects.toMatchObject({ status: 403 });
    await deleteAttachment(db, f.users.pm, v2.id);
    expect((await listProjectFiles(db, f.users.pm, f.projectA, 'FILE')).filter((x) => x.folder === 'แบบก่อสร้าง')).toHaveLength(1);
  });

  test('chat and calendar', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await postProjectChat(db, f.users.foreman, f.projectA, '  เทคอนกรีตเสร็จแล้ว  ');
    await postProjectChat(db, f.users.pm, f.projectA, 'รับทราบ');
    expect((await listProjectChat(db, f.users.pm, f.projectA)).map((m) => m.body)).toEqual(['เทคอนกรีตเสร็จแล้ว', 'รับทราบ']);
    await expect(postProjectChat(db, f.users.foreman, f.projectA, '   ')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(postProjectChat(db, f.users.otherForeman, f.projectA, 'x')).rejects.toMatchObject({ status: 403 });

    await createTask(db, f.users.pm, f.projectA, { title: 'ฐานราก', startDate: '2026-11-02', dueDate: '2026-11-20' });
    const ev = await createProjectEvent(db, f.users.foreman, f.projectA, { title: 'ตรวจเหล็ก', eventDate: '2026-11-10', startTime: '09:00', endTime: '10:00' });
    await expect(
      createProjectEvent(db, f.users.foreman, f.projectA, { title: 'x', eventDate: '2026-11-10', startTime: '10:00', endTime: '09:00' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const items = await listProjectCalendar(db, f.users.pm, f.projectA, '2026-11-01', '2026-11-30');
    expect(items.map((i) => [i.kind, i.date])).toEqual([
      ['TASK_START', '2026-11-02'],
      ['EVENT', '2026-11-10'],
      ['TASK_DUE', '2026-11-20'],
    ]);
    await expect(deleteProjectEvent(db, f.users.buyer, ev.id)).rejects.toMatchObject({ status: 403 });
    await deleteProjectEvent(db, f.users.foreman, ev.id);
  });

  test('daily report: draft, edit, submit applies task progress and locks the report', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const task = await createTask(db, f.users.pm, f.projectA, { title: 'เทพื้นชั้น 1' });
    const saved = await saveDailyReport(db, f.users.foreman, f.projectA, null, {
      reportDate: '2026-11-03',
      weatherMorning: 'SUNNY',
      weatherAfternoon: 'RAIN',
      work: [
        { taskId: task.id, description: 'เทคอนกรีต', progressPercent: 40, note: '' },
        { taskId: null, description: '', progressPercent: null, note: '' },
      ],
      labour: [
        { company: 'ทีมช่างสมชาย', workers: 12, hours: 8 },
        { company: '', workers: 0, hours: 0 },
      ],
      equipment: [{ type: 'รถโม่', hours: 3 }],
    });
    expect(saved.number).toBe('DR-20261103-001');
    expect((await saveDailyReport(db, f.users.foreman, f.projectA, null, { reportDate: '2026-11-03' })).number).toBe('DR-20261103-002');
    expect((await saveDailyReport(db, f.users.foreman, f.projectA, null, { reportDate: '2026-11-02' })).number).toBe('DR-20261102-001');
    const listed = (await listDailyReports(db, f.users.pm, f.projectA)).find((r) => r.id === saved.id);
    expect(listed).toMatchObject({ workers: 12, status: 'DRAFT', weatherAfternoon: 'RAIN' });
    // Blank form lines are not stored
    expect((await getDailyReport(db, f.users.pm, saved.id)).work).toHaveLength(1);

    await expect(saveDailyReport(db, f.users.foreman, f.projectA, null, { reportDate: '2999-01-01' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(submitDailyReport(db, f.users.otherForeman, saved.id)).rejects.toMatchObject({ status: 403 });

    await submitDailyReport(db, f.users.foreman, saved.id);
    const [t] = await db.select().from(projectTasks).where(eq(projectTasks.id, task.id));
    expect(t.progress).toBe(40);
    await expect(saveDailyReport(db, f.users.foreman, f.projectA, saved.id, { reportDate: '2026-11-03' })).rejects.toMatchObject({ status: 409 });
    expect((await getDailyReport(db, f.users.foreman, saved.id)).canEdit).toBe(false);

    // Today's percent adds to the task, is capped at 100, and the total is recorded on the line
    const second = await saveDailyReport(db, f.users.foreman, f.projectA, null, {
      reportDate: '2026-11-03',
      progress: [
        { area: 'โซน A', taskId: task.id, detail: 'เทพื้น', todayPercent: 25, note: '' },
        { taskId: task.id, todayPercent: 50 },
        { detail: 'งานนอกแผน', todayPercent: 5 },
        { area: '', detail: '', note: '' },
      ],
    });
    const [untouched] = await db.select().from(projectTasks).where(eq(projectTasks.id, task.id));
    expect(untouched.progress).toBe(40);
    await submitDailyReport(db, f.users.foreman, second.id);
    const [added] = await db.select().from(projectTasks).where(eq(projectTasks.id, task.id));
    expect(added.progress).toBe(100);
    const lines = (await getDailyReport(db, f.users.foreman, second.id)).progress;
    expect(lines.map((l) => l.cumulativePercent ?? null)).toEqual([65, 100, null]);
    await expect(saveDailyReport(db, f.users.foreman, f.projectA, null, { reportDate: '2026-11-03', progress: [{ todayPercent: 101 }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      saveDailyReport(db, f.users.otherForeman, f.projectB, null, { reportDate: '2026-11-03', progress: [{ taskId: task.id, todayPercent: 1 }] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
