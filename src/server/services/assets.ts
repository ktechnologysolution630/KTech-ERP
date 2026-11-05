import { and, asc, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { assetInspections, assets, attachments, comments, projects, users, type SessionUser } from '@/db/schema';
import {
  ASSET_STATUSES,
  computeDepreciation,
  DEFAULT_INSPECT_EVERY_DAYS,
  dueNoticeKey,
  INSPECTION_DUE_LABELS,
  INSPECTION_RESULTS,
  inspectionDue,
  needsInspection,
  nextInspectionDate,
  type AssetStatus,
  type CheckLocation,
  type Depreciation,
  type InspectionDue,
  type InspectionResult,
} from '@/domain/asset';
import { DomainError } from '@/domain/errors';
import { bangkokDateString } from '@/domain/thai';
import { ASSET_OFFICE_ROLES, assertCan, can, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { addAttachment, removeStoredFile } from './attachments';
import { notify, usersWithRole } from './notifications';
import { nextDocNumber } from './numbering';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');

const assetSchema = z
  .object({
    name: z.string().trim().min(1, 'กรุณาระบุชื่อทรัพย์สิน').max(300),
    category: z.string().trim().max(100).default(''),
    serialNo: z.string().trim().max(100).default(''),
    projectId: z.string().uuid().nullable().default(null),
    custodian: z.string().trim().max(200).default(''),
    purchaseDate: isoDate.nullable().default(null),
    purchaseValue: z.coerce.number().min(0, 'มูลค่าต้องไม่ติดลบ').max(99_999_999_999).default(0),
    salvageValue: z.coerce.number().min(0, 'มูลค่าซากต้องไม่ติดลบ').max(99_999_999_999).default(0),
    usefulLifeYears: z.coerce.number().int('อายุการใช้งานต้องเป็นจำนวนปีเต็ม').min(1, 'อายุการใช้งานต้องอย่างน้อย 1 ปี').max(100, 'อายุการใช้งานต้องไม่เกิน 100 ปี').nullable().default(null),
    inspectEveryDays: z.coerce.number().int('รอบการตรวจต้องเป็นจำนวนวันเต็ม').min(1, 'รอบการตรวจต้องอย่างน้อย 1 วัน').max(3650, 'รอบการตรวจต้องไม่เกิน 3650 วัน').default(DEFAULT_INSPECT_EVERY_DAYS),
    status: z.enum(ASSET_STATUSES).default('ACTIVE'),
    note: z.string().trim().max(1000).default(''),
  })
  .refine((d) => d.salvageValue <= d.purchaseValue, { message: 'มูลค่าซากต้องไม่เกินมูลค่าทรัพย์สิน', path: ['salvageValue'] })
  .refine((d) => d.usefulLifeYears === null || d.purchaseDate !== null, { message: 'กรุณาระบุวันที่ซื้อเพื่อคำนวณค่าเสื่อมราคา', path: ['purchaseDate'] });

export type AssetInput = z.input<typeof assetSchema>;

const locationSchema = z.object({
  latitude: z.number({ invalid_type_error: 'กรุณายืนยันตำแหน่งบนแผนที่', required_error: 'กรุณายืนยันตำแหน่งบนแผนที่' }).min(-90, 'พิกัดไม่ถูกต้อง').max(90, 'พิกัดไม่ถูกต้อง'),
  longitude: z.number({ invalid_type_error: 'กรุณายืนยันตำแหน่งบนแผนที่', required_error: 'กรุณายืนยันตำแหน่งบนแผนที่' }).min(-180, 'พิกัดไม่ถูกต้อง').max(180, 'พิกัดไม่ถูกต้อง'),
  accuracyMeters: z.number({ invalid_type_error: 'กรุณายืนยันตำแหน่งบนแผนที่', required_error: 'กรุณายืนยันตำแหน่งบนแผนที่' }).min(0, 'พิกัดไม่ถูกต้อง').max(1_000_000, 'พิกัดไม่ถูกต้อง'),
});

const inspectionSchema = z
  .object({
    inspectedOn: isoDate,
    result: z.enum(INSPECTION_RESULTS),
    note: z.string().trim().max(1000).default(''),
    location: locationSchema.nullable().default(null),
  })
  .refine((d) => d.result === 'GOOD' || d.note.length > 0, { message: 'กรุณาระบุรายละเอียดเมื่อสภาพไม่ปกติ', path: ['note'] });

export type InspectionInput = z.input<typeof inspectionSchema>;

const parse = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T => {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError('INVALID_ASSET', r.error.issues[0]!.message);
  return r.data;
};

export interface AssetRow {
  id: string;
  code: string;
  name: string;
  category: string;
  serialNo: string;
  projectId: string | null;
  projectName: string | null;
  custodian: string;
  purchaseDate: string | null;
  /** Null for site staff, who see the asset but not what it cost */
  purchaseValue: number | null;
  salvageValue: number | null;
  usefulLifeYears: number | null;
  depreciation: Depreciation | null;
  inspectEveryDays: number;
  status: AssetStatus;
  note: string;
  lastInspectedOn: string | null;
  lastResult: InspectionResult | null;
  nextDueOn: string | null;
  due: InspectionDue;
  canInspect: boolean;
}

export interface AssetPage {
  rows: AssetRow[];
  canManage: boolean;
  canDelete: boolean;
  /** Whether the money columns apply; site staff see the asset but not what it cost */
  canSeeValue: boolean;
  today: string;
}

const latestInspections = async (db: Db, assetIds: string[]) => {
  const latest = assetIds.length
    ? await db
        .selectDistinctOn([assetInspections.assetId], {
          assetId: assetInspections.assetId,
          inspectedOn: assetInspections.inspectedOn,
          result: assetInspections.result,
        })
        .from(assetInspections)
        .where(inArray(assetInspections.assetId, assetIds))
        .orderBy(assetInspections.assetId, desc(assetInspections.inspectedOn), desc(assetInspections.createdAt))
    : [];
  return new Map(latest.map((l) => [l.assetId, l]));
};

/** Everything the user may see, with each asset's latest inspection. */
export async function listAssets(db: Db, actor: SessionUser): Promise<AssetPage> {
  const siteOnly = isSiteScopedOnly(actor);
  const today = bangkokDateString();
  if (siteOnly && actor.projectIds.length === 0) return { rows: [], canManage: false, canDelete: false, canSeeValue: false, today };

  const rows = await db
    .select({ asset: assets, projectName: projects.name })
    .from(assets)
    .leftJoin(projects, eq(projects.id, assets.projectId))
    .where(siteOnly ? inArray(assets.projectId, actor.projectIds) : undefined)
    .orderBy(asc(assets.code));
  const latestByAsset = await latestInspections(db, rows.map((r) => r.asset.id));

  return {
    today,
    canManage: can(actor, 'asset.manage'),
    canDelete: can(actor, 'asset.delete'),
    canSeeValue: !siteOnly,
    rows: rows.map(({ asset: a, projectName }) => {
      const last = latestByAsset.get(a.id);
      const nextDueOn = nextInspectionDate(last?.inspectedOn ?? null, a.inspectEveryDays);
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        category: a.category,
        serialNo: a.serialNo,
        projectId: a.projectId,
        projectName,
        custodian: a.custodian,
        purchaseDate: a.purchaseDate,
        purchaseValue: siteOnly ? null : Number(a.purchaseValue),
        salvageValue: siteOnly ? null : Number(a.salvageValue),
        usefulLifeYears: siteOnly ? null : a.usefulLifeYears,
        depreciation: siteOnly ? null : computeDepreciation(a, today),
        inspectEveryDays: a.inspectEveryDays,
        status: a.status,
        note: a.note,
        lastInspectedOn: last?.inspectedOn ?? null,
        lastResult: last?.result ?? null,
        nextDueOn,
        due: inspectionDue(a.status, nextDueOn, today),
        canInspect: a.status === 'ACTIVE' && can(actor, 'asset.inspect', { projectId: a.projectId }),
      };
    }),
  };
}

const assertProjectExists = async (db: Db, projectId: string | null) => {
  if (!projectId) return;
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new DomainError('INVALID_ASSET', 'ไม่พบโครงการที่เลือก');
};

const assertDateNotFuture = (date: string | null, label: string) => {
  if (date && date > bangkokDateString()) throw new DomainError('INVALID_ASSET', `${label}ต้องไม่เกินวันนี้`);
};

export async function createAsset(db: Db, actor: SessionUser, input: AssetInput): Promise<{ id: string; code: string }> {
  assertCan(actor, 'asset.manage');
  const data = parse(assetSchema, input);
  assertDateNotFuture(data.purchaseDate, 'วันที่ซื้อ');
  await assertProjectExists(db, data.projectId);
  return db.transaction(async (tx) => {
    const code = await nextDocNumber(tx, 'AST');
    const [row] = await tx
      .insert(assets)
      .values({ ...data, code, purchaseValue: data.purchaseValue.toFixed(2), salvageValue: data.salvageValue.toFixed(2), createdBy: actor.id })
      .returning();
    await logActivity(tx, { entityType: 'ASSET', entityId: row!.id, action: 'CREATE', userId: actor.id, note: `${code} ${data.name}` });
    return { id: row!.id, code };
  });
}

export async function updateAsset(db: Db, actor: SessionUser, id: string, input: AssetInput): Promise<void> {
  assertCan(actor, 'asset.manage');
  const assetId = parseId(id);
  const data = parse(assetSchema, input);
  assertDateNotFuture(data.purchaseDate, 'วันที่ซื้อ');
  await assertProjectExists(db, data.projectId);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(assets).where(eq(assets.id, assetId)).for('update');
    if (!before) throw new DomainError('NOT_FOUND', 'ไม่พบทรัพย์สิน', 404);
    await tx
      .update(assets)
      .set({
        ...data,
        purchaseValue: data.purchaseValue.toFixed(2),
        salvageValue: data.salvageValue.toFixed(2),
        retiredOn: data.status === 'RETIRED' ? (before.retiredOn ?? bangkokDateString()) : null,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, assetId));
    const moved = before.projectId !== data.projectId;
    const retired = before.status !== data.status;
    await logActivity(tx, {
      entityType: 'ASSET',
      entityId: assetId,
      action: retired ? `STATUS_${data.status}` : moved ? 'MOVE' : 'UPDATE',
      userId: actor.id,
    });
  });
}

const assetIdsSchema = z.array(z.string().uuid()).min(1, 'กรุณาเลือกทรัพย์สินที่จะลบ').max(5000, 'เลือกทรัพย์สินได้ครั้งละไม่เกิน 5,000 รายการ');

/**
 * Removes assets for good, with their inspection history and photos. Retiring is what keeps one on record;
 * this is for what should never have been there. The activity log stays as the record of who removed what.
 */
export async function deleteAssets(db: Db, actor: SessionUser, ids: string[]): Promise<{ deleted: number }> {
  assertCan(actor, 'asset.delete');
  const assetIds = parse(assetIdsSchema, ids);
  return db.transaction(async (tx) => {
    const targets = await tx.select({ id: assets.id, code: assets.code, name: assets.name }).from(assets).where(inArray(assets.id, assetIds)).for('update');
    if (targets.length === 0) throw new DomainError('NOT_FOUND', 'ไม่พบทรัพย์สินที่เลือก อาจถูกลบไปแล้ว', 404);
    const foundIds = targets.map((a) => a.id);

    const inspections = await tx.select({ id: assetInspections.id }).from(assetInspections).where(inArray(assetInspections.assetId, foundIds));
    const entityIds = [...foundIds, ...inspections.map((i) => i.id)];
    const files = await tx.select({ url: attachments.url }).from(attachments).where(inArray(attachments.entityId, entityIds));
    await tx.delete(attachments).where(inArray(attachments.entityId, entityIds));
    await tx.delete(comments).where(inArray(comments.entityId, entityIds));
    for (const file of files) await removeStoredFile(tx, file.url);

    await tx.delete(assetInspections).where(inArray(assetInspections.assetId, foundIds));
    await tx.delete(assets).where(inArray(assets.id, foundIds));
    for (const asset of targets) {
      await logActivity(tx, { entityType: 'ASSET', entityId: asset.id, action: 'DELETE', userId: actor.id, note: `${asset.code} ${asset.name}` });
    }
    return { deleted: targets.length };
  });
}

function parseId(id: string): string {
  if (!z.string().uuid().safeParse(id).success) throw new DomainError('NOT_FOUND', 'ไม่พบทรัพย์สิน', 404);
  return id;
}

const loadVisibleAsset = async (db: Db, actor: SessionUser, id: string) => {
  const [asset] = await db.select().from(assets).where(eq(assets.id, parseId(id))).limit(1);
  if (!asset) throw new DomainError('NOT_FOUND', 'ไม่พบทรัพย์สิน', 404);
  if (isSiteScopedOnly(actor) && !(asset.projectId && actor.projectIds.includes(asset.projectId))) {
    throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงทรัพย์สินนี้', 403);
  }
  return asset;
};

export async function recordInspection(db: Db, actor: SessionUser, assetId: string, input: InspectionInput): Promise<{ id: string }> {
  const data = parse(inspectionSchema, input);
  assertDateNotFuture(data.inspectedOn, 'วันที่ตรวจ');
  const asset = await loadVisibleAsset(db, actor, assetId);
  assertCan(actor, 'asset.inspect', { projectId: asset.projectId });
  if (asset.status !== 'ACTIVE') throw new DomainError('INVALID_STATE', 'ทรัพย์สินนี้ปลดระวางแล้ว', 409);
  const { location, ...inspection } = data;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(assetInspections)
      .values({
        ...inspection,
        assetId,
        inspectedBy: actor.id,
        latitude: location?.latitude.toFixed(6),
        longitude: location?.longitude.toFixed(6),
        locationAccuracyM: location && Math.round(location.accuracyMeters),
      })
      .returning();
    await logActivity(tx, { entityType: 'ASSET', entityId: assetId, action: `INSPECT_${data.result}`, userId: actor.id, note: data.note || undefined });
    return { id: row!.id };
  });
}

export interface AssetCheckInput {
  result: InspectionResult;
  note?: string;
  location: CheckLocation;
  photo: File | null;
}

/**
 * The on-site check: a photo, a confirmed location and a result, saved together or not at all.
 * The date is the server's, because the photo and location vouch for today and no other day.
 */
export async function confirmAssetCheck(db: Db, actor: SessionUser, assetId: string, input: AssetCheckInput): Promise<{ id: string }> {
  if (!input.photo || input.photo.size === 0) throw new DomainError('INVALID_ASSET', 'กรุณาถ่ายรูปยืนยันทรัพย์สิน');
  const location = parse(locationSchema, input.location);
  const photo = input.photo;
  return db.transaction(async (tx) => {
    const { id } = await recordInspection(tx, actor, assetId, { inspectedOn: bangkokDateString(), result: input.result, note: input.note, location });
    await addAttachment(tx, actor, { entityType: 'ASSET_INSPECTION', entityId: id, file: photo, kind: 'PHOTO' });
    return { id };
  });
}

const SITE_INSPECTOR_ROLES = ['FOREMAN', 'ENGINEER', 'PM'] as const;

/**
 * Tells everyone who may check an asset that it needs checking, once per due period.
 * Each person gets a single message however many assets came due. Safe to run at any time:
 * claiming the assets inside the transaction keeps concurrent runs from announcing one twice.
 */
export async function notifyAssetsDue(db: Db, today = bangkokDateString()): Promise<number> {
  const active = await db.select().from(assets).where(eq(assets.status, 'ACTIVE'));
  const latestByAsset = await latestInspections(db, active.map((a) => a.id));
  const due = active.flatMap((asset) => {
    const nextDueOn = nextInspectionDate(latestByAsset.get(asset.id)?.inspectedOn ?? null, asset.inspectEveryDays);
    const state = inspectionDue(asset.status, nextDueOn, today);
    const key = dueNoticeKey(state, nextDueOn);
    return needsInspection(state) && asset.dueNotifiedFor !== key ? [{ asset, state, key }] : [];
  });
  if (due.length === 0) return 0;

  return db.transaction(async (tx) => {
    const announcedTo = new Map<string, typeof due>();
    let announced = 0;
    for (const item of due) {
      const { id, projectId } = item.asset;
      const claimed = await tx
        .update(assets)
        .set({ dueNotifiedFor: item.key })
        .where(and(eq(assets.id, id), or(isNull(assets.dueNotifiedFor), ne(assets.dueNotifiedFor, item.key))))
        .returning();
      if (claimed.length === 0) continue;
      announced += 1;
      const roles = projectId ? [...ASSET_OFFICE_ROLES, ...SITE_INSPECTOR_ROLES] : ASSET_OFFICE_ROLES;
      for (const userId of await usersWithRole(tx, roles, projectId)) {
        announcedTo.set(userId, [...(announcedTo.get(userId) ?? []), item]);
      }
    }
    for (const [userId, items] of announcedTo) {
      const [only] = items;
      await notify(
        tx,
        [userId],
        items.length === 1 && only
          ? { title: `${only.asset.code} ${only.asset.name}: ${INSPECTION_DUE_LABELS[only.state]}`, href: `/assets?asset=${only.asset.id}` }
          : { title: `ทรัพย์สิน ${items.length} รายการต้องตรวจเช็ค`, href: '/assets?view=NEEDS_CHECK' },
      );
    }
    return announced;
  });
}

let lastDueCheckOn: string | null = null;

/** There is no scheduler, so the first page opened each day runs the check. A failure must not take the page down. */
export async function checkAssetsDueOncePerDay(db: Db): Promise<void> {
  const today = bangkokDateString();
  if (lastDueCheckOn === today) return;
  lastDueCheckOn = today;
  try {
    await notifyAssetsDue(db, today);
  } catch (err) {
    console.error('Could not send the asset inspection reminders', err);
  }
}

export interface InspectionRow {
  id: string;
  inspectedOn: string;
  result: InspectionResult;
  note: string;
  inspectorName: string;
  location: CheckLocation | null;
  photos: { id: string; url: string; name: string }[];
}

/** Newest first, with the photos taken at each check. */
export async function listInspections(db: Db, actor: SessionUser, assetId: string): Promise<InspectionRow[]> {
  await loadVisibleAsset(db, actor, assetId);
  const rows = await db
    .select({ i: assetInspections, inspectorName: users.name })
    .from(assetInspections)
    .innerJoin(users, eq(users.id, assetInspections.inspectedBy))
    .where(eq(assetInspections.assetId, assetId))
    .orderBy(desc(assetInspections.inspectedOn), desc(assetInspections.createdAt));
  const photos = rows.length
    ? await db
        .select({ id: attachments.id, entityId: attachments.entityId, url: attachments.url, name: attachments.name })
        .from(attachments)
        .where(and(eq(attachments.entityType, 'ASSET_INSPECTION'), inArray(attachments.entityId, rows.map((r) => r.i.id))))
        .orderBy(asc(attachments.createdAt))
    : [];
  return rows.map(({ i, inspectorName }) => ({
    id: i.id,
    inspectedOn: i.inspectedOn,
    result: i.result,
    note: i.note,
    inspectorName,
    location: i.latitude && i.longitude ? { latitude: Number(i.latitude), longitude: Number(i.longitude), accuracyMeters: i.locationAccuracyM ?? 0 } : null,
    photos: photos.filter((p) => p.entityId === i.id).map(({ id, url, name }) => ({ id, url, name })),
  }));
}
