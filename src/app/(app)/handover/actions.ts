'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser, requireWriter } from '@/server/auth/current-user';
import {
  createDefect,
  listDefects,
  saveHandover,
  updateDefect,
  type DefectInput,
  type DefectUpdateInput,
  type HandoverInput,
} from '@/server/services/handover';

export type HandoverResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>, paths: string[] = []): Promise<HandoverResult<T>> {
  try {
    const value = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, value };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

async function ctx() {
  return { actor: await requireWriter(), db: await getDb() };
}

/** For the actions that only read, which stay open on an iPhone or iPad */
async function viewCtx() {
  return { actor: await requireUser(), db: await getDb() };
}

export async function saveHandoverAction(projectId: string, input: HandoverInput) {
  const { actor, db } = await ctx();
  return run(() => saveHandover(db, actor, projectId, input), ['/handover', '/warranty', `/projects/${projectId}`]);
}

export async function loadDefectsAction(projectId: string) {
  const { actor, db } = await viewCtx();
  return run(() => listDefects(db, actor, projectId));
}

export async function createDefectAction(projectId: string, input: DefectInput) {
  const { actor, db } = await ctx();
  return run(() => createDefect(db, actor, projectId, input), ['/warranty']);
}

export async function updateDefectAction(defectId: string, input: DefectUpdateInput) {
  const { actor, db } = await ctx();
  return run(() => updateDefect(db, actor, defectId, input), ['/warranty']);
}
