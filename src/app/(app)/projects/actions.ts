'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { PROJECT_STATUSES, type ProjectStatus } from '@/domain/project';
import { requireUser } from '@/server/auth/current-user';
import { createProject } from '@/server/services/master';

export type CreateProjectResult = { ok: true; id: string } | { ok: false; error: string };

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '');
}

function dateOrNull(formData: FormData, key: string): string | null {
  return text(formData, key) || null;
}

export async function createProjectAction(formData: FormData): Promise<CreateProjectResult> {
  const actor = await requireUser();
  const db = await getDb();
  const statusRaw = text(formData, 'status');
  const budgetRaw = text(formData, 'budget');
  const cover = formData.get('cover');

  try {
    const project = await createProject(
      db,
      actor,
      {
        code: text(formData, 'code'),
        name: text(formData, 'name'),
        clientName: text(formData, 'clientName'),
        projectGroup: text(formData, 'projectGroup'),
        location: text(formData, 'location'),
        startDate: dateOrNull(formData, 'startDate'),
        endDate: dateOrNull(formData, 'endDate'),
        budget: budgetRaw === '' ? 0 : Number(budgetRaw),
        status: (PROJECT_STATUSES as readonly string[]).includes(statusRaw)
          ? (statusRaw as ProjectStatus)
          : undefined,
      },
      cover instanceof File ? cover : null,
    );
    revalidatePath('/projects');
    return { ok: true, id: project.id };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
