'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import { renumberDocument, setNextDocNumber } from '@/server/services/doc-numbers';

export type DocNumberResult = { ok: true; message: string; href?: string } | { ok: false; error: string };

export async function setNextDocNumberAction(input: { key: string; next: string; projectId?: string | null }): Promise<DocNumberResult> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    const { nextNumber } = await setNextDocNumber(db, actor, input);
    revalidatePath('/settings/doc-numbers');
    return { ok: true, message: `ใบถัดไปจะได้เลข ${nextNumber}` };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function renumberDocumentAction(input: { key: string; currentNumber: string; newNumber: string; reason: string }): Promise<DocNumberResult> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    const { href, number } = await renumberDocument(db, actor, input);
    revalidatePath('/settings/doc-numbers');
    revalidatePath(href.split('?')[0]!);
    return { ok: true, message: `เปลี่ยนเลขเป็น ${number} แล้ว`, href };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
