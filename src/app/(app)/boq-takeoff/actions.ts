'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import {
  createTakeoff,
  deleteTakeoff,
  saveTakeoff,
  sendTakeoffToProjectBoq,
  type CreateTakeoffInput,
  type SaveTakeoffInput,
  type TakeoffDocumentDto,
} from '@/server/services/boq-takeoff';
import { readTakeoffPage, type AiTakeoffPage, type AiTakeoffPageInput } from '@/server/services/boq-ai-takeoff';

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; conflict?: boolean };

/** Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown */
async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message, conflict: err.status === 409 };
    throw err;
  }
}

export async function createTakeoffAction(input: CreateTakeoffInput) {
  const actor = await requireWriter();
  const db = await getDb();
  const res = await attempt(() => createTakeoff(db, actor, input));
  if (res.ok) revalidatePath('/boq-takeoff');
  return res;
}

export async function saveTakeoffAction(id: string, input: SaveTakeoffInput): Promise<Result<{ takeoff: TakeoffDocumentDto }>> {
  const actor = await requireWriter();
  const db = await getDb();
  const res = await attempt(async () => ({ takeoff: await saveTakeoff(db, actor, id, input) }));
  if (res.ok) revalidatePath('/boq-takeoff');
  return res;
}

export async function deleteTakeoffAction(id: string): Promise<Result<object>> {
  const actor = await requireWriter();
  const db = await getDb();
  const res = await attempt(async () => {
    await deleteTakeoff(db, actor, id);
    return {};
  });
  if (res.ok) revalidatePath('/boq-takeoff');
  return res;
}

export async function sendTakeoffToBoqAction(id: string, projectId: string): Promise<Result<{ boqNumber: string; added: number }>> {
  const actor = await requireWriter();
  const db = await getDb();
  const res = await attempt(async () => {
    const { boq, added } = await sendTakeoffToProjectBoq(db, actor, id, projectId);
    return { boqNumber: boq.number, added };
  });
  if (res.ok) {
    revalidatePath('/boq-takeoff');
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/boq`);
  }
  return res;
}

/** AI reads one page of the drawing and lists the BOQ items it finds; nothing is saved */
export async function aiReadTakeoffPageAction(id: string, input: AiTakeoffPageInput): Promise<Result<{ result: AiTakeoffPage }>> {
  const actor = await requireWriter();
  const db = await getDb();
  return attempt(async () => ({ result: await readTakeoffPage(db, actor, id, input) }));
}
