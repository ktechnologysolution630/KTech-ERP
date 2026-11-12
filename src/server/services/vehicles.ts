import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  assets,
  attachments,
  projects,
  users,
  vehiclePositions,
  vehicleProfiles,
  vehicleTripExpenses,
  vehicleTrips,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';
import {
  EXPENSE_KINDS,
  FUEL_LEVELS,
  HOLDING_STATUSES,
  isOverdue,
  liveState,
  MAX_ACCURACY_M,
  MAX_ODOMETER_KM,
  MAX_POINTS_PER_SEND,
  overlaps,
  routeKm,
  serviceDue,
  type LiveState,
  type TripExpenseKind,
  type TripStatus,
} from '@/domain/vehicle';
import { assertCan, can, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { addAttachment } from './attachments';
import { notify, usersWithRole } from './notifications';
import { nextDocNumber } from './numbering';

/** The asset register's category for vehicles */
export const VEHICLE_CATEGORY = 'ยานพาหนะ';
const APPROVER_ROLES = ['GENERAL_MANAGER', 'PURCHASING_HEAD', 'OWNER', 'ADMIN'] as const;
const MAX_PHOTOS = 6;

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('INVALID_TRIP', r.error.issues[0]!.message);
  return r.data;
}

function uuidOr404(id: string, what = 'รายการใช้รถ') {
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', `ไม่พบ${what}`, 404);
}

const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------- vehicles

export interface VehicleRow {
  id: string;
  code: string;
  name: string;
  plateNo: string;
  projectId: string | null;
  odometerKm: number | null;
  serviceEveryKm: number | null;
  lastServiceKm: number | null;
  bookable: boolean;
  /** The trip holding it right now, if it is out */
  inUseTripId: string | null;
}

/** Vehicles in the asset register that are still in use, with what the vehicle menu keeps on them */
export async function listVehicles(db: Db): Promise<VehicleRow[]> {
  const rows = await db
    .select({
      id: assets.id,
      code: assets.code,
      name: assets.name,
      serialNo: assets.serialNo,
      projectId: assets.projectId,
      plateNo: vehicleProfiles.plateNo,
      odometerKm: vehicleProfiles.odometerKm,
      serviceEveryKm: vehicleProfiles.serviceEveryKm,
      lastServiceKm: vehicleProfiles.lastServiceKm,
      bookable: vehicleProfiles.bookable,
    })
    .from(assets)
    .leftJoin(vehicleProfiles, eq(vehicleProfiles.assetId, assets.id))
    .where(and(eq(assets.category, VEHICLE_CATEGORY), eq(assets.status, 'ACTIVE')))
    .orderBy(asc(assets.code));
  const out = await db
    .select({ id: vehicleTrips.id, assetId: vehicleTrips.assetId })
    .from(vehicleTrips)
    .where(eq(vehicleTrips.status, 'IN_USE'));
  const outBy = new Map(out.map((t) => [t.assetId, t.id]));
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    // Before a plate is entered here, the serial number in the register is usually the plate
    plateNo: r.plateNo || r.serialNo,
    projectId: r.projectId,
    odometerKm: num(r.odometerKm),
    serviceEveryKm: r.serviceEveryKm,
    lastServiceKm: num(r.lastServiceKm),
    bookable: r.bookable ?? true,
    inUseTripId: outBy.get(r.id) ?? null,
  }));
}

const profileSchema = z.object({
  plateNo: z.string().trim().max(40, 'ทะเบียนรถยาวเกินไป'),
  odometerKm: z.number().finite().min(0, 'เลขไมล์ต้องไม่ติดลบ').max(9_999_999).nullable(),
  serviceEveryKm: z.number().int().min(0).max(1_000_000).nullable(),
  lastServiceKm: z.number().finite().min(0).max(9_999_999).nullable(),
  bookable: z.boolean(),
});
export type VehicleProfileInput = z.input<typeof profileSchema>;

export async function saveVehicleProfile(db: Db, actor: SessionUser, assetId: string, input: VehicleProfileInput): Promise<void> {
  assertCan(actor, 'vehicle.manage');
  uuidOr404(assetId, 'รถ');
  const d = parse(profileSchema, input);
  const [a] = await db.select({ category: assets.category }).from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!a || a.category !== VEHICLE_CATEGORY) throw new DomainError('NOT_FOUND', 'ไม่พบรถในทะเบียนทรัพย์สิน', 404);
  const values = {
    plateNo: d.plateNo,
    odometerKm: d.odometerKm === null ? null : D(d.odometerKm).toFixed(1),
    serviceEveryKm: d.serviceEveryKm || null,
    lastServiceKm: d.lastServiceKm === null ? null : D(d.lastServiceKm).toFixed(1),
    bookable: d.bookable,
    updatedAt: new Date(),
  };
  await db.insert(vehicleProfiles).values({ assetId, ...values }).onConflictDoUpdate({ target: vehicleProfiles.assetId, set: values });
  await logActivity(db, { entityType: 'ASSET', entityId: assetId, action: 'vehicle.profile', userId: actor.id });
}

// ---------------------------------------------------------------- trips

const requestSchema = z
  .object({
    assetId: z.string().uuid('กรุณาเลือกรถ'),
    driverId: z.string().uuid('กรุณาเลือกผู้ขับ').nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    purpose: z.string().trim().min(1, 'กรุณาระบุวัตถุประสงค์').max(500, 'วัตถุประสงค์ยาวเกินไป'),
    destination: z.string().trim().max(300, 'ปลายทางยาวเกินไป').default(''),
    plannedStart: z.coerce.date({ invalid_type_error: 'วันเวลาออกไม่ถูกต้อง' }),
    plannedEnd: z.coerce.date({ invalid_type_error: 'วันเวลาคืนไม่ถูกต้อง' }),
  })
  .refine((d) => d.plannedEnd > d.plannedStart, { message: 'เวลาคืนรถต้องหลังเวลาออก', path: ['plannedEnd'] })
  .refine((d) => d.plannedEnd.getTime() - d.plannedStart.getTime() <= 31 * 86_400_000, { message: 'จองได้ไม่เกิน 31 วันต่อครั้ง', path: ['plannedEnd'] });
export type TripRequestInput = z.input<typeof requestSchema>;

async function lockTrip(tx: Db, id: string) {
  uuidOr404(id);
  const [t] = await tx.select().from(vehicleTrips).where(eq(vehicleTrips.id, id)).for('update');
  if (!t) throw new DomainError('NOT_FOUND', 'ไม่พบรายการใช้รถ', 404);
  return t;
}

/** Another booking of the vehicle that overlaps these hours, if any */
async function clashingTrip(tx: Db, assetId: string, start: Date, end: Date, exceptId?: string) {
  const rows = await tx
    .select({ number: vehicleTrips.number, start: vehicleTrips.plannedStart, end: vehicleTrips.plannedEnd })
    .from(vehicleTrips)
    .where(
      and(
        eq(vehicleTrips.assetId, assetId),
        inArray(vehicleTrips.status, HOLDING_STATUSES),
        exceptId ? ne(vehicleTrips.id, exceptId) : undefined,
        lt(vehicleTrips.plannedStart, end),
      ),
    );
  return rows.find((r) => overlaps({ start, end }, { start: r.start, end: r.end })) ?? null;
}

const isInvolved = (actor: SessionUser, t: { requestedBy: string; driverId: string }) => t.requestedBy === actor.id || t.driverId === actor.id;

export async function requestTrip(db: Db, actor: SessionUser, input: TripRequestInput): Promise<{ id: string; number: string }> {
  assertCan(actor, 'vehicle.request');
  const d = parse(requestSchema, input);
  if (d.plannedEnd.getTime() < Date.now() - 60_000) throw new DomainError('INVALID_TRIP', 'เวลาคืนรถผ่านไปแล้ว');
  return db.transaction(async (tx) => {
    const [v] = await tx
      .select({ code: assets.code, name: assets.name, category: assets.category, status: assets.status, bookable: vehicleProfiles.bookable })
      .from(assets)
      .leftJoin(vehicleProfiles, eq(vehicleProfiles.assetId, assets.id))
      .where(eq(assets.id, d.assetId))
      .for('update', { of: assets });
    if (!v || v.category !== VEHICLE_CATEGORY || v.status !== 'ACTIVE') throw new DomainError('INVALID_TRIP', 'ไม่พบรถคันนี้ในทะเบียน');
    if (v.bookable === false) throw new DomainError('INVALID_TRIP', 'รถคันนี้งดให้จองชั่วคราว');

    const driverId = d.driverId ?? actor.id;
    const [driver] = await tx.select({ active: users.active }).from(users).where(eq(users.id, driverId)).limit(1);
    if (!driver?.active) throw new DomainError('INVALID_TRIP', 'ไม่พบผู้ขับ หรือบัญชีถูกปิดใช้งาน');

    if (d.projectId) {
      const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, d.projectId)).limit(1);
      if (!p) throw new DomainError('INVALID_TRIP', 'ไม่พบโครงการ');
      if (isSiteScopedOnly(actor) && !actor.projectIds.includes(d.projectId)) throw new DomainError('FORBIDDEN', 'ไม่ใช่โครงการของคุณ', 403);
    }

    const clash = await clashingTrip(tx, d.assetId, d.plannedStart, d.plannedEnd);
    if (clash) throw new DomainError('VEHICLE_BOOKED', `รถคันนี้ถูกจองช่วงเวลานี้แล้ว (${clash.number})`, 409);

    const number = await nextDocNumber(tx, 'VT');
    const [row] = await tx
      .insert(vehicleTrips)
      .values({
        number,
        assetId: d.assetId,
        requestedBy: actor.id,
        driverId,
        projectId: d.projectId ?? null,
        purpose: d.purpose,
        destination: d.destination,
        plannedStart: d.plannedStart,
        plannedEnd: d.plannedEnd,
      })
      .returning();
    await logActivity(tx, { entityType: 'VEHICLE_TRIP', entityId: row!.id, action: 'request', userId: actor.id });
    const approvers = (await usersWithRole(tx, [...APPROVER_ROLES])).filter((id) => id !== actor.id);
    await notify(tx, approvers, { title: `${number} ขอใช้รถ ${v.code} ${v.name}`, href: `/vehicles/${row!.id}`, category: 'VEHICLE', projectId: d.projectId ?? null });
    return { id: row!.id, number };
  });
}

export async function decideTrip(db: Db, actor: SessionUser, id: string, approve: boolean, noteInput = ''): Promise<void> {
  assertCan(actor, 'vehicle.approve');
  const note = noteInput.trim().slice(0, 1000);
  if (!approve && !note) throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  await db.transaction(async (tx) => {
    const t = await lockTrip(tx, id);
    if (t.status !== 'REQUESTED') throw new DomainError('INVALID_STATE', 'รายการนี้ไม่ได้รออนุมัติ', 409);
    if (t.requestedBy === actor.id && !actor.roles.includes('OWNER')) throw new DomainError('SELF_APPROVAL', 'อนุมัติคำขอใช้รถของตนเองไม่ได้', 403);
    await tx
      .update(vehicleTrips)
      .set({ status: approve ? 'APPROVED' : 'REJECTED', decidedBy: actor.id, decidedAt: new Date(), decisionNote: note, updatedAt: new Date() })
      .where(eq(vehicleTrips.id, id));
    await logActivity(tx, { entityType: 'VEHICLE_TRIP', entityId: id, action: approve ? 'approve' : 'reject', userId: actor.id, note: note || undefined });
    await notify(tx, [t.requestedBy, t.driverId], {
      title: `${t.number} ${approve ? 'อนุมัติให้ใช้รถแล้ว' : `ไม่อนุมัติ: ${note}`}`,
      href: `/vehicles/${id}`,
      category: 'VEHICLE',
      level: approve ? undefined : 'WARNING',
    });
  });
}

export async function cancelTrip(db: Db, actor: SessionUser, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await lockTrip(tx, id);
    if (!isInvolved(actor, t) && !can(actor, 'vehicle.approve')) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ยกเลิกรายการนี้', 403);
    if (t.status !== 'REQUESTED' && t.status !== 'APPROVED') throw new DomainError('INVALID_STATE', 'ยกเลิกได้เฉพาะรายการที่ยังไม่รับรถ', 409);
    await tx.update(vehicleTrips).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(vehicleTrips.id, id));
    await logActivity(tx, { entityType: 'VEHICLE_TRIP', entityId: id, action: 'cancel', userId: actor.id });
  });
}

const fuelSchema = z.number().refine((v) => FUEL_LEVELS.some((f) => f.value === v), 'กรุณาเลือกระดับน้ำมัน');
const handoverSchema = z.object({
  odometerKm: z.number({ invalid_type_error: 'กรุณากรอกเลขไมล์' }).finite().min(0, 'เลขไมล์ต้องไม่ติดลบ').max(MAX_ODOMETER_KM, `เลขไมล์ต้องไม่เกิน ${MAX_ODOMETER_KM.toLocaleString('th-TH')} กม. กรุณาตรวจตัวเลขอีกครั้ง`),
  fuel: fuelSchema,
  note: z.string().trim().max(1000).default(''),
  damage: z.string().trim().max(1000).default(''),
});
export type TripHandoverInput = z.input<typeof handoverSchema> & { photos: File[] };

function checkPhotos(photos: File[]) {
  const real = photos.filter((p) => p && p.size > 0);
  if (real.length === 0) throw new DomainError('PHOTO_REQUIRED', 'กรุณาถ่ายรูปสภาพรถอย่างน้อย 1 รูป');
  if (real.length > MAX_PHOTOS) throw new DomainError('INVALID_TRIP', `แนบรูปได้ไม่เกิน ${MAX_PHOTOS} รูป`);
  return real;
}

/** The driver takes the vehicle: odometer, fuel and photos of how it was handed over */
export async function startTrip(db: Db, actor: SessionUser, id: string, input: TripHandoverInput): Promise<void> {
  const d = parse(handoverSchema, input);
  const photos = checkPhotos(input.photos);
  await db.transaction(async (tx) => {
    const t = await lockTrip(tx, id);
    if (t.driverId !== actor.id && !can(actor, 'vehicle.approve')) throw new DomainError('FORBIDDEN', 'ผู้ขับที่ระบุไว้เท่านั้นที่รับรถได้', 403);
    if (t.status !== 'APPROVED') throw new DomainError('INVALID_STATE', t.status === 'REQUESTED' ? 'คำขอนี้ยังไม่ได้รับอนุมัติ' : 'รับรถไม่ได้ในสถานะนี้', 409);
    const [out] = await tx
      .select({ number: vehicleTrips.number })
      .from(vehicleTrips)
      .where(and(eq(vehicleTrips.assetId, t.assetId), eq(vehicleTrips.status, 'IN_USE')))
      .limit(1);
    if (out) throw new DomainError('VEHICLE_OUT', `รถคันนี้ยังไม่ถูกคืนจาก ${out.number}`, 409);
    const [p] = await tx.select({ odometerKm: vehicleProfiles.odometerKm }).from(vehicleProfiles).where(eq(vehicleProfiles.assetId, t.assetId)).limit(1);
    const last = num(p?.odometerKm);
    if (last !== null && d.odometerKm < last) throw new DomainError('INVALID_ODOMETER', `เลขไมล์น้อยกว่าครั้งล่าสุด (${last.toLocaleString('th-TH')} กม.)`);

    await tx
      .update(vehicleTrips)
      .set({ status: 'IN_USE', startedAt: new Date(), startOdometerKm: D(d.odometerKm).toFixed(1), startFuel: d.fuel, startNote: d.note, updatedAt: new Date() })
      .where(eq(vehicleTrips.id, id));
    for (const photo of photos) await addAttachment(tx, actor, { entityType: 'VEHICLE_TRIP', entityId: id, file: photo, kind: 'PHOTO', folder: 'START' });
    await logActivity(tx, { entityType: 'VEHICLE_TRIP', entityId: id, action: 'start', userId: actor.id, note: `เลขไมล์ ${d.odometerKm}` });
  });
}

/** The vehicle comes back: odometer, fuel, damage and photos; the vehicle's odometer moves on */
export async function returnTrip(db: Db, actor: SessionUser, id: string, input: TripHandoverInput): Promise<void> {
  const d = parse(handoverSchema, input);
  const photos = checkPhotos(input.photos);
  await db.transaction(async (tx) => {
    const t = await lockTrip(tx, id);
    if (t.driverId !== actor.id && !can(actor, 'vehicle.approve')) throw new DomainError('FORBIDDEN', 'ผู้ขับที่ระบุไว้เท่านั้นที่คืนรถได้', 403);
    if (t.status !== 'IN_USE') throw new DomainError('INVALID_STATE', 'รายการนี้ไม่ได้อยู่ระหว่างใช้งาน', 409);
    const start = num(t.startOdometerKm) ?? 0;
    if (d.odometerKm < start) throw new DomainError('INVALID_ODOMETER', `เลขไมล์ตอนคืนน้อยกว่าตอนรับรถ (${start.toLocaleString('th-TH')} กม.)`);
    if (d.odometerKm - start > 5000) throw new DomainError('INVALID_ODOMETER', 'ระยะทางเกิน 5,000 กม. กรุณาตรวจเลขไมล์อีกครั้ง');

    await tx
      .update(vehicleTrips)
      .set({ status: 'RETURNED', endedAt: new Date(), endOdometerKm: D(d.odometerKm).toFixed(1), endFuel: d.fuel, endNote: d.note, damage: d.damage, updatedAt: new Date() })
      .where(eq(vehicleTrips.id, id));
    const odometerKm = D(d.odometerKm).toFixed(1);
    await tx
      .insert(vehicleProfiles)
      .values({ assetId: t.assetId, odometerKm })
      .onConflictDoUpdate({ target: vehicleProfiles.assetId, set: { odometerKm, updatedAt: new Date() } });
    for (const photo of photos) await addAttachment(tx, actor, { entityType: 'VEHICLE_TRIP', entityId: id, file: photo, kind: 'PHOTO', folder: 'END' });
    await logActivity(tx, { entityType: 'VEHICLE_TRIP', entityId: id, action: 'return', userId: actor.id, note: `เลขไมล์ ${d.odometerKm}` });
    if (d.damage) {
      await notify(tx, await usersWithRole(tx, [...APPROVER_ROLES]), {
        title: `${t.number} คืนรถพร้อมแจ้งความเสียหาย: ${d.damage.slice(0, 80)}`,
        href: `/vehicles/${id}`,
        category: 'VEHICLE',
        level: 'WARNING',
      });
    }
  });
}

// ---------------------------------------------------------------- live position

const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracyM: z.number().finite().min(0).max(100_000).nullable().optional(),
  speedKmh: z.number().finite().min(0).max(400).nullable().optional(),
  at: z.coerce.date(),
});
/** As sent by the phone: the time comes as an ISO string over the wire */
export type PositionInput = Omit<z.input<typeof pointSchema>, 'at'> & { at: Date | string };

/**
 * Positions from the driver's phone. Readings too vague to place the vehicle, from before the trip
 * began or from the future are dropped, not refused: the phone keeps sending and a bad fix now and
 * then must not stop it. Returns how many were kept and whether the phone should keep sending.
 */
export async function recordPositions(db: Db, actor: SessionUser, tripId: string, input: PositionInput[]): Promise<{ kept: number; tracking: boolean }> {
  uuidOr404(tripId);
  if (!Array.isArray(input) || input.length > MAX_POINTS_PER_SEND) throw new DomainError('INVALID_TRIP', 'ข้อมูลตำแหน่งไม่ถูกต้อง');
  const [t] = await db
    .select({ assetId: vehicleTrips.assetId, driverId: vehicleTrips.driverId, status: vehicleTrips.status, startedAt: vehicleTrips.startedAt, lastSeenAt: vehicleTrips.lastSeenAt })
    .from(vehicleTrips)
    .where(eq(vehicleTrips.id, tripId))
    .limit(1);
  if (!t) throw new DomainError('NOT_FOUND', 'ไม่พบรายการใช้รถ', 404);
  if (t.driverId !== actor.id) throw new DomainError('FORBIDDEN', 'ผู้ขับที่ระบุไว้เท่านั้นที่ส่งตำแหน่งได้', 403);
  if (t.status !== 'IN_USE' || !t.startedAt) return { kept: 0, tracking: false };

  const now = Date.now();
  const earliest = t.startedAt.getTime() - 5 * 60_000;
  const points = input
    .map((p) => pointSchema.safeParse(p))
    .flatMap((r) => (r.success ? [r.data] : []))
    .filter((p) => (p.accuracyM ?? 0) <= MAX_ACCURACY_M && p.at.getTime() >= earliest && p.at.getTime() <= now + 2 * 60_000)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (points.length === 0) return { kept: 0, tracking: true };

  await db.transaction(async (tx) => {
    await tx.insert(vehiclePositions).values(
      points.map((p) => ({
        assetId: t.assetId,
        tripId,
        lat: p.lat,
        lng: p.lng,
        accuracyM: p.accuracyM === null || p.accuracyM === undefined ? null : Math.round(p.accuracyM),
        speedKmh: p.speedKmh ?? null,
        recordedAt: p.at,
        source: 'PHONE' as const,
      })),
    );
    const newest = points[points.length - 1]!;
    // A batch held back while offline must not move the vehicle back to where it was an hour ago
    await tx
      .update(vehicleTrips)
      .set({ lastLat: newest.lat, lastLng: newest.lng, lastAccuracyM: newest.accuracyM === null || newest.accuracyM === undefined ? null : Math.round(newest.accuracyM), lastSpeedKmh: newest.speedKmh ?? null, lastSeenAt: newest.at })
      .where(and(eq(vehicleTrips.id, tripId), or(sql`${vehicleTrips.lastSeenAt} is null`, lt(vehicleTrips.lastSeenAt, newest.at))));
  });
  return { kept: points.length, tracking: true };
}

// ---------------------------------------------------------------- expenses

const expenseSchema = z.object({
  kind: z.enum(EXPENSE_KINDS, { errorMap: () => ({ message: 'กรุณาเลือกประเภทค่าใช้จ่าย' }) }),
  amount: z.number({ invalid_type_error: 'กรุณากรอกจำนวนเงิน' }).finite().gt(0, 'จำนวนเงินต้องมากกว่า 0').max(10_000_000),
  liters: z.number().finite().gt(0).max(10_000).nullable().optional(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ไม่ถูกต้อง').optional(),
  note: z.string().trim().max(500).default(''),
});
export type TripExpenseInput = z.input<typeof expenseSchema> & { receipt?: File | null };

export async function addTripExpense(db: Db, actor: SessionUser, tripId: string, input: TripExpenseInput): Promise<{ id: string }> {
  const d = parse(expenseSchema, input);
  return db.transaction(async (tx) => {
    const t = await lockTrip(tx, tripId);
    if (!isInvolved(actor, t) && !can(actor, 'vehicle.approve')) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์บันทึกค่าใช้จ่ายของรายการนี้', 403);
    if (t.status !== 'IN_USE' && t.status !== 'RETURNED') throw new DomainError('INVALID_STATE', 'บันทึกค่าใช้จ่ายได้หลังรับรถแล้ว', 409);
    const [row] = await tx
      .insert(vehicleTripExpenses)
      .values({
        tripId,
        kind: d.kind,
        amount: D(d.amount).toFixed(2),
        liters: d.kind === 'FUEL' && d.liters ? D(d.liters).toFixed(2) : null,
        paidOn: d.paidOn ?? bangkokDateString(),
        note: d.note,
        createdBy: actor.id,
      })
      .returning();
    if (input.receipt && input.receipt.size > 0) {
      await addAttachment(tx, actor, { entityType: 'VEHICLE_EXPENSE', entityId: row!.id, file: input.receipt, kind: 'PHOTO' });
    }
    await logActivity(tx, { entityType: 'VEHICLE_TRIP', entityId: tripId, action: 'expense', userId: actor.id, note: `${d.kind} ${d.amount}` });
    return { id: row!.id };
  });
}

export async function removeTripExpense(db: Db, actor: SessionUser, expenseId: string): Promise<void> {
  uuidOr404(expenseId, 'ค่าใช้จ่าย');
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(vehicleTripExpenses).where(eq(vehicleTripExpenses.id, expenseId)).limit(1);
    if (!e) throw new DomainError('NOT_FOUND', 'ไม่พบค่าใช้จ่าย', 404);
    if (e.createdBy !== actor.id && !can(actor, 'vehicle.approve')) throw new DomainError('FORBIDDEN', 'ลบได้เฉพาะรายการที่ตนเองบันทึก', 403);
    await tx.delete(attachments).where(and(eq(attachments.entityType, 'VEHICLE_EXPENSE'), eq(attachments.entityId, expenseId)));
    await tx.delete(vehicleTripExpenses).where(eq(vehicleTripExpenses.id, expenseId));
    await logActivity(tx, { entityType: 'VEHICLE_TRIP', entityId: e.tripId, action: 'expense.remove', userId: actor.id });
  });
}

// ---------------------------------------------------------------- reading

const requester = alias(users, 'requester');
const driver = alias(users, 'driver');
const decider = alias(users, 'decider');

const tripColumns = {
  id: vehicleTrips.id,
  number: vehicleTrips.number,
  status: vehicleTrips.status,
  assetId: vehicleTrips.assetId,
  vehicleCode: assets.code,
  vehicleName: assets.name,
  plateNo: sql<string>`coalesce(nullif(${vehicleProfiles.plateNo}, ''), ${assets.serialNo})`,
  requestedBy: vehicleTrips.requestedBy,
  requesterName: requester.name,
  driverId: vehicleTrips.driverId,
  driverName: driver.name,
  projectId: vehicleTrips.projectId,
  projectCode: projects.code,
  projectName: projects.name,
  purpose: vehicleTrips.purpose,
  destination: vehicleTrips.destination,
  plannedStart: vehicleTrips.plannedStart,
  plannedEnd: vehicleTrips.plannedEnd,
  decidedByName: decider.name,
  decidedAt: vehicleTrips.decidedAt,
  decisionNote: vehicleTrips.decisionNote,
  startedAt: vehicleTrips.startedAt,
  startOdometerKm: vehicleTrips.startOdometerKm,
  startFuel: vehicleTrips.startFuel,
  startNote: vehicleTrips.startNote,
  endedAt: vehicleTrips.endedAt,
  endOdometerKm: vehicleTrips.endOdometerKm,
  endFuel: vehicleTrips.endFuel,
  endNote: vehicleTrips.endNote,
  damage: vehicleTrips.damage,
  lastLat: vehicleTrips.lastLat,
  lastLng: vehicleTrips.lastLng,
  lastAccuracyM: vehicleTrips.lastAccuracyM,
  lastSpeedKmh: vehicleTrips.lastSpeedKmh,
  lastSeenAt: vehicleTrips.lastSeenAt,
  createdAt: vehicleTrips.createdAt,
};

function tripQuery(db: Db) {
  return db
    .select(tripColumns)
    .from(vehicleTrips)
    .innerJoin(assets, eq(assets.id, vehicleTrips.assetId))
    .leftJoin(vehicleProfiles, eq(vehicleProfiles.assetId, vehicleTrips.assetId))
    .innerJoin(requester, eq(requester.id, vehicleTrips.requestedBy))
    .innerJoin(driver, eq(driver.id, vehicleTrips.driverId))
    .leftJoin(decider, eq(decider.id, vehicleTrips.decidedBy))
    .leftJoin(projects, eq(projects.id, vehicleTrips.projectId));
}

type TripRow = Awaited<ReturnType<ReturnType<typeof tripQuery>['execute']>>[number];

function shapeTrip(r: TripRow) {
  const startKm = num(r.startOdometerKm);
  const endKm = num(r.endOdometerKm);
  return {
    ...r,
    startOdometerKm: startKm,
    endOdometerKm: endKm,
    distanceKm: startKm !== null && endKm !== null ? Math.round((endKm - startKm) * 10) / 10 : null,
    overdue: isOverdue(r),
    live: r.status === 'IN_USE' ? liveState(r.lastSeenAt, r.lastSpeedKmh) : null,
  };
}
export type TripDto = ReturnType<typeof shapeTrip>;

/** May this person see the trip? Those on it, those who approve, and those who watch the fleet. */
function canSeeTrip(actor: SessionUser, t: { requestedBy: string; driverId: string }) {
  return isInvolved(actor, t) || can(actor, 'vehicle.track') || can(actor, 'vehicle.approve');
}

export async function listTrips(db: Db, actor: SessionUser, opts: { scope?: 'mine' | 'all'; status?: TripStatus[] } = {}): Promise<TripDto[]> {
  const all = opts.scope === 'all' && can(actor, 'vehicle.track');
  const rows = await tripQuery(db)
    .where(
      and(
        all ? undefined : or(eq(vehicleTrips.requestedBy, actor.id), eq(vehicleTrips.driverId, actor.id)),
        opts.status?.length ? inArray(vehicleTrips.status, opts.status) : undefined,
      ),
    )
    .orderBy(desc(vehicleTrips.plannedStart))
    .limit(500);
  return rows.map(shapeTrip);
}

export interface TripPhoto {
  id: string;
  url: string;
  stage: 'START' | 'END';
}

export async function getTrip(db: Db, actor: SessionUser, id: string) {
  uuidOr404(id);
  const [r] = await tripQuery(db).where(eq(vehicleTrips.id, id)).limit(1);
  if (!r) throw new DomainError('NOT_FOUND', 'ไม่พบรายการใช้รถ', 404);
  if (!canSeeTrip(actor, r)) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดูรายการนี้', 403);
  const [photos, expenses, gpsKm] = await Promise.all([
    db
      .select({ id: attachments.id, url: attachments.url, folder: attachments.folder })
      .from(attachments)
      .where(and(eq(attachments.entityType, 'VEHICLE_TRIP'), eq(attachments.entityId, id)))
      .orderBy(asc(attachments.createdAt)),
    db.select().from(vehicleTripExpenses).where(eq(vehicleTripExpenses.tripId, id)).orderBy(asc(vehicleTripExpenses.paidOn), asc(vehicleTripExpenses.createdAt)),
    tripRoute(db, id).then((pts) => routeKm(pts)),
  ]);
  const receipts = expenses.length
    ? await db
        .select({ entityId: attachments.entityId, url: attachments.url })
        .from(attachments)
        .where(and(eq(attachments.entityType, 'VEHICLE_EXPENSE'), inArray(attachments.entityId, expenses.map((e) => e.id))))
    : [];
  const receiptBy = new Map(receipts.map((x) => [x.entityId, x.url]));
  return {
    ...shapeTrip(r),
    gpsKm,
    photos: photos.map((p): TripPhoto => ({ id: p.id, url: p.url, stage: p.folder === 'END' ? 'END' : 'START' })),
    expenses: expenses.map((e) => ({
      id: e.id,
      kind: e.kind as TripExpenseKind,
      amount: Number(e.amount),
      liters: num(e.liters),
      paidOn: e.paidOn,
      note: e.note,
      createdBy: e.createdBy,
      receiptUrl: receiptBy.get(e.id) ?? null,
    })),
    canApprove: r.status === 'REQUESTED' && can(actor, 'vehicle.approve') && (r.requestedBy !== actor.id || actor.roles.includes('OWNER')),
    isDriver: r.driverId === actor.id,
    canHandle: r.driverId === actor.id || can(actor, 'vehicle.approve'),
    canCancel: (r.status === 'REQUESTED' || r.status === 'APPROVED') && (isInvolved(actor, r) || can(actor, 'vehicle.approve')),
  };
}
export type TripDetail = Awaited<ReturnType<typeof getTrip>>;

async function tripRoute(db: Db, tripId: string) {
  const rows = await db
    .select({ lat: vehiclePositions.lat, lng: vehiclePositions.lng, at: vehiclePositions.recordedAt })
    .from(vehiclePositions)
    .where(eq(vehiclePositions.tripId, tripId))
    .orderBy(asc(vehiclePositions.recordedAt))
    .limit(20_000);
  return rows;
}

/** The route driven so far, thinned to what a map can draw */
export async function getTripRoute(db: Db, actor: SessionUser, tripId: string): Promise<[number, number][]> {
  uuidOr404(tripId);
  const [t] = await db.select({ requestedBy: vehicleTrips.requestedBy, driverId: vehicleTrips.driverId }).from(vehicleTrips).where(eq(vehicleTrips.id, tripId)).limit(1);
  if (!t) throw new DomainError('NOT_FOUND', 'ไม่พบรายการใช้รถ', 404);
  if (!canSeeTrip(actor, t)) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดูรายการนี้', 403);
  const pts = await tripRoute(db, tripId);
  const step = Math.max(1, Math.ceil(pts.length / 2000));
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => [p.lat, p.lng]);
}

export interface LiveVehicle {
  tripId: string;
  tripNumber: string;
  assetId: string;
  vehicleCode: string;
  vehicleName: string;
  plateNo: string;
  driverName: string;
  projectCode: string | null;
  destination: string;
  plannedEnd: string;
  overdue: boolean;
  state: LiveState;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  speedKmh: number | null;
  lastSeenAt: string | null;
}

/** Every vehicle that is out right now and where it last was: the live map, read every few seconds */
export async function getFleetLive(db: Db, actor: SessionUser): Promise<{ vehicles: LiveVehicle[]; at: string }> {
  assertCan(actor, 'vehicle.track');
  const rows = await tripQuery(db).where(eq(vehicleTrips.status, 'IN_USE')).orderBy(asc(assets.code));
  const now = new Date();
  return {
    at: now.toISOString(),
    vehicles: rows.map((r) => ({
      tripId: r.id,
      tripNumber: r.number,
      assetId: r.assetId,
      vehicleCode: r.vehicleCode,
      vehicleName: r.vehicleName,
      plateNo: r.plateNo,
      driverName: r.driverName,
      projectCode: r.projectCode,
      destination: r.destination,
      plannedEnd: r.plannedEnd.toISOString(),
      overdue: isOverdue(r, now),
      state: liveState(r.lastSeenAt, r.lastSpeedKmh, now),
      lat: r.lastLat,
      lng: r.lastLng,
      accuracyM: r.lastAccuracyM,
      speedKmh: r.lastSpeedKmh === null ? null : Math.round(r.lastSpeedKmh),
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    })),
  };
}

// ---------------------------------------------------------------- report

export interface VehicleReport {
  from: string;
  to: string;
  byVehicle: { assetId: string; code: string; name: string; plateNo: string; trips: number; km: number; cost: number; liters: number; costPerKm: number | null }[];
  byDriver: { name: string; trips: number; km: number; cost: number }[];
  byProject: { code: string; name: string; trips: number; km: number; cost: number }[];
  service: { assetId: string; code: string; name: string; plateNo: string; odometerKm: number; dueAtKm: number; remainingKm: number }[];
  overdue: TripDto[];
  damaged: TripDto[];
}

/** Trips returned between two dates (inclusive, Bangkok days), totalled by vehicle, driver and project */
export async function getVehicleReport(db: Db, actor: SessionUser, range: { from: string; to: string }): Promise<VehicleReport> {
  assertCan(actor, 'vehicle.track');
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(range.from) || !day.test(range.to) || range.from > range.to) throw new DomainError('INVALID_TRIP', 'ช่วงวันที่ไม่ถูกต้อง');
  const start = new Date(`${range.from}T00:00:00+07:00`);
  const end = new Date(new Date(`${range.to}T00:00:00+07:00`).getTime() + 86_400_000);

  const trips = (await tripQuery(db).where(and(eq(vehicleTrips.status, 'RETURNED'), gte(vehicleTrips.endedAt, start), lt(vehicleTrips.endedAt, end)))).map(shapeTrip);
  const expenses = trips.length
    ? await db
        .select({ tripId: vehicleTripExpenses.tripId, amount: vehicleTripExpenses.amount, liters: vehicleTripExpenses.liters })
        .from(vehicleTripExpenses)
        .where(inArray(vehicleTripExpenses.tripId, trips.map((t) => t.id)))
    : [];
  const costBy = new Map<string, { cost: number; liters: number }>();
  for (const e of expenses) {
    const c = costBy.get(e.tripId) ?? { cost: 0, liters: 0 };
    costBy.set(e.tripId, { cost: c.cost + Number(e.amount), liters: c.liters + Number(e.liters ?? 0) });
  }

  const tally = <K extends string>(key: (t: TripDto) => K, init: (t: TripDto) => Record<string, unknown>) => {
    const m = new Map<K, { trips: number; km: number; cost: number; liters: number } & Record<string, unknown>>();
    for (const t of trips) {
      const k = key(t);
      const row = m.get(k) ?? { ...init(t), trips: 0, km: 0, cost: 0, liters: 0 };
      const c = costBy.get(t.id);
      row.trips += 1;
      row.km += t.distanceKm ?? 0;
      row.cost += c?.cost ?? 0;
      row.liters += c?.liters ?? 0;
      m.set(k, row);
    }
    return [...m.values()];
  };
  const round = (n: number) => Math.round(n * 100) / 100;

  const byVehicle = tally((t) => t.assetId, (t) => ({ assetId: t.assetId, code: t.vehicleCode, name: t.vehicleName, plateNo: t.plateNo }))
    .map((r) => ({ ...(r as unknown as VehicleReport['byVehicle'][number]), km: round(r.km), cost: round(r.cost), liters: round(r.liters), costPerKm: r.km > 0 ? round(r.cost / r.km) : null }))
    .sort((a, b) => b.km - a.km);
  const byDriver = tally((t) => t.driverId, (t) => ({ name: t.driverName }))
    .map((r) => ({ name: r.name as string, trips: r.trips, km: round(r.km), cost: round(r.cost) }))
    .sort((a, b) => b.km - a.km);
  const byProject = tally((t) => t.projectId ?? 'OFFICE', (t) => ({ code: t.projectCode ?? 'OFFICE', name: t.projectName ?? 'สำนักงาน / ส่วนกลาง' }))
    .map((r) => ({ code: r.code as string, name: r.name as string, trips: r.trips, km: round(r.km), cost: round(r.cost) }))
    .sort((a, b) => b.cost - a.cost);

  const service = (await listVehicles(db)).flatMap((v) => {
    const due = serviceDue(v);
    return due?.due ? [{ assetId: v.id, code: v.code, name: v.name, plateNo: v.plateNo, odometerKm: v.odometerKm!, dueAtKm: due.dueAtKm, remainingKm: due.remainingKm }] : [];
  });
  const overdue = (await tripQuery(db).where(and(eq(vehicleTrips.status, 'IN_USE'), lt(vehicleTrips.plannedEnd, new Date())))).map(shapeTrip);
  const damaged = trips.filter((t) => t.damage);

  return { from: range.from, to: range.to, byVehicle, byDriver, byProject, service, overdue, damaged };
}

/** Bookings of the coming days, so a requester can see when each vehicle is free */
export async function listUpcomingBookings(db: Db): Promise<{ assetId: string; number: string; start: Date; end: Date; status: TripStatus; driverName: string }[]> {
  const rows = await db
    .select({ assetId: vehicleTrips.assetId, number: vehicleTrips.number, start: vehicleTrips.plannedStart, end: vehicleTrips.plannedEnd, status: vehicleTrips.status, driverName: users.name })
    .from(vehicleTrips)
    .innerJoin(users, eq(users.id, vehicleTrips.driverId))
    .where(and(inArray(vehicleTrips.status, HOLDING_STATUSES), gte(vehicleTrips.plannedEnd, new Date())))
    .orderBy(asc(vehicleTrips.plannedStart))
    .limit(300);
  return rows;
}

/** Active people who can be named as the driver */
export async function listDriverOptions(db: Db): Promise<{ id: string; name: string }[]> {
  return db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name));
}
