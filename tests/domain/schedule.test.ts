import { describe, expect, test } from 'vitest';
import {
  computeProjectProgress,
  isTaskOverdue,
  plannedCurve,
  plannedProgressAt,
  wbsNumbers,
  type ScheduleTask,
} from '@/domain/schedule';

function task(over: Partial<ScheduleTask> & { id: string }): ScheduleTask {
  return {
    parentId: null,
    startDate: null,
    dueDate: null,
    progress: 0,
    value: 0,
    status: 'TODO',
    ...over,
  };
}

describe('schedule maths', () => {
  test('progress is value-weighted over leaf tasks only', () => {
    const tasks = [
      task({ id: 'p', value: 999_999, progress: 0 }), // parent: ignored
      task({ id: 'a', parentId: 'p', value: 300_000, progress: 100 }),
      task({ id: 'b', parentId: 'p', value: 100_000, progress: 0 }),
    ];
    expect(computeProjectProgress(tasks)).toBe(75);
  });

  test('without values, progress weights by planned duration, then equally', () => {
    const byDuration = [
      task({ id: 'a', startDate: '2026-01-01', dueDate: '2026-01-03', progress: 100 }), // 3 days
      task({ id: 'b', startDate: '2026-01-01', dueDate: '2026-01-01', progress: 0 }), // 1 day
    ];
    expect(computeProjectProgress(byDuration)).toBe(75);

    const equal = [task({ id: 'a', progress: 50 }), task({ id: 'b', progress: 0 })];
    expect(computeProjectProgress(equal)).toBe(25);
    expect(computeProjectProgress([])).toBe(0);
  });

  test('planned progress spreads each task evenly over its days', () => {
    const tasks = [
      task({ id: 'a', startDate: '2026-01-01', dueDate: '2026-01-10', value: 100 }),
      task({ id: 'b', startDate: '2026-01-11', dueDate: '2026-01-20', value: 100 }),
    ];
    expect(plannedProgressAt(tasks, '2025-12-31')).toBe(0);
    expect(plannedProgressAt(tasks, '2026-01-05')).toBe(25);
    expect(plannedProgressAt(tasks, '2026-01-10')).toBe(50);
    expect(plannedProgressAt(tasks, '2026-01-20')).toBe(100);
    expect(plannedProgressAt(tasks, '2026-02-01')).toBe(100);
  });

  test('planned curve samples month ends and is non-decreasing to 100', () => {
    const tasks = [task({ id: 'a', startDate: '2026-01-15', dueDate: '2026-04-10', value: 1 })];
    const curve = plannedCurve(tasks);
    expect(curve.map((p) => p.date)).toEqual(['2026-01-15', '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-10']);
    for (let i = 1; i < curve.length; i++) expect(curve[i].planned).toBeGreaterThanOrEqual(curve[i - 1].planned);
    expect(curve.at(-1)?.planned).toBe(100);
    expect(plannedCurve([task({ id: 'x' })])).toEqual([]);
  });

  test('overdue means past due and not done', () => {
    expect(isTaskOverdue({ dueDate: '2026-11-02', status: 'IN_PROGRESS' }, '2026-11-03')).toBe(true);
    expect(isTaskOverdue({ dueDate: '2026-11-03', status: 'IN_PROGRESS' }, '2026-11-03')).toBe(false);
    expect(isTaskOverdue({ dueDate: '2026-11-02', status: 'DONE' }, '2026-11-03')).toBe(false);
    expect(isTaskOverdue({ dueDate: null, status: 'TODO' }, '2026-11-03')).toBe(false);
  });

  test('wbs numbers follow parent-first order', () => {
    const wbs = wbsNumbers([
      { id: 'a', parentId: null },
      { id: 'a1', parentId: 'a' },
      { id: 'a2', parentId: 'a' },
      { id: 'b', parentId: null },
      { id: 'b1', parentId: 'b' },
    ]);
    expect([...wbs.values()]).toEqual(['1', '1.1', '1.2', '2', '2.1']);
  });
});
