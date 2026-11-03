'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import {
  saveProjectMainBoq,
  type BoqDocumentDto,
  type SaveBoqInput,
} from '@/server/services/boq';

export type SaveBoqResult =
  | { ok: true; boq: BoqDocumentDto }
  | { ok: false; error: string; conflict: boolean };

export async function saveBoqAction(
  projectId: string,
  input: SaveBoqInput,
): Promise<SaveBoqResult> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    const boq = await saveProjectMainBoq(db, actor, projectId, input);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/boq`);
    return { ok: true, boq };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) {
      return { ok: false, error: err.message, conflict: err.status === 409 };
    }
    throw err;
  }
}
