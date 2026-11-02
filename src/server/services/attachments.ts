import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { put } from '@vercel/blob';
import { and, desc, eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  attachments,
  comments,
  users,
  type EntityType,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { logActivity } from './activity';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function storeFile(
  file: File,
  _actor: SessionUser,
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

  const uploadsDir = path.resolve(process.cwd(), '.uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
  const storedFileName = `${randomUUID()}-${safeName}`;
  const fullPath = path.join(uploadsDir, storedFileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return {
    url: `/api/upload?f=${encodeURIComponent(storedFileName)}`,
    name: file.name,
    size: file.size,
    contentType,
  };
}

export async function addAttachment(
  db: Db,
  actor: SessionUser,
  input: { entityType: EntityType; entityId: string; file: File },
) {
  const stored = await storeFile(input.file, actor);
  const [inserted] = await db
    .insert(attachments)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      url: stored.url,
      name: stored.name,
      size: stored.size,
      contentType: stored.contentType,
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
) {
  return db
    .select({
      id: attachments.id,
      url: attachments.url,
      name: attachments.name,
      size: attachments.size,
      contentType: attachments.contentType,
      uploadedBy: attachments.uploadedBy,
      uploaderName: users.name,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .innerJoin(users, eq(users.id, attachments.uploadedBy))
    .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)))
    .orderBy(desc(attachments.createdAt));
}

export async function addComment(
  db: Db,
  actor: SessionUser,
  input: { entityType: EntityType; entityId: string; body: string },
) {
  const cleanBody = input.body.trim();
  if (!cleanBody) {
    throw new DomainError('INVALID_INPUT', 'กรุณาระบุข้อความความคิดเห็น');
  }
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
