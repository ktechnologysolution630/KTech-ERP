import type { Db } from '@/db/client';
import type { SessionUser } from '@/db/schema';
import { loadOrNotFound } from '@/app/(app)/or-not-found';
import { getPo } from '@/server/services/po';

/** A PO can be deleted while links to it live on in messages and bookmarks, which should find a "not found" page. */
export async function getPoOrNotFound(db: Db, actor: SessionUser, id: string) {
  return loadOrNotFound(id, () => getPo(db, actor, id));
}
