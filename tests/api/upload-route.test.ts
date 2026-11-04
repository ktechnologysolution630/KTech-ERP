import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Db } from '@/db/client';
import type { SessionUser } from '@/db/schema';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { addAttachment, deleteAttachment, readStoredFile, storeFile } from '@/server/services/attachments';
import { saveDailyReport, submitDailyReport } from '@/server/services/project-site';
import { getPeriodicReport } from '@/server/services/site-reports';
import { GET } from '@/app/api/upload/route';

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
  let projectId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const f = await seedBasics(db);
    pm = f.users.pm;
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
