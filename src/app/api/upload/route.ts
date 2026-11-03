import fs from 'fs/promises';
import path from 'path';
import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { type EntityType } from '@/db/schema';
import { getCurrentUser } from '@/server/auth/current-user';
import { addAttachment } from '@/server/services/attachments';

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const f = req.nextUrl.searchParams.get('f');
  if (!f || f.includes('..') || f.includes('/') || f.includes('\\')) {
    return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
  }
  const fullPath = path.resolve(process.cwd(), '.uploads', f);
  try {
    const buf = await fs.readFile(fullPath);
    // Raster images render inline (project covers); everything else stays a download. SVG is excluded on purpose.
    const imageType = IMAGE_TYPES[path.extname(f).toLowerCase()];
    return new NextResponse(buf, {
      headers: {
        'Content-Type': imageType ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    });
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
    if (!(file instanceof File) || !entityType || !entityId) {
      return NextResponse.json({ error: 'ข้อมูลไม่ครบถ้วน' }, { status: 400 });
    }
    const db = await getDb();
    const saved = await addAttachment(db, user, { entityType, entityId, file });
    return NextResponse.json({ attachment: saved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'อัปโหลดไม่สำเร็จ';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
