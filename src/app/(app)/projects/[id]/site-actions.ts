'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { deleteAttachment } from '@/server/services/attachments';
import {
  addProjectMember,
  createProjectEvent,
  deleteProjectEvent,
  getDailyReport,
  getProjectTeam,
  listDailyReports,
  listProjectCalendar,
  listProjectChat,
  listProjectFiles,
  postProjectChat,
  removeProjectMember,
  saveDailyReport,
  submitDailyReport,
  type DailyReportInput,
  type ProjectEventInput,
} from '@/server/services/project-site';

export type SiteResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>, revalidate?: string): Promise<SiteResult<T>> {
  try {
    const value = await fn();
    if (revalidate) revalidatePath(revalidate);
    return { ok: true, value };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

async function ctx() {
  return { actor: await requireUser(), db: await getDb() };
}

export async function loadTeamAction(projectId: string) {
  const { actor, db } = await ctx();
  return run(() => getProjectTeam(db, actor, projectId));
}
export async function addMemberAction(projectId: string, userId: string) {
  const { actor, db } = await ctx();
  return run(() => addProjectMember(db, actor, projectId, userId), `/projects/${projectId}`);
}
export async function removeMemberAction(projectId: string, userId: string) {
  const { actor, db } = await ctx();
  return run(() => removeProjectMember(db, actor, projectId, userId), `/projects/${projectId}`);
}

export async function loadFilesAction(projectId: string, kind: 'FILE' | 'PHOTO') {
  const { actor, db } = await ctx();
  return run(() => listProjectFiles(db, actor, projectId, kind));
}
export async function deleteFileAction(attachmentId: string) {
  const { actor, db } = await ctx();
  return run(() => deleteAttachment(db, actor, attachmentId));
}

export async function loadChatAction(projectId: string) {
  const { actor, db } = await ctx();
  return run(() => listProjectChat(db, actor, projectId));
}
export async function postChatAction(projectId: string, body: string) {
  const { actor, db } = await ctx();
  return run(async () => {
    await postProjectChat(db, actor, projectId, body);
    return listProjectChat(db, actor, projectId);
  });
}

export async function loadCalendarAction(projectId: string, from: string, to: string) {
  const { actor, db } = await ctx();
  return run(() => listProjectCalendar(db, actor, projectId, from, to));
}
export async function createEventAction(projectId: string, input: ProjectEventInput) {
  const { actor, db } = await ctx();
  return run(async () => {
    await createProjectEvent(db, actor, projectId, input);
  });
}
export async function deleteEventAction(eventId: string) {
  const { actor, db } = await ctx();
  return run(() => deleteProjectEvent(db, actor, eventId));
}

export async function loadDailyReportsAction(projectId: string) {
  const { actor, db } = await ctx();
  return run(() => listDailyReports(db, actor, projectId));
}
export async function loadDailyReportAction(reportId: string) {
  const { actor, db } = await ctx();
  return run(() => getDailyReport(db, actor, reportId));
}
export async function saveDailyReportAction(projectId: string, reportId: string | null, input: DailyReportInput) {
  const { actor, db } = await ctx();
  return run(() => saveDailyReport(db, actor, projectId, reportId, input));
}
export async function submitDailyReportAction(projectId: string, reportId: string) {
  const { actor, db } = await ctx();
  return run(() => submitDailyReport(db, actor, reportId), `/projects/${projectId}`);
}
