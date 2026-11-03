'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { type ProjectStatus } from '@/domain/project';
import { requireUser } from '@/server/auth/current-user';
import { updateProjectDetails, type ProjectDetailDto } from '@/server/services/master';

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
