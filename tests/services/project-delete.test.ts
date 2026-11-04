import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { projects } from '@/db/schema';
import { D } from '@/domain/money';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { addAttachment, readStoredFile } from '@/server/services/attachments';
import { createProject, deleteProject, getProjectDetail, setProjectCover } from '@/server/services/master';
import { createPr } from '@/server/services/pr';
import { createTask } from '@/server/services/tasks';

const exists = async (db: Awaited<ReturnType<typeof createTestDb>>, id: string) =>
  (await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id))).length === 1;

describe('deleting a project', () => {
  test('an unused project goes, along with its uploaded cover', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const p = await createProject(db, f.users.admin, { name: 'สร้างผิด' });
    const cover = new File([new Uint8Array([1, 2])], 'c.png', { type: 'image/png' });
    const url = await setProjectCover(db, f.users.admin, p.id, { kind: 'upload', file: cover });

    await deleteProject(db, f.users.admin, p.id);

    expect(await exists(db, p.id)).toBe(false);
    expect(await readStoredFile(db, url.split('id=')[1]!)).toBeNull();
  });

  test('only owner and admin may delete, and only they are offered it', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const p = await createProject(db, f.users.admin, { name: 'สร้างผิด' });

    await expect(deleteProject(db, f.users.pm, f.projectA)).rejects.toMatchObject({ status: 403 });
    expect((await getProjectDetail(db, f.users.pm, f.projectA)).canDelete).toBe(false);
    expect((await getProjectDetail(db, f.users.owner, p.id)).canDelete).toBe(true);
  });

  test('refuses a project with work or documents, leaving everything in place', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    const withTask = await createProject(db, f.users.admin, { name: 'มีงาน' });
    await createTask(db, f.users.admin, withTask.id, { title: 'งานแรก' });
    await expect(deleteProject(db, f.users.admin, withTask.id)).rejects.toMatchObject({ code: 'PROJECT_IN_USE', status: 409 });

    const withFile = await createProject(db, f.users.admin, { name: 'มีเอกสาร' });
    await addAttachment(db, f.users.admin, { entityType: 'PROJECT', entityId: withFile.id, file: new File(['x'], 'a.pdf', { type: 'application/pdf' }) });
    await expect(deleteProject(db, f.users.admin, withFile.id)).rejects.toMatchObject({ code: 'PROJECT_IN_USE' });

    // A purchase request holds the project through a foreign key, not a cascade
    await createPr(db, f.users.foreman, { projectId: f.projectA, lines: [{ description: 'ปูน', unitName: 'ถุง', qty: D(1), estUnitPrice: D(100), neededDate: '2026-11-15', note: '' }] });
    await expect(deleteProject(db, f.users.admin, f.projectA)).rejects.toMatchObject({ code: 'PROJECT_IN_USE' });

    for (const id of [withTask.id, withFile.id, f.projectA]) expect(await exists(db, id)).toBe(true);
  });
});
