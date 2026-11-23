import { notFound } from 'next/navigation';
import { DomainError } from '@/domain/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads a document for a detail page, showing the "not found" page instead of the error page
 * when the link is mistyped or the document was deleted (links live on in messages and bookmarks).
 */
export async function loadOrNotFound<T>(id: string, load: () => Promise<T>): Promise<T> {
  if (!UUID.test(id)) notFound();
  try {
    return await load();
  } catch (err) {
    if (err instanceof DomainError && err.status === 404) notFound();
    throw err;
  }
}
