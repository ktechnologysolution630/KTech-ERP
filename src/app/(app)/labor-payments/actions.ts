'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { type MilestoneKind } from '@/domain/milestone';
import { requireUser } from '@/server/auth/current-user';
import {
  advanceMilestone,
  cancelMilestone,
  createMilestone,
  deleteMilestone,
  generateMilestonesFromBoq,
  updateMilestone,
  type MilestoneInput,
} from '@/server/services/milestones';

export type MilestoneActionResult = { ok: true } | { ok: false; error: string };

async function run(projectId: string, fn: () => Promise<unknown>): Promise<MilestoneActionResult> {
  try {
    await fn();
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath('/labor-payments');
  revalidatePath(`/labor-payments/${projectId}`);
  return { ok: true };
}

export async function createMilestoneAction(projectId: string, kind: MilestoneKind, input: MilestoneInput) {
  const actor = await requireUser();
  const db = await getDb();
  return run(projectId, () => createMilestone(db, actor, projectId, kind, input));
}

export async function updateMilestoneAction(projectId: string, id: string, input: MilestoneInput) {
  const actor = await requireUser();
  const db = await getDb();
  return run(projectId, () => updateMilestone(db, actor, id, input));
}

export async function deleteMilestoneAction(projectId: string, id: string) {
  const actor = await requireUser();
  const db = await getDb();
  return run(projectId, () => deleteMilestone(db, actor, id));
}

export async function advanceMilestoneAction(projectId: string, id: string, date?: string) {
  const actor = await requireUser();
  const db = await getDb();
  return run(projectId, () => advanceMilestone(db, actor, id, date));
}

export async function cancelMilestoneAction(projectId: string, id: string, reason: string) {
  const actor = await requireUser();
  const db = await getDb();
  return run(projectId, () => cancelMilestone(db, actor, id, reason));
}

export async function generateMilestonesAction(projectId: string, kind: MilestoneKind, retentionPercent: number) {
  const actor = await requireUser();
  const db = await getDb();
  return run(projectId, () => generateMilestonesFromBoq(db, actor, projectId, kind, retentionPercent));
}
