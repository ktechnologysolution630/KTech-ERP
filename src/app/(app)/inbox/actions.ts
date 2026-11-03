'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { createNews, deleteNews } from '@/server/services/news';

export type NewsResult = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<NewsResult> {
  try {
    await fn();
    revalidatePath('/inbox');
    return { ok: true };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function createNewsAction(formData: FormData): Promise<NewsResult> {
  const actor = await requireUser();
  const db = await getDb();
  const image = formData.get('image');
  return run(() =>
    createNews(db, actor, {
      title: String(formData.get('title') ?? ''),
      body: String(formData.get('body') ?? ''),
      linkUrl: String(formData.get('linkUrl') ?? ''),
      pinned: formData.get('pinned') === 'on',
      image: image instanceof File ? image : null,
    }),
  );
}

export async function deleteNewsAction(id: string): Promise<NewsResult> {
  const actor = await requireUser();
  const db = await getDb();
  return run(() => deleteNews(db, actor, id));
}
