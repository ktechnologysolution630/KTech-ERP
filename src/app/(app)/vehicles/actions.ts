'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser, requireUserOnAnyDevice } from '@/server/auth/current-user';
import {
  addTripExpense,
  cancelTrip,
  claimTripExpenses,
  decideTrip,
  getFleetLive,
  getTripRoute,
  recordPositions,
  removeTripExpense,
  requestTrip,
  returnTrip,
  saveVehicleProfile,
  startTrip,
  type PositionInput,
  type TripRequestInput,
  type VehicleProfileInput,
} from '@/server/services/vehicles';
import type { TripExpenseKind } from '@/domain/vehicle';

/*
 * The vehicle menu is the one place an iPhone or iPad may write (terms of use, exception of
 * 2026-11-11): every action here asks requireUserOnAnyDevice, never requireWriter.
 */

export type VehicleResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>, paths: string[] = []): Promise<VehicleResult<T>> {
  try {
    const value = await fn();
    revalidatePath('/vehicles', 'layout');
    for (const p of paths) revalidatePath(p);
    return { ok: true, value };
  } catch (err) {
    // Domain errors carry user-safe Thai messages; anything else is unexpected and rethrown
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

async function ctx() {
  return { actor: await requireUserOnAnyDevice(), db: await getDb() };
}

const numberOf = (form: FormData, key: string) => {
  const raw = String(form.get(key) ?? '').trim();
  return raw === '' ? Number.NaN : Number(raw);
};
const photosOf = (form: FormData) => form.getAll('photos').filter((p): p is File => p instanceof File && p.size > 0);

export async function requestTripAction(input: TripRequestInput) {
  const { actor, db } = await ctx();
  return run(async () => (await requestTrip(db, actor, input)).id);
}

export async function decideTripAction(id: string, approve: boolean, note = '') {
  const { actor, db } = await ctx();
  return run(() => decideTrip(db, actor, id, approve, note));
}

export async function cancelTripAction(id: string) {
  const { actor, db } = await ctx();
  return run(() => cancelTrip(db, actor, id));
}

export async function startTripAction(id: string, form: FormData) {
  const { actor, db } = await ctx();
  return run(() =>
    startTrip(db, actor, id, { odometerKm: numberOf(form, 'odometerKm'), fuel: numberOf(form, 'fuel'), note: String(form.get('note') ?? ''), photos: photosOf(form) }),
  );
}

export async function returnTripAction(id: string, form: FormData) {
  const { actor, db } = await ctx();
  return run(() =>
    returnTrip(db, actor, id, {
      odometerKm: numberOf(form, 'odometerKm'),
      fuel: numberOf(form, 'fuel'),
      note: String(form.get('note') ?? ''),
      damage: String(form.get('damage') ?? ''),
      photos: photosOf(form),
    }),
  );
}

/** Sent by the driver's phone every few seconds; nothing on the page needs refreshing for it */
export async function sendPositionsAction(tripId: string, points: PositionInput[]): Promise<VehicleResult<{ kept: number; tracking: boolean }>> {
  const { actor, db } = await ctx();
  try {
    return { ok: true, value: await recordPositions(db, actor, tripId, points) };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function addTripExpenseAction(tripId: string, form: FormData) {
  const { actor, db } = await ctx();
  const liters = numberOf(form, 'liters');
  const receipt = form.get('receipt');
  return run(() =>
    addTripExpense(db, actor, tripId, {
      kind: String(form.get('kind') ?? '') as TripExpenseKind,
      amount: numberOf(form, 'amount'),
      liters: Number.isNaN(liters) ? null : liters,
      paidOn: String(form.get('paidOn') ?? '') || undefined,
      note: String(form.get('note') ?? ''),
      receipt: receipt instanceof File && receipt.size > 0 ? receipt : null,
    }),
  );
}

/** ขอเบิกค่าใช้จ่ายรถ: puts the trip's unclaimed costs on a reimbursement claim */
export async function claimTripExpensesAction(tripId: string) {
  const { actor, db } = await ctx();
  return run(() => claimTripExpenses(db, actor, tripId), ['/advances']);
}

export async function removeTripExpenseAction(expenseId: string) {
  const { actor, db } = await ctx();
  return run(() => removeTripExpense(db, actor, expenseId));
}

export async function saveVehicleProfileAction(assetId: string, input: VehicleProfileInput) {
  const { actor, db } = await ctx();
  return run(() => saveVehicleProfile(db, actor, assetId, input));
}

/** The live map asks this every few seconds */
export async function loadFleetLiveAction() {
  const actor = await requireUser();
  const db = await getDb();
  try {
    return { ok: true as const, value: await getFleetLive(db, actor) };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false as const, error: err.message };
    throw err;
  }
}

export async function loadTripRouteAction(tripId: string) {
  const actor = await requireUser();
  const db = await getDb();
  try {
    return { ok: true as const, value: await getTripRoute(db, actor, tripId) };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false as const, error: err.message };
    throw err;
  }
}
