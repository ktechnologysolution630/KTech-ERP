'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { isFormKind, type FormHeader, type FormText } from '@/domain/form-templates';
import { requireWriter } from '@/server/auth/current-user';
import {
  resetFormText,
  saveFormHeader,
  saveFormText,
  type FormHeaderInput,
  type FormTextInput,
} from '@/server/services/form-templates';

export type FormTextResult = { ok: true; text: FormText } | { ok: false; error: string };
export type FormHeaderResult = { ok: true; header: FormHeader } | { ok: false; error: string };

/** Every page that draws a document reads the form words when it renders */
function revalidateForms() {
  revalidatePath('/', 'layout');
}

async function run<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function saveFormTextAction(kind: string, input: FormTextInput): Promise<FormTextResult> {
  if (!isFormKind(kind)) return { ok: false, error: 'ไม่พบแบบฟอร์มนี้' };
  const actor = await requireWriter();
  const db = await getDb();
  return run(async () => {
    const text = await saveFormText(db, actor, kind, input);
    revalidateForms();
    return { ok: true as const, text };
  });
}

export async function resetFormTextAction(kind: string): Promise<FormTextResult> {
  if (!isFormKind(kind)) return { ok: false, error: 'ไม่พบแบบฟอร์มนี้' };
  const actor = await requireWriter();
  const db = await getDb();
  return run(async () => {
    const text = await resetFormText(db, actor, kind);
    revalidateForms();
    return { ok: true as const, text };
  });
}

export async function saveFormHeaderAction(input: FormHeaderInput): Promise<FormHeaderResult> {
  const actor = await requireWriter();
  const db = await getDb();
  return run(async () => {
    const header = await saveFormHeader(db, actor, input);
    revalidateForms();
    return { ok: true as const, header };
  });
}
