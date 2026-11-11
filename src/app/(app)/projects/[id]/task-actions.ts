'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import {
  createTask,
  deleteTask,
  updateTask,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '@/server/services/tasks';

export type TaskActionResult = { ok: true } | { ok: false; error: string };

async function run(projectId: string, fn: () => Promise<unknown>): Promise<TaskActionResult> {
  try {
    await fn();
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function createTaskAction(
  projectId: string,
  input: CreateTaskInput,
): Promise<TaskActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return run(projectId, () => createTask(db, actor, projectId, input));
}

export async function updateTaskAction(
  projectId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return run(projectId, () => updateTask(db, actor, taskId, input));
}

export async function deleteTaskAction(projectId: string, taskId: string): Promise<TaskActionResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return run(projectId, () => deleteTask(db, actor, taskId));
}
