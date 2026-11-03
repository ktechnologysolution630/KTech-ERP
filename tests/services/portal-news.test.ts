import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { projectMembers, projectTasks, projects } from '@/db/schema';
import { createNews, deleteNews, listNews } from '@/server/services/news';
import { getPortalProjects } from '@/server/services/portal';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

describe('portal news and projects', () => {
  let db: Db;
  let f: SeededBasics;

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);
  });

  it('only admins/owners post news; links must be safe; pinned news comes first', async () => {
    await expect(createNews(db, f.users.pm, { title: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(createNews(db, f.users.owner, { title: ' ' })).rejects.toMatchObject({ code: 'INVALID_NEWS' });
    for (const bad of ['javascript:alert(1)', '//evil.example', 'data:text/html,x']) {
      await expect(createNews(db, f.users.owner, { title: 'x', linkUrl: bad })).rejects.toMatchObject({ code: 'INVALID_NEWS' });
    }
    const image = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    await expect(createNews(db, f.users.owner, { title: 'x', image })).rejects.toMatchObject({ code: 'INVALID_NEWS' });

    const first = await createNews(db, f.users.owner, { title: 'ประกาศทั่วไป', linkUrl: '/projects' });
    await createNews(db, f.users.admin, { title: 'ปักหมุด', body: 'สำคัญ', linkUrl: 'https://example.com/a', pinned: true });
    const news = await listNews(db);
    expect(news.map((n) => n.title)).toEqual(['ปักหมุด', 'ประกาศทั่วไป']);
    expect(news[1]).toMatchObject({ linkUrl: '/projects', imageUrl: '' });

    await expect(deleteNews(db, f.users.foreman, first.id)).rejects.toMatchObject({ status: 403 });
    await deleteNews(db, f.users.owner, first.id);
    await expect(deleteNews(db, f.users.owner, first.id)).rejects.toMatchObject({ status: 404 });
    expect(await listNews(db)).toHaveLength(1);
  });

  it('shows member projects with progress and team; office roles fall back to open projects', async () => {
    await db.insert(projectTasks).values([
      { projectId: f.projectA, sort: 1, title: 'a', progress: 100, status: 'DONE', createdBy: f.users.pm.id },
      { projectId: f.projectA, sort: 2, title: 'b', progress: 0, createdBy: f.users.pm.id },
    ]);

    const foreman = await getPortalProjects(db, f.users.foreman);
    expect(foreman.scope).toBe('MINE');
    expect(foreman.projects).toHaveLength(1);
    expect(foreman.projects[0]).toMatchObject({ id: f.projectA, progress: 50, tasksDone: 1, tasksTotal: 2, budget: null });
    expect(foreman.projects[0]!.team.map((m) => m.id)).toContain(f.users.foreman.id);

    // PM of the project sees the budget
    const pm = await getPortalProjects(db, f.users.pm);
    expect(pm.projects.find((p) => p.id === f.projectA)?.budget).not.toBeNull();

    // Finance belongs to no project: sees every open project
    const finance = await getPortalProjects(db, f.users.finance);
    expect(finance.scope).toBe('ALL_OPEN');
    expect(finance.projects.map((p) => p.id).sort()).toEqual([f.projectA, f.projectB].sort());

    // Closed projects drop off the portal
    await db.update(projects).set({ status: 'COMPLETED' }).where(eq(projects.id, f.projectB));
    expect((await getPortalProjects(db, f.users.finance)).projects.map((p) => p.id)).toEqual([f.projectA]);

    // A site user removed from every project sees nothing (no fallback for site roles)
    await db.delete(projectMembers).where(eq(projectMembers.userId, f.users.otherForeman.id));
    const lonely = { ...f.users.otherForeman, projectIds: [] };
    expect(await getPortalProjects(db, lonely)).toEqual({ scope: 'MINE', projects: [] });
  });
});
