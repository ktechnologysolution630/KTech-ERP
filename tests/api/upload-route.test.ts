import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Db } from '@/db/client';
import { eq } from 'drizzle-orm';
import { activityLogs, type SessionUser } from '@/db/schema';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { addAttachment, deleteAttachment, readStoredFile, replacePhoto, storeFile } from '@/server/services/attachments';
import { getDailyReport, saveDailyReport, submitDailyReport } from '@/server/services/project-site';
import { getPeriodicReport } from '@/server/services/site-reports';
import { GET, POST } from '@/app/api/upload/route';

const session = vi.hoisted(() => ({ user: null as unknown, db: null as unknown }));
vi.mock('@/db/client', () => ({ getDb: vi.fn(async () => session.db) }));
vi.mock('@/server/auth/current-user', () => ({ getCurrentUser: vi.fn(async () => session.user) }));

// Includes bytes that break if the contents are ever treated as text
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x00]);
const png = (name: string) => new File([PNG_BYTES], name, { type: 'image/png' });
const get = (query: string) => GET(new NextRequest(`http://localhost/api/upload?${query}`));
const idOf = (url: string) => new URL(url, 'http://localhost').searchParams.get('id')!;

describe('uploaded file storage', () => {
  let db: Db;
  let pm: SessionUser;
  let foreman: SessionUser;
  let projectId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const f = await seedBasics(db);
    pm = f.users.pm;
    foreman = f.users.foreman;
    projectId = f.projectA;
    session.db = db;
    session.user = pm;
  });

  test('a stored file is served byte for byte, by database id alone', async () => {
    const stored = await storeFile(db, png('Screenshot 2026-11-04 103047.png'));
    expect(stored.url).toMatch(/^\/api\/upload\?id=[0-9a-f-]{36}$/);

    const res = await get(`id=${idOf(stored.url)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  test('only raster images and PDFs render inline', async () => {
    const page = await storeFile(db, new File(['<script>alert(1)</script>'], 'x.html', { type: 'text/html' }));
    const res = await get(`id=${idOf(page.url)}`);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  test('refuses anonymous, malformed and unknown requests', async () => {
    const stored = await storeFile(db, png('a.png'));
    expect((await get(`id=${crypto.randomUUID()}`)).status).toBe(404);
    expect((await get('id=not-a-uuid')).status).toBe(400);
    expect((await get('f=../.env')).status).toBe(400);
    expect((await get('f=gone.png')).status).toBe(404);
    expect((await get('')).status).toBe(400);
    session.user = null;
    expect((await get(`id=${idOf(stored.url)}`)).status).toBe(401);
  });

  test('deleting an attachment frees its contents', async () => {
    const saved = await addAttachment(db, pm, { entityType: 'PROJECT', entityId: projectId, file: png('a.png'), kind: 'PHOTO' });
    expect(await readStoredFile(db, idOf(saved!.url))).not.toBeNull();
    await deleteAttachment(db, pm, saved!.id);
    expect(await readStoredFile(db, idOf(saved!.url))).toBeNull();
  });

  describe('replacing a photo', () => {
    const replacement = new Uint8Array([1, 2, 3]);
    const newImage = () => new File([replacement], 'ใหม่.png', { type: 'image/png' });
    const seedSubmitted = async () => {
      const report = await saveDailyReport(db, pm, projectId, null, { reportDate: '2026-11-03' });
      const photo = await addAttachment(db, pm, { entityType: 'DAILY_REPORT', entityId: report.id, file: png('เก่า.png'), kind: 'PHOTO', caption: 'เสาเข็ม' });
      await submitDailyReport(db, pm, report.id);
      return { report, photo: photo! };
    };
    const post = (fields: Record<string, string | File>) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.set(k, v);
      return POST(new NextRequest('http://localhost/api/upload', { method: 'POST', body }));
    };

    test('a manager replaces a photo on a submitted report; caption stays, old contents go, the log keeps both names', async () => {
      const { report, photo } = await seedSubmitted();
      expect((await post({ file: newImage(), replaces: photo.id })).status).toBe(200);

      const view = await getDailyReport(db, pm, report.id);
      expect(view.canReplacePhotos).toBe(true);
      expect(view.photos).toHaveLength(1);
      expect(view.photos[0]).toMatchObject({ id: photo.id, name: 'ใหม่.png', caption: 'เสาเข็ม', size: 3 });
      expect(await readStoredFile(db, idOf(photo.url))).toBeNull();

      const weekly = await getPeriodicReport(db, pm, projectId, 'WEEK', '2026-11-03');
      const res = await get(`id=${idOf(weekly.photos[0]!.url)}`);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(replacement);

      const logged = await db.select().from(activityLogs).where(eq(activityLogs.action, 'attachment.replace'));
      expect(logged.map((l) => l.note)).toEqual(['เก่า.png → ใหม่.png']);
    });

    test('an older report photo stored with kind FILE can be replaced too', async () => {
      const report = await saveDailyReport(db, pm, projectId, null, { reportDate: '2026-11-03' });
      const photo = await addAttachment(db, pm, { entityType: 'DAILY_REPORT', entityId: report.id, file: png('เก่า.png') });
      expect(photo!.kind).toBe('FILE');
      expect((await post({ file: newImage(), replaces: photo!.id })).status).toBe(200);
      expect((await getDailyReport(db, pm, report.id)).photos[0]).toMatchObject({ name: 'ใหม่.png', kind: 'FILE' });
    });

    test('site staff cannot replace, even their own photo', async () => {
      const report = await saveDailyReport(db, foreman, projectId, null, { reportDate: '2026-11-03' });
      const photo = await addAttachment(db, foreman, { entityType: 'DAILY_REPORT', entityId: report.id, file: png('a.png'), kind: 'PHOTO' });
      await expect(replacePhoto(db, foreman, photo!.id, newImage())).rejects.toMatchObject({ status: 403 });
      expect((await getDailyReport(db, foreman, report.id)).canReplacePhotos).toBe(false);
      expect(await readStoredFile(db, idOf(photo!.url))).not.toBeNull();
    });

    test('refuses files that are not images, documents, unknown ids and anonymous callers', async () => {
      const { photo } = await seedSubmitted();
      const pdf = new File(['x'], 'x.pdf', { type: 'application/pdf' });
      expect((await post({ file: pdf, replaces: photo.id })).status).toBe(400);
      expect(await readStoredFile(db, idOf(photo.url))).not.toBeNull();

      const doc = await addAttachment(db, pm, { entityType: 'PROJECT', entityId: projectId, file: pdf });
      expect((await post({ file: newImage(), replaces: doc!.id })).status).toBe(400);
      expect((await post({ file: newImage(), replaces: crypto.randomUUID() })).status).toBe(404);
      expect((await post({ file: newImage(), replaces: 'not-a-uuid' })).status).toBe(400);
      session.user = null;
      expect((await post({ file: newImage(), replaces: photo.id })).status).toBe(401);
    });
  });

  test('a photo attached to a daily report opens from the weekly report', async () => {
    const report = await saveDailyReport(db, pm, projectId, null, { reportDate: '2026-11-03' });
    await addAttachment(db, pm, { entityType: 'DAILY_REPORT', entityId: report.id, file: png('หน้างาน.png'), kind: 'PHOTO' });
    await submitDailyReport(db, pm, report.id);

    const weekly = await getPeriodicReport(db, pm, projectId, 'WEEK', '2026-11-03');
    expect(weekly.photos).toHaveLength(1);
    const res = await get(`id=${idOf(weekly.photos[0]!.url)}`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });
});
