import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { announcements, users, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan, can } from '@/server/policy';
import { storeFile } from './attachments';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
/** Keep in step with `serverActions.bodySizeLimit` in next.config.ts */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export interface NewsItem {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  linkUrl: string;
  pinned: boolean;
  authorName: string;
  createdAt: string;
}

/** Latest company news, pinned first; visible to every signed-in user. */
export async function listNews(db: Db, limit = 12): Promise<NewsItem[]> {
  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      imageUrl: announcements.imageUrl,
      linkUrl: announcements.linkUrl,
      pinned: announcements.pinned,
      authorName: users.name,
      createdAt: announcements.createdAt,
    })
    .from(announcements)
    .innerJoin(users, eq(users.id, announcements.createdBy))
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt))
    .limit(Math.min(Math.max(1, limit), 50));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export const canManageNews = (actor: SessionUser) => can(actor, 'settings.manage');

// Only in-app paths or http(s) URLs: blocks javascript:/data: links in rendered anchors
const linkSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || (v.startsWith('/') && !v.startsWith('//')) || /^https?:\/\/[^\s]+$/i.test(v), {
    message: 'ลิงก์ต้องขึ้นต้นด้วย / หรือ http(s)://',
  });

const newsSchema = z.object({
  title: z.string().trim().min(1, 'กรุณาระบุหัวข้อข่าว').max(200, 'หัวข้อยาวเกิน 200 ตัวอักษร'),
  body: z.string().trim().max(5000, 'เนื้อหายาวเกิน 5,000 ตัวอักษร').default(''),
  linkUrl: linkSchema.default(''),
  pinned: z.boolean().default(false),
});

export type NewsInput = z.input<typeof newsSchema> & { image?: File | null };

export async function createNews(db: Db, actor: SessionUser, input: NewsInput): Promise<{ id: string }> {
  assertCan(actor, 'settings.manage');
  const r = newsSchema.safeParse(input);
  if (!r.success) throw new DomainError('INVALID_NEWS', r.error.issues[0].message);

  let imageUrl = '';
  const image = input.image;
  if (image && image.size > 0) {
    if (!IMAGE_TYPES.includes(image.type)) throw new DomainError('INVALID_NEWS', 'รูปต้องเป็นไฟล์ JPG, PNG, WebP หรือ GIF');
    if (image.size > MAX_IMAGE_BYTES) throw new DomainError('INVALID_NEWS', 'รูปต้องมีขนาดไม่เกิน 4 MB');
    imageUrl = (await storeFile(image, actor)).url;
  }

  const [row] = await db
    .insert(announcements)
    .values({ ...r.data, imageUrl, createdBy: actor.id })
    .returning();
  return { id: row!.id };
}

export async function deleteNews(db: Db, actor: SessionUser, id: string): Promise<void> {
  assertCan(actor, 'settings.manage');
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', 'ไม่พบข่าว', 404);
  const deleted = await db.delete(announcements).where(eq(announcements.id, id)).returning();
  if (deleted.length === 0) throw new DomainError('NOT_FOUND', 'ไม่พบข่าว', 404);
}
