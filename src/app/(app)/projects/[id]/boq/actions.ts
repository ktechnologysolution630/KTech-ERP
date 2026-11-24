'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser, requireWriter } from '@/server/auth/current-user';
import type { UnitReference } from '@/domain/unit-match';
import { can } from '@/server/policy';
import {
  getUnitReference,
  setRegisterItemUnit,
  saveProjectMainBoq,
  type BoqDocumentDto,
  type SaveBoqInput,
} from '@/server/services/boq';

export type SaveBoqResult =
  | { ok: true; boq: BoqDocumentDto }
  | { ok: false; error: string; conflict: boolean };

export async function saveBoqAction(
  projectId: string,
  input: SaveBoqInput,
): Promise<SaveBoqResult> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    const boq = await saveProjectMainBoq(db, actor, projectId, input);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/boq`);
    return { ok: true, boq };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) {
      return { ok: false, error: err.message, conflict: err.status === 409 };
    }
    throw err;
  }
}

/** Units of the item register, for matching BOQ units to it */
export async function loadUnitReferenceAction(): Promise<UnitReference & { canEditRegister: boolean }> {
  const actor = await requireUser();
  return { ...(await getUnitReference(await getDb())), canEditRegister: can(actor, 'master.manage') };
}

/** Change the register unit of the item a BOQ row names; returns the refreshed reference */
export async function setRegisterItemUnitAction(
  itemName: string,
  unitName: string,
): Promise<{ ok: true; ref: UnitReference; changed: number } | { ok: false; error: string }> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    const changed = await setRegisterItemUnit(db, actor, itemName, unitName);
    revalidatePath('/master/items');
    return { ok: true, ref: await getUnitReference(db), changed };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
