import { notFound } from 'next/navigation';
import type { Db } from '@/db/client';
import type { SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { getPo } from '@/server/services/po';

/** A PO can be deleted while links to it live on in messages and bookmarks, which should find a "not found" page. */
export async function getPoOrNotFound(db: Db, actor: SessionUser, id: string) {
  try {
    return await getPo(db, actor, id);
  } catch (err) {
    if (err instanceof DomainError && err.status === 404) notFound();
    throw err;
  }
}
