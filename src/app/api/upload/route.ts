import fs from 'fs/promises';
import path from 'path';
import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { type EntityType } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { getCurrentUser } from '@/server/auth/current-user';
import { addAttachment, readStoredFile, replacePhoto } from '@/server/services/attachments';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INLINE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function fileResponse(content: Uint8Array<ArrayBuffer>, fileName: string) {
  // Raster images and PDFs render inline (covers, document viewer); everything else stays a download. SVG and HTML are excluded on purpose.
  const inlineType = INLINE_TYPES[path.extname(fileName).toLowerCase()];
  return new NextResponse(content, {
    headers: {
      'Content-Type': inlineType ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get('id');
  if (id !== null) {
    if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
    const stored = await readStoredFile(await getDb(), id);
    if (!stored) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return fileResponse(new Uint8Array(stored.content), stored.name);
  }
  // Files uploaded before contents moved to the database
  const f = req.nextUrl.searchParams.get('f');
  if (!f || f.includes('..') || f.includes('/') || f.includes('\\')) {
    return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
  }
  const fullPath = path.resolve(process.cwd(), '.uploads', f);
  try {
    return fileResponse(new Uint8Array(await fs.readFile(fullPath)), f);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const file = form.get('file');
    const entityType = String(form.get('entityType') || '') as EntityType;
    const entityId = String(form.get('entityId') || '');
    const kind = form.get('kind') === 'PHOTO' ? 'PHOTO' : 'FILE';
    const folder = String(form.get('folder') || '');
    const caption = String(form.get('caption') || '');
    const replaces = form.get('replaces');
    if (file instanceof File && typeof replaces === 'string') {
      if (!UUID.test(replaces)) return NextResponse.json({ error: 'ข้อมูลไม่ครบถ้วน' }, { status: 400 });
      await replacePhoto(await getDb(), user, replaces, file);
      return NextResponse.json({ ok: true });
    }
    if (!(file instanceof File) || !entityType || !entityId) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบถ้วน' }, { status: 400 });
    }
    const db = await getDb();
    // addAttachment checks the entity exists and that this user may see it
    const saved = await addAttachment(db, user, { entityType, entityId, file, kind, folder, caption });
    return NextResponse.json({ attachment: saved });
  } catch (err) {
    if (err instanceof DomainError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('upload failed', err);
    return NextResponse.json({ error: 'อัปโหลดไม่สำเร็จ' }, { status: 500 });
  }
}
