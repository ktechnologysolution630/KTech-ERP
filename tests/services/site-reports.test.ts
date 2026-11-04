import { beforeEach, describe, expect, it } from 'vitest';
import { bangkokDateString } from '@/domain/thai';
import { monthOf, weekOf } from '@/domain/site-report';
import { getDailyReport, saveDailyReport, submitDailyReport } from '@/server/services/project-site';
import { getPeriodicReport } from '@/server/services/site-reports';
import { createTask } from '@/server/services/tasks';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

describe('weekly and monthly reports', () => {
  let db: Db;
  let f: SeededBasics;
  const today = bangkokDateString();

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
  });

  async function seedDaily() {
    const task = await createTask(db, f.users.pm, f.projectA, { title: 'เทคานชั้น 2', startDate: today, dueDate: today, progress: 0 });
    const report = await saveDailyReport(db, f.users.foreman, f.projectA, null, {
      reportDate: today,
      scheduleImpact: true,
      scheduleNote: 'ฝนตกช่วงบ่าย',
      work: [
        { description: 'เทคาน', outcome: 'DELAYED', note: 'ปูนมาช้า' },
        { description: 'เก็บงาน', outcome: 'COMPLETED' },
      ],
      progress: [{ area: 'ชั้น 2', taskId: task.id, detail: 'โซน A', todayPercent: 40, note: '' }],
      labour: [{ company: 'ช่างปูน', workers: 6, hours: 8 }],
      equipment: [{ type: 'รถโม่', hours: 4 }],
      accident: true,
      safetyNote: 'มือถูกบาด',
      visitors: 'ผู้แทนลูกค้า',
      issues: 'วัสดุขาด',
    });
    return { task, report };
  }

  it('builds both reports from submitted daily reports only', async () => {
    const { report } = await seedDaily();

    // Still a draft: counted as pending, not as data
    let weekly = await getPeriodicReport(db, f.users.foreman, f.projectA, 'WEEK', today);
    expect(weekly.sources).toMatchObject({ submitted: 0, drafts: 1, workItems: 0 });
    expect(weekly.work).toEqual([]);
    expect(weekly.rollup.reportDays).toBe(0);

    await submitDailyReport(db, f.users.foreman, report.id);
    expect((await getDailyReport(db, f.users.foreman, report.id)).scheduleNote).toBe('ฝนตกช่วงบ่าย');

    weekly = await getPeriodicReport(db, f.users.foreman, f.projectA, 'WEEK', today);
    expect(weekly.period).toEqual(weekOf(today));
    expect(weekly.number).toBe(`WR-${weekOf(today).start.replaceAll('-', '')}`);
    expect(weekly.sources).toMatchObject({ submitted: 1, drafts: 0, workItems: 3, issues: 3 });
    expect(weekly.progress.actual).toBe(40);
    expect(weekly.work[0]).toMatchObject({ wbs: null, description: 'เทคาน', outcome: 'DELAYED' });
    expect(weekly.work[1]).toMatchObject({ wbs: null, outcome: 'COMPLETED' });
    expect(weekly.work[2]).toMatchObject({ wbs: '1', description: 'ชั้น 2 · เทคานชั้น 2 · โซน A', todayPercent: 40, progressPercent: 40, outcome: null });
    expect(weekly.rollup).toMatchObject({ reportDays: 1, manDays: 6, accidents: 1, impactedDays: 1 });
    expect(weekly.rollup.equipment).toEqual([{ type: 'รถโม่', hours: 4 }]);
    expect(weekly.issues.map((i) => i.text)).toEqual(['วัสดุขาด', 'เทคาน: ปูนมาช้า', 'ฝนตกช่วงบ่าย']);
    expect(weekly.safety).toEqual([{ date: today, accident: true, note: 'มือถูกบาด' }]);
    expect(weekly.critical).toEqual([{ wbs: '-', title: 'เทคาน', dueDate: null, progress: null, cause: `รายงานว่าล่าช้า (${today}): ปูนมาช้า` }]);
    expect(weekly.summary).toContain('พบอุบัติเหตุ 1 ครั้ง');

    const monthly = await getPeriodicReport(db, f.users.pm, f.projectA, 'MONTH', today);
    expect(monthly.period).toEqual(monthOf(today));
    expect(monthly.number).toBe(`MR-${today.slice(0, 7).replace('-', '')}`);
    expect(monthly.sources.submitted).toBe(1);
  });

  it('a period before the report has none of its data', async () => {
    const { report } = await seedDaily();
    await submitDailyReport(db, f.users.foreman, report.id);
    const lastYear = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}-15`;
    const old = await getPeriodicReport(db, f.users.foreman, f.projectA, 'MONTH', lastYear);
    expect(old.sources.submitted).toBe(0);
    expect(old.progress.actual).toBe(0);
    expect(old.summary).toContain('ไม่มี Daily Report');
  });

  it('keeps project money from people without finance access, and checks access and input', async () => {
    await seedDaily();
    expect((await getPeriodicReport(db, f.users.foreman, f.projectA, 'WEEK', today)).finance).toBeNull();
    expect((await getPeriodicReport(db, f.users.pm, f.projectA, 'WEEK', today)).finance).toMatchObject({ costToDate: 0, billed: 0, received: 0 });
    await expect(getPeriodicReport(db, f.users.otherForeman, f.projectA, 'WEEK', today)).rejects.toMatchObject({ status: 403 });
    await expect(getPeriodicReport(db, f.users.foreman, f.projectA, 'WEEK', 'not-a-date')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
