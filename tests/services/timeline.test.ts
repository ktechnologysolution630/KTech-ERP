import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { projectTasks, projects } from '@/db/schema';
import { listProjectTimeline } from '@/server/services/timeline';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

describe('project timeline', () => {
  let db: Db;
  let f: SeededBasics;

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
  });

  it('scopes site staff to their projects and falls back to task dates', async () => {
    await db.insert(projectTasks).values([
      { projectId: f.projectA, sort: 1, title: 'ฐานราก', startDate: '2026-01-01', dueDate: '2026-01-10', progress: 100, createdBy: f.users.pm.id },
      { projectId: f.projectA, sort: 2, title: 'โครงสร้าง', startDate: '2026-01-11', dueDate: '2026-01-20', progress: 0, createdBy: f.users.pm.id },
    ]);

    const own = await listProjectTimeline(db, f.users.foreman);
    expect(own.rows.map((r) => r.id)).toEqual([f.projectA]);
    expect(own.rows[0]).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-01-20',
      datesFromTasks: true,
      progress: 50,
      taskCount: 2,
    });

    const all = await listProjectTimeline(db, f.users.owner);
    expect(all.rows.map((r) => r.id).sort()).toEqual([f.projectA, f.projectB].sort());
    expect(all.rows.find((r) => r.id === f.projectB)).toMatchObject({ startDate: null, endDate: null, progress: 0 });

    // Contract dates win over task dates; a completed project counts as 100%
    await db.update(projects).set({ startDate: '2025-12-01', endDate: '2026-03-31', status: 'COMPLETED' }).where(eq(projects.id, f.projectA));
    const after = await listProjectTimeline(db, f.users.owner);
    expect(after.rows.find((r) => r.id === f.projectA)).toMatchObject({
      startDate: '2025-12-01',
      endDate: '2026-03-31',
      datesFromTasks: false,
      progress: 100,
    });
  });
});
