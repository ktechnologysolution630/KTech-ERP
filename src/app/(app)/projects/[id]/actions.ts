'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { type ProjectStatus } from '@/domain/project';
import { requireUser } from '@/server/auth/current-user';
import {
  setProjectCover,
  updateProjectDetails,
  type ProjectCoverSource,
  type ProjectDetailDto,
} from '@/server/services/master';
import { deleteProject, previewProjectDeletion, type ProjectDeletionPreview } from '@/server/services/project-delete';

export interface ProjectDetailsFormInput {
  name: string;
  status: ProjectStatus;
  clientName: string;
  projectGroup: string;
  contactName: string;
  contactPhone: string;
  location: string;
  budget: number;
  startDate: string | null;
  endDate: string | null;
  pmUserId: string | null;
  customerId: string | null;
}

export type UpdateProjectResult =
  | { ok: true; project: ProjectDetailDto }
  | { ok: false; error: string };

export async function updateProjectDetailsAction(
  projectId: string,
  input: ProjectDetailsFormInput,
): Promise<UpdateProjectResult> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    const project = await updateProjectDetails(db, actor, projectId, input);
    revalidatePath('/projects');
    revalidatePath(`/projects/${projectId}`, 'layout');
    return { ok: true, project };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function previewProjectDeletionAction(
  projectId: string,
): Promise<{ ok: true; preview: ProjectDeletionPreview } | { ok: false; error: string }> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    return { ok: true, preview: await previewProjectDeletion(db, actor, projectId) };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function deleteProjectAction(projectId: string, confirmCode: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireUser();
  const db = await getDb();
  try {
    await deleteProject(db, actor, projectId, confirmCode);
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Cover photo from the workspace picker. FormData carries either `file` (upload),
 * `preset` (a built-in image URL) or `remove`.
 */
export async function setProjectCoverAction(
  projectId: string,
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const actor = await requireUser();
  const db = await getDb();
  const file = formData.get('file');
  const preset = formData.get('preset');
  let source: ProjectCoverSource;
  if (file instanceof File) source = { kind: 'upload', file };
  else if (typeof preset === 'string') source = { kind: 'preset', url: preset };
  else if (formData.get('remove')) source = { kind: 'remove' };
  else return { ok: false, error: 'กรุณาเลือกรูป' };

  try {
    const url = await setProjectCover(db, actor, projectId, source);
    revalidatePath('/projects');
    revalidatePath(`/projects/${projectId}`, 'layout');
    return { ok: true, url };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
