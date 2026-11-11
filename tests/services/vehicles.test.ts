import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import type { Db } from '@/db/client';
import { notifications, vehiclePositions } from '@/db/schema';
import { distanceKm, isOverdue, liveState, overlaps, routeKm, serviceDue, SIGNAL_LOST_AFTER_MS } from '@/domain/vehicle';
import { createAsset } from '@/server/services/assets';
import { assertEntityAccess } from '@/server/services/entity-access';
import {
  addTripExpense,
  cancelTrip,
  decideTrip,
  getFleetLive,
  getTrip,
  getTripRoute,
  getVehicleReport,
  listTrips,
  listVehicles,
  recordPositions,
  removeTripExpense,
  requestTrip,
  returnTrip,
  saveVehicleProfile,
  startTrip,
  VEHICLE_CATEGORY,
} from '@/server/services/vehicles';

const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'car.jpg', { type: 'image/jpeg' });
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

async function setup() {
  const db = await createTestDb();
  const f = await seedBasics(db);
  const pickup = await createAsset(db, f.users.admin, { name: 'กระบะ Toyota Revo', category: VEHICLE_CATEGORY, serialNo: 'กข 1234' });
  const van = await createAsset(db, f.users.admin, { name: 'รถตู้', category: VEHICLE_CATEGORY, serialNo: 'ฮห 5678' });
  // Not a vehicle: never offered for booking
  await createAsset(db, f.users.admin, { name: 'สว่านไฟฟ้า', category: 'เครื่องมือช่าง' });
  return { db, f, pickup: pickup.id, van: van.id };
}

const ask = (db: Db, f: SeededBasics, assetId: string, from = 1, to = 5, extra: Record<string, unknown> = {}) =>
  requestTrip(db, f.users.foreman, { assetId, projectId: f.projectA, purpose: 'ขนปูนไปหน้างาน', destination: 'ไซต์ A', plannedStart: hours(from), plannedEnd: hours(to), ...extra });

describe('vehicle rules', () => {
  test('bookings that touch end to start do not overlap', () => {
    const at = (h: number) => new Date(2026, 10, 11, h);
    expect(overlaps({ start: at(8), end: at(12) }, { start: at(12), end: at(15) })).toBe(false);
    expect(overlaps({ start: at(8), end: at(12) }, { start: at(11), end: at(15) })).toBe(true);
    expect(overlaps({ start: at(8), end: at(18) }, { start: at(10), end: at(11) })).toBe(true);
  });

  test('a route is measured along its points, ignoring a fix that jumps too far to be driven', () => {
    const t = (min: number) => new Date(2026, 10, 11, 9, min);
    // About 1.1 km per 0.01 degree of latitude
    const pts = [
      { lat: 13.7, lng: 100.5, at: t(0) },
      { lat: 13.71, lng: 100.5, at: t(2) },
      { lat: 14.7, lng: 100.5, at: t(3) }, // 110 km in a minute: a bad fix
      { lat: 13.72, lng: 100.5, at: t(4) },
    ];
    expect(distanceKm(pts[0]!, pts[1]!)).toBeCloseTo(1.11, 1);
    expect(routeKm([])).toBe(0);
    expect(routeKm(pts.filter((_, i) => i !== 2))).toBeCloseTo(2.2, 1);
    expect(routeKm(pts)).toBeLessThan(5);
  });

  test('live state: moving, stopped, signal lost, nothing yet', () => {
    const now = new Date(2026, 10, 11, 10);
    expect(liveState(null, null, now)).toBe('WAITING');
    expect(liveState(new Date(now.getTime() - 30_000), 42, now)).toBe('MOVING');
    expect(liveState(new Date(now.getTime() - 30_000), 1, now)).toBe('STOPPED');
    expect(liveState(new Date(now.getTime() - SIGNAL_LOST_AFTER_MS - 1000), 42, now)).toBe('NO_SIGNAL');
  });

  test('service is due within 500 km of the next interval, and only when the interval is set', () => {
    expect(serviceDue({ serviceEveryKm: 10_000, lastServiceKm: 50_000, odometerKm: 59_600 })).toEqual({ dueAtKm: 60_000, remainingKm: 400, due: true });
    expect(serviceDue({ serviceEveryKm: 10_000, lastServiceKm: 50_000, odometerKm: 55_000 })?.due).toBe(false);
    expect(serviceDue({ serviceEveryKm: null, lastServiceKm: null, odometerKm: 55_000 })).toBeNull();
    expect(isOverdue({ status: 'IN_USE', plannedEnd: new Date(Date.now() - 1000) })).toBe(true);
    expect(isOverdue({ status: 'RETURNED', plannedEnd: new Date(Date.now() - 1000) })).toBe(false);
  });
});

describe('using a company vehicle', () => {
  test('the register lists vehicles only, with the serial number standing in for the plate', async () => {
    const { db, f, pickup } = await setup();
    const list = await listVehicles(db);
    expect(list.map((v) => v.name)).toEqual(['กระบะ Toyota Revo', 'รถตู้']);
    expect(list[0]).toMatchObject({ plateNo: 'กข 1234', odometerKm: null, bookable: true, inUseTripId: null });

    await expect(saveVehicleProfile(db, f.users.foreman, pickup, { plateNo: 'x', odometerKm: null, serviceEveryKm: null, lastServiceKm: null, bookable: true })).rejects.toMatchObject({ status: 403 });
    await saveVehicleProfile(db, f.users.admin, pickup, { plateNo: '1กข 1234 กทม.', odometerKm: 50_000, serviceEveryKm: 10_000, lastServiceKm: 50_000, bookable: true });
    expect((await listVehicles(db))[0]).toMatchObject({ plateNo: '1กข 1234 กทม.', odometerKm: 50_000, serviceEveryKm: 10_000 });
  });

  test('request, approve, take out, track, record costs, return: the whole trip', async () => {
    const { db, f, pickup } = await setup();
    await saveVehicleProfile(db, f.users.admin, pickup, { plateNo: '1กข 1234', odometerKm: 50_000, serviceEveryKm: 10_000, lastServiceKm: 40_500, bookable: true });

    const trip = await ask(db, f, pickup);
    expect(trip.number).toMatch(/^VT-\d{4}-0001$/);
    // The approvers are told
    const told = await db.select().from(notifications).where(eq(notifications.href, `/vehicles/${trip.id}`));
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((n) => n.category === 'VEHICLE')).toBe(true);

    // Not approved yet: the vehicle cannot be taken
    await expect(startTrip(db, f.users.foreman, trip.id, { odometerKm: 50_010, fuel: 100, photos: [photo()] })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // Only an approver decides, and a refusal needs a reason
    await expect(decideTrip(db, f.users.pm, trip.id, true)).rejects.toMatchObject({ status: 403 });
    await expect(decideTrip(db, f.users.buyerHead, trip.id, false)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await decideTrip(db, f.users.buyerHead, trip.id, true);

    // Taking it out: photos are required and the odometer cannot go backwards
    await expect(startTrip(db, f.users.foreman, trip.id, { odometerKm: 50_010, fuel: 100, photos: [] })).rejects.toMatchObject({ code: 'PHOTO_REQUIRED' });
    await expect(startTrip(db, f.users.foreman, trip.id, { odometerKm: 49_000, fuel: 100, photos: [photo()] })).rejects.toMatchObject({ code: 'INVALID_ODOMETER' });
    await expect(startTrip(db, f.users.pm, trip.id, { odometerKm: 50_010, fuel: 100, photos: [photo()] })).rejects.toMatchObject({ status: 403 });
    await startTrip(db, f.users.foreman, trip.id, { odometerKm: 50_010, fuel: 75, note: 'รอยขีดข่วนประตูหลังเดิม', photos: [photo(), photo()] });

    // The phone sends where it is; a vague fix and one from before the trip are dropped
    const now = Date.now();
    const sent = await recordPositions(db, f.users.foreman, trip.id, [
      { lat: 13.7, lng: 100.5, accuracyM: 8, speedKmh: 0, at: new Date(now - 60_000) },
      { lat: 13.71, lng: 100.5, accuracyM: 12, speedKmh: 45, at: new Date(now - 20_000) },
      { lat: 13.9, lng: 100.9, accuracyM: 1500, at: new Date(now - 10_000) },
      { lat: 13.6, lng: 100.4, accuracyM: 5, at: new Date(now - 3_600_000) },
    ]);
    expect(sent).toEqual({ kept: 2, tracking: true });
    // Someone else cannot send for the vehicle
    await expect(recordPositions(db, f.users.pm, trip.id, [{ lat: 1, lng: 1, at: new Date() }])).rejects.toMatchObject({ status: 403 });
    // A batch held back while offline does not move the vehicle back in time
    await recordPositions(db, f.users.foreman, trip.id, [{ lat: 13.702, lng: 100.5, accuracyM: 10, at: new Date(now - 40_000) }]);

    const live = await getFleetLive(db, f.users.buyerHead);
    expect(live.vehicles).toHaveLength(1);
    expect(live.vehicles[0]).toMatchObject({ tripNumber: trip.number, plateNo: '1กข 1234', driverName: f.users.foreman.name, state: 'MOVING', lat: 13.71, lng: 100.5, speedKmh: 45 });
    await expect(getFleetLive(db, f.users.foreman)).rejects.toMatchObject({ status: 403 });
    expect((await getTripRoute(db, f.users.foreman, trip.id)).length).toBe(3);
    expect((await listVehicles(db))[0]!.inUseTripId).toBe(trip.id);

    // Costs on the road, with the receipt
    const fuel = await addTripExpense(db, f.users.foreman, trip.id, { kind: 'FUEL', amount: 1200, liters: 35, note: 'ปั๊ม ปตท.', receipt: photo() });
    const toll = await addTripExpense(db, f.users.foreman, trip.id, { kind: 'TOLL', amount: 60 });
    await expect(addTripExpense(db, f.users.foreman, trip.id, { kind: 'TOLL', amount: 0 })).rejects.toMatchObject({ code: 'INVALID_TRIP' });
    await expect(removeTripExpense(db, f.users.pm, toll.id)).rejects.toMatchObject({ status: 403 });
    await removeTripExpense(db, f.users.foreman, toll.id);

    // Return: the odometer moves the vehicle on; damage tells the approvers
    await expect(returnTrip(db, f.users.foreman, trip.id, { odometerKm: 50_000, fuel: 50, photos: [photo()] })).rejects.toMatchObject({ code: 'INVALID_ODOMETER' });
    await returnTrip(db, f.users.foreman, trip.id, { odometerKm: 50_135.5, fuel: 50, damage: 'กระจกข้างแตก', photos: [photo()] });

    const done = await getTrip(db, f.users.foreman, trip.id);
    expect(done).toMatchObject({ status: 'RETURNED', startOdometerKm: 50_010, endOdometerKm: 50_135.5, distanceKm: 125.5, startFuel: 75, endFuel: 50, damage: 'กระจกข้างแตก' });
    expect(done.photos.map((p) => p.stage)).toEqual(['START', 'START', 'END']);
    expect(done.expenses).toHaveLength(1);
    expect(done.expenses[0]).toMatchObject({ id: fuel.id, kind: 'FUEL', amount: 1200, liters: 35 });
    expect(done.expenses[0]!.receiptUrl).toBeTruthy();
    expect(done.gpsKm).toBeGreaterThan(0);
    expect((await listVehicles(db))[0]).toMatchObject({ odometerKm: 50_135.5, inUseTripId: null });
    const damage = await db.select().from(notifications).where(eq(notifications.level, 'WARNING'));
    expect(damage.some((n) => n.title.includes('กระจกข้างแตก'))).toBe(true);
    // Positions after the return are not taken
    expect(await recordPositions(db, f.users.foreman, trip.id, [{ lat: 13.7, lng: 100.5, at: new Date() }])).toEqual({ kept: 0, tracking: false });

    // The report adds it up, and the service is now due
    const today = new Date().toISOString().slice(0, 10);
    const report = await getVehicleReport(db, f.users.finance, { from: '2026-01-01', to: '2099-12-31' });
    expect(report.byVehicle).toEqual([expect.objectContaining({ assetId: pickup, trips: 1, km: 125.5, cost: 1200, liters: 35, costPerKm: 9.56 })]);
    expect(report.byDriver).toEqual([{ name: f.users.foreman.name, trips: 1, km: 125.5, cost: 1200 }]);
    expect(report.byProject[0]).toMatchObject({ code: 'PJ-001', trips: 1 });
    expect(report.service).toEqual([expect.objectContaining({ assetId: pickup, dueAtKm: 50_500, remainingKm: 364.5 })]);
    expect(report.damaged.map((t) => t.id)).toEqual([trip.id]);
    expect(today).toMatch(/^\d{4}/);
    await expect(getVehicleReport(db, f.users.foreman, { from: '2026-01-01', to: '2026-12-31' })).rejects.toMatchObject({ status: 403 });
  });

  test('a vehicle cannot be booked twice for the same hours, and a booking can be let go', async () => {
    const { db, f, pickup, van } = await setup();
    const first = await ask(db, f, pickup, 1, 5);
    await expect(ask(db, f, pickup, 4, 8)).rejects.toMatchObject({ code: 'VEHICLE_BOOKED' });
    // Back to back is fine, and so is another vehicle
    await ask(db, f, pickup, 5, 8);
    await ask(db, f, van, 2, 4);
    // Refused or cancelled bookings free the hours
    await cancelTrip(db, f.users.foreman, first.id);
    await ask(db, f, pickup, 2, 3);
    // Booking times must make sense
    await expect(ask(db, f, pickup, 10, 9)).rejects.toMatchObject({ code: 'INVALID_TRIP' });
    await expect(ask(db, f, pickup, -5, -3)).rejects.toMatchObject({ code: 'INVALID_TRIP' });
    // A vehicle off the booking list cannot be asked for
    await saveVehicleProfile(db, f.users.admin, van, { plateNo: '', odometerKm: null, serviceEveryKm: null, lastServiceKm: null, bookable: false });
    await expect(ask(db, f, van, 20, 22)).rejects.toMatchObject({ code: 'INVALID_TRIP' });
  });

  test('nobody approves their own request unless they own the company', async () => {
    const { db, f, pickup, van } = await setup();
    const own = await requestTrip(db, f.users.buyerHead, { assetId: pickup, purpose: 'ไปดูหน้างาน', plannedStart: hours(1), plannedEnd: hours(2) });
    await expect(decideTrip(db, f.users.buyerHead, own.id, true)).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    const owners = await requestTrip(db, f.users.owner, { assetId: van, purpose: 'ประชุมลูกค้า', plannedStart: hours(1), plannedEnd: hours(2) });
    await decideTrip(db, f.users.owner, owners.id, true);
    const rejected = await ask(db, f, pickup, 3, 4);
    await decideTrip(db, f.users.admin, rejected.id, false, 'รถต้องเข้าศูนย์');
    expect((await getTrip(db, f.users.foreman, rejected.id)).status).toBe('REJECTED');
  });

  test('a trip is seen by the people on it and the office, not by other site staff', async () => {
    const { db, f, pickup } = await setup();
    // Requested for someone else to drive
    const trip = await ask(db, f, pickup, 1, 3, { driverId: f.users.otherForeman.id, projectId: null });
    expect((await getTrip(db, f.users.otherForeman, trip.id)).isDriver).toBe(true);
    await expect(getTrip(db, f.users.pm, trip.id)).rejects.toMatchObject({ status: 403 });
    expect((await getTrip(db, f.users.finance, trip.id)).id).toBe(trip.id);
    // The driver of an office trip may open its photos even though site staff see no office documents
    await expect(assertEntityAccess(db, f.users.otherForeman, 'VEHICLE_TRIP', trip.id)).resolves.toBeNull();
    await expect(assertEntityAccess(db, f.users.pm, 'VEHICLE_TRIP', trip.id)).rejects.toMatchObject({ status: 403 });

    expect((await listTrips(db, f.users.otherForeman)).map((t) => t.id)).toEqual([trip.id]);
    expect(await listTrips(db, f.users.pm)).toEqual([]);
    // Asking for "all" without the right to watch the fleet still shows only one's own
    expect(await listTrips(db, f.users.pm, { scope: 'all' })).toEqual([]);
    expect((await listTrips(db, f.users.buyerHead, { scope: 'all' })).map((t) => t.id)).toEqual([trip.id]);

    // With other trips on record, each still answers for itself
    const other = await ask(db, f, pickup, 5, 7);
    await expect(assertEntityAccess(db, f.users.otherForeman, 'VEHICLE_TRIP', other.id)).rejects.toMatchObject({ status: 403 });
    await expect(assertEntityAccess(db, f.users.foreman, 'VEHICLE_TRIP', trip.id)).resolves.toBeNull();

    // Only the named driver takes it out
    await decideTrip(db, f.users.admin, trip.id, true);
    await expect(startTrip(db, f.users.foreman, trip.id, { odometerKm: 1, fuel: 100, photos: [photo()] })).rejects.toMatchObject({ status: 403 });
    await startTrip(db, f.users.otherForeman, trip.id, { odometerKm: 1, fuel: 100, photos: [photo()] });
    expect(await db.select().from(vehiclePositions)).toEqual([]);
  });
});
