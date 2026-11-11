'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import type { ApprovalType } from '@/domain/approvals';
import { DomainError } from '@/domain/errors';
import { requireDecider } from '@/server/auth/current-user';
import { decideApproval } from '@/server/services/approvals';

export async function decideApprovalAction(input: {
  type: ApprovalType;
  id: string;
  approve: boolean;
  note: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireDecider();
  const db = await getDb();
  try {
    await decideApproval(db, actor, input);
    // The layout too: the menu shows how many documents are waiting
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
