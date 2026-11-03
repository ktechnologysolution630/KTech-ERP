import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { getProjectDetail, type ProjectDetailDto } from '@/server/services/master';

/**
 * Loads the project for a `/projects/[id]/*` page, or renders 404.
 * Unknown ids and projects outside the user's scope look the same, so ids cannot be probed.
 */
export async function loadProjectOr404(
  projectId: string,
): Promise<{ actor: SessionUser; project: ProjectDetailDto }> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    const project = await getProjectDetail(db, actor, projectId);
    return { actor, project };
  } catch (err) {
    if (err instanceof DomainError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
}
