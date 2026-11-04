import { describe, expect, test } from 'vitest';
import type { ScheduleTask } from '@/domain/schedule';
import {
  actualProgressAt,
  buildCurve,
  categoryProgress,
  compareProgress,
  curveDates,
  executiveSummary,
  formatPeriod,
  monthOf,
  previousPeriod,
  rollupDaily,
  weekOf,
} from '@/domain/site-report';

const task = (o: Partial<ScheduleTask> & { id: string }): ScheduleTask => ({
  parentId: null,
  startDate: null,
  dueDate: null,
  progress: 0,
  value: 0,
  status: 'TODO',
  ...o,
});

describe('site report maths', () => {
  test('weeks run Monday to Sunday and months handle year ends and leap years', () => {
    // 2026-11-04 is a Wednesday
    expect(weekOf('2026-11-04')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(weekOf('2026-11-02')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(weekOf('2026-11-08')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(monthOf('2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(previousPeriod('MONTH', monthOf('2027-01-15'))).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(previousPeriod('WEEK', weekOf('2026-11-04'))).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(formatPeriod(weekOf('2026-11-04'))).toBe('2-8 พ.ย. 2569');
    expect(formatPeriod({ start: '2026-10-26', end: '2026-11-01' })).toBe('26 ต.ค. - 1 พ.ย. 2569');
    expect(formatPeriod({ start: '2026-12-28', end: '2027-01-03' })).toBe('28 ธ.ค. 2569 - 3 ม.ค. 2570');
  });

  test('past progress comes from submitted reports, today from the tasks', () => {
    const tasks = [task({ id: 'a', progress: 80 }), task({ id: 'b', progress: 0 })];
    const entries = [
      { reportDate: '2026-11-01', taskId: 'a', progressPercent: 20 },
      { reportDate: '2026-11-03', taskId: 'a', progressPercent: 50 },
      // A lower figure later never takes progress backwards
      { reportDate: '2026-11-04', taskId: 'a', progressPercent: 30 },
    ];
    expect(actualProgressAt(tasks, entries, '2026-10-31', '2026-11-10')).toBe(0);
    expect(actualProgressAt(tasks, entries, '2026-11-01', '2026-11-10')).toBe(10);
    expect(actualProgressAt(tasks, entries, '2026-11-05', '2026-11-10')).toBe(25);
    expect(actualProgressAt(tasks, entries, '2026-11-10', '2026-11-10')).toBe(40);
  });

  test('curve samples weekly for short plans, by month for long ones, and stops actuals at the cut-off', () => {
    expect(curveDates('2026-11-04', '2026-11-20', '2026-11-10')).toEqual(['2026-11-04', '2026-11-08', '2026-11-10', '2026-11-15', '2026-11-20']);
    const long = curveDates('2026-01-15', '2027-03-10', '2026-06-20');
    expect(long).toContain('2026-01-31');
    expect(long).toContain('2026-06-20');
    expect(long.at(-1)).toBe('2027-03-10');
    expect(curveDates('2026-02-01', '2026-01-01', '2026-01-15')).toEqual([]);

    const tasks = [task({ id: 'a', startDate: '2026-11-01', dueDate: '2026-11-10', progress: 50 })];
    const curve = buildCurve(tasks, [], '2026-11-05', '2026-11-05');
    expect(curve.at(-1)).toMatchObject({ date: '2026-11-10', planned: 100, actual: null });
    expect(curve.find((p) => p.date === '2026-11-05')).toMatchObject({ planned: 50, actual: 50 });
    expect(buildCurve([task({ id: 'x' })], [], '2026-11-05', '2026-11-05')).toEqual([]);
  });

  test('compares the period with the one before and groups by top-level WBS', () => {
    const tasks = [
      { ...task({ id: 'p' }), title: 'โครงสร้าง' },
      { ...task({ id: 'c1', parentId: 'p', startDate: '2026-11-02', dueDate: '2026-11-08', progress: 60 }), title: 'เสา' },
      { ...task({ id: 'solo', startDate: '2026-12-01', dueDate: '2026-12-10' }), title: 'สถาปัตย์' },
    ];
    const entries = [{ reportDate: '2026-10-30', taskId: 'c1', progressPercent: 10 }];
    const period = weekOf('2026-11-04');
    const cmp = compareProgress(tasks, entries, period, '2026-11-20');
    // After the period has ended, its actual comes from reports only (the 60% has no report behind it)
    // No task values, so tasks weigh by duration: 7 days of 17 in plan by the end of the week
    expect(cmp).toMatchObject({ previousActual: 4.1, actual: 4.1, actualIncrease: 0, previousPlanned: 0, planned: 41.2, plannedIncrease: 41.2, variance: -37.1, periodVariance: -41.2 });

    const cats = categoryProgress(tasks, entries, period, '2026-11-20');
    expect(cats.map((c) => c.name)).toEqual(['โครงสร้าง', 'สถาปัตย์']);
    expect(cats[0]).toMatchObject({ planned: 100, actual: 10, previousActual: 10 });
    expect(cats[1]).toMatchObject({ planned: 0, actual: 0 });
  });

  test('rolls up labour and equipment by name and counts days, not report rows', () => {
    const r = rollupDaily([
      { reportDate: '2026-11-02', scheduleImpact: true, accident: false, labour: [{ company: 'ช่างปูน', workers: 5, hours: 8 }, { company: '', workers: 1, hours: 8 }], equipment: [{ type: 'แบ็คโฮ', hours: 4 }] },
      { reportDate: '2026-11-03', scheduleImpact: false, accident: true, labour: [{ company: 'ช่างปูน', workers: 3, hours: 10 }], equipment: [{ type: 'แบ็คโฮ', hours: 2 }] },
    ]);
    expect(r).toMatchObject({ reportDays: 2, manDays: 9, avgManpower: 4.5, peakManpower: 6, accidents: 1, impactedDays: 1 });
    expect(r.labour).toEqual([
      { company: 'ช่างปูน', manDays: 8, manHours: 70 },
      { company: 'ไม่ระบุ', manDays: 1, manHours: 8 },
    ]);
    expect(r.equipment).toEqual([{ type: 'แบ็คโฮ', hours: 6 }]);
    expect(rollupDaily([])).toMatchObject({ reportDays: 0, avgManpower: 0, peakManpower: 0 });
  });

  test('writes the summary from the figures', () => {
    const progress = { previousPlanned: 0, previousActual: 5, planned: 40, actual: 30, plannedIncrease: 40, actualIncrease: 25, variance: -10, periodVariance: -15 };
    const none = rollupDaily([]);
    const period = weekOf('2026-11-04');
    expect(executiveSummary({ kind: 'WEEK', period, progress, hasPlan: true, rollup: none, issueCount: 0 })).toBe(
      'สรุปผลงานประจำสัปดาห์ 2-8 พ.ย. 2569: ความคืบหน้าจริง 30% (เพิ่มขึ้น 25%) · เทียบกับแผน 40% ช้ากว่าแผน 10% · ไม่มี Daily Report ที่ส่งแล้วในสัปดาห์นี้',
    );
    const busy = rollupDaily([{ reportDate: '2026-11-02', scheduleImpact: true, accident: true, labour: [{ company: 'a', workers: 4, hours: 8 }], equipment: [] }]);
    const text = executiveSummary({ kind: 'MONTH', period: monthOf('2026-11-04'), progress, hasPlan: false, rollup: busy, issueCount: 2 });
    expect(text).toContain('ยังไม่มีแผนงาน');
    expect(text).toContain('พบอุบัติเหตุ 1 ครั้ง');
    expect(text).toContain('กระทบแผนงาน 1 วัน');
    expect(text).toContain('มีปัญหา/อุปสรรค 2 รายการ');
  });
});
