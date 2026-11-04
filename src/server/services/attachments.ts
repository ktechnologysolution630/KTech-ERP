import { randomUUID } from 'crypto';
import { put } from '@vercel/blob';
import { and, desc, eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  attachments,
  comments,
  storedFiles,
  users,
  type AttachmentKind,
  type EntityType,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { can } from '@/server/policy';
import { logActivity } from './activity';
import { assertEntityAccess } from './entity-access';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_CAPTION = 500;

const STORED_FILE_URL = /^\/api\/upload\?id=([0-9a-f-]{36})$/;

export async function storeFile(
  db: Db,
  file: File,
): Promise<{ url: string; name: string; size: number; contentType: string }> {
  if (file.size > MAX_FILE_SIZE) {
    throw new DomainError('FILE_TOO_LARGE', 'ขนาดไฟล์ต้องไม่เกิน 10 MB', 400);
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-\u0E00-\u0E7F]/g, '_');
  const contentType = file.type || 'application/octet-stream';

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`uploads/${randomUUID()}-${safeName}`, file, {
      access: 'public',
      contentType,
    });
    return {
      url: blob.url,
      name: file.name,
      size: file.size,
      contentType,
    };
  }

  const id = randomUUID();
  await db.insert(storedFiles).values({ id, name: file.name, content: new Uint8Array(await file.arrayBuffer()) });

  return {
    url: `/api/upload?id=${id}`,
    name: file.name,
    size: file.size,
    contentType,
  };
}

export async function readStoredFile(db: Db, id: string): Promise<{ name: string; content: Uint8Array } | null> {
  const [row] = await db.select({ name: storedFiles.name, content: storedFiles.content }).from(storedFiles).where(eq(storedFiles.id, id)).limit(1);
  return row ?? null;
}

/** Frees the contents behind a URL from storeFile; other URLs (Blob, cover presets, old files on disk) are left alone. */
export async function removeStoredFile(db: Db, url: string): Promise<void> {
  const id = STORED_FILE_URL.exec(url)?.[1];
  if (id) await db.delete(storedFiles).where(eq(storedFiles.id, id));
}

export async function addAttachment(
  db: Db,
  actor: SessionUser,
  input: { entityType: EntityType; entityId: string; file: File; kind?: AttachmentKind; folder?: string; caption?: string },
) {
  await assertEntityAccess(db, actor, input.entityType, input.entityId);
  if (input.kind === 'PHOTO' && !PHOTO_TYPES.includes(input.file.type)) {
    throw new DomainError('INVALID_FILE', 'รูปภาพต้องเป็นไฟล์ JPG, PNG, WebP หรือ GIF');
  }
  const stored = await storeFile(db, input.file);
  const [inserted] = await db
    .insert(attachments)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      url: stored.url,
      name: stored.name,
      size: stored.size,
      contentType: stored.contentType,
      kind: input.kind ?? 'FILE',
      folder: (input.folder ?? '').trim().slice(0, 100),
      caption: (input.caption ?? '').trim().slice(0, MAX_CAPTION),
      uploadedBy: actor.id,
    })
    .returning();

  await logActivity(db, {
    entityType: input.entityType,
    entityId: input.entityId,
    action: 'attachment.add',
    userId: actor.id,
    note: stored.name,
  });

  return inserted;
}

export async function listAttachments(
  db: Db,
  entityType: EntityType,
  entityId: string,
  kind?: AttachmentKind,
) {
  return db
    .select({
      id: attachments.id,
      url: attachments.url,
      name: attachments.name,
      size: attachments.size,
      contentType: attachments.contentType,
      kind: attachments.kind,
      folder: attachments.folder,
      caption: attachments.caption,
      uploadedBy: attachments.uploadedBy,
      uploaderName: users.name,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .innerJoin(users, eq(users.id, attachments.uploadedBy))
    .where(
      and(
        eq(attachments.entityType, entityType),
        eq(attachments.entityId, entityId),
        kind ? eq(attachments.kind, kind) : undefined,
      ),
    )
    .orderBy(desc(attachments.createdAt));
}

/** Same rule as deleting: the uploader, or anyone who manages the document's project. */
export async function setAttachmentCaption(db: Db, actor: SessionUser, attachmentId: string, caption: string) {
  const [att] = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!att) throw new DomainError('NOT_FOUND', 'ไม่พบไฟล์', 404);
  const projectId = await assertEntityAccess(db, actor, att.entityType, att.entityId);
  if (att.uploadedBy !== actor.id && !can(actor, 'project.manage', { projectId })) {
    throw new DomainError('FORBIDDEN', 'แก้ไขได้เฉพาะผู้อัปโหลดหรือผู้ดูแลโครงการ', 403);
  }
  await db.update(attachments).set({ caption: caption.trim().slice(0, MAX_CAPTION) }).where(eq(attachments.id, attachmentId));
}

/**
 * Swaps the image of a photo in place, keeping its caption and position. Project managers only,
 * because this also changes photos on reports that are already submitted; the activity log keeps both names.
 */
export async function replacePhoto(db: Db, actor: SessionUser, attachmentId: string, file: File) {
  const [att] = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!att) throw new DomainError('NOT_FOUND', 'ไม่พบรูป', 404);
  const projectId = await assertEntityAccess(db, actor, att.entityType, att.entityId);
  if (!can(actor, 'project.manage', { projectId })) {
    throw new DomainError('FORBIDDEN', 'เปลี่ยนรูปได้เฉพาะผู้ดูแลโครงการ', 403);
  }
  // Same test the reports use: older daily report photos were stored with kind FILE
  if (!att.contentType.startsWith('image/')) throw new DomainError('INVALID_FILE', 'เปลี่ยนได้เฉพาะรูปภาพ');
  if (!PHOTO_TYPES.includes(file.type)) {
    throw new DomainError('INVALID_FILE', 'รูปภาพต้องเป็นไฟล์ JPG, PNG, WebP หรือ GIF');
  }
  const stored = await storeFile(db, file);
  await db
    .update(attachments)
    .set({ url: stored.url, name: stored.name, size: stored.size, contentType: stored.contentType })
    .where(eq(attachments.id, attachmentId));
  await removeStoredFile(db, att.url);
  await logActivity(db, { entityType: att.entityType, entityId: att.entityId, action: 'attachment.replace', userId: actor.id, note: `${att.name} → ${stored.name}` });
}

/** Uploader, or anyone who manages the document's project, may remove an attachment. */
export async function deleteAttachment(db: Db, actor: SessionUser, attachmentId: string) {
  const [att] = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!att) throw new DomainError('NOT_FOUND', 'ไม่พบไฟล์', 404);
  const projectId = await assertEntityAccess(db, actor, att.entityType, att.entityId);
  if (att.uploadedBy !== actor.id && !can(actor, 'project.manage', { projectId })) {
    throw new DomainError('FORBIDDEN', 'ลบได้เฉพาะผู้อัปโหลดหรือผู้ดูแลโครงการ', 403);
  }
  await db.delete(attachments).where(eq(attachments.id, attachmentId));
  await removeStoredFile(db, att.url);
  await logActivity(db, { entityType: att.entityType, entityId: att.entityId, action: 'attachment.delete', userId: actor.id, note: att.name });
}

export async function addComment(
  db: Db,
  actor: SessionUser,
  input: { entityType: EntityType; entityId: string; body: string },
) {
  const cleanBody = input.body.trim().slice(0, 5000);
  if (!cleanBody) {
    throw new DomainError('INVALID_INPUT', 'กรุณาระบุข้อความความคิดเห็น');
  }
  await assertEntityAccess(db, actor, input.entityType, input.entityId);
  const [inserted] = await db
    .insert(comments)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      userId: actor.id,
      body: cleanBody,
    })
    .returning();

  await logActivity(db, {
    entityType: input.entityType,
    entityId: input.entityId,
    action: 'comment',
    userId: actor.id,
    note: cleanBody,
  });

  return inserted;
}

export async function listComments(
  db: Db,
  entityType: EntityType,
  entityId: string,
) {
  return db
    .select({
      id: comments.id,
      body: comments.body,
      userId: comments.userId,
      userName: users.name,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)))
    .orderBy(desc(comments.createdAt));
}
