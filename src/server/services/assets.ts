import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { assetInspections, assets, attachments, projects, users, type SessionUser } from '@/db/schema';
import {
  ASSET_STATUSES,
  DEFAULT_INSPECT_EVERY_DAYS,
  INSPECTION_RESULTS,
  inspectionDue,
  nextInspectionDate,
  type AssetStatus,
  type InspectionDue,
  type InspectionResult,
} from '@/domain/asset';
import { DomainError } from '@/domain/errors';
import { bangkokDateString } from '@/domain/thai';
import { assertCan, can, isSiteScopedOnly } from '@/server/policy';
import { logActivity } from './activity';
import { nextDocNumber } from './numbering';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');

const assetSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาระบุชื่อทรัพย์สิน').max(300),
  category: z.string().trim().max(100).default(''),
  serialNo: z.string().trim().max(100).default(''),
  projectId: z.string().uuid().nullable().default(null),
  custodian: z.string().trim().max(200).default(''),
  purchaseDate: isoDate.nullable().default(null),
  purchaseValue: z.coerce.number().min(0, 'มูลค่าต้องไม่ติดลบ').max(99_999_999_999).default(0),
  inspectEveryDays: z.coerce.number().int('รอบการตรวจต้องเป็นจำนวนวันเต็ม').min(1, 'รอบการตรวจต้องอย่างน้อย 1 วัน').max(3650, 'รอบการตรวจต้องไม่เกิน 3650 วัน').default(DEFAULT_INSPECT_EVERY_DAYS),
  status: z.enum(ASSET_STATUSES).default('ACTIVE'),
  note: z.string().trim().max(1000).default(''),
});

export type AssetInput = z.input<typeof assetSchema>;

const inspectionSchema = z
  .object({
    inspectedOn: isoDate,
    result: z.enum(INSPECTION_RESULTS),
    note: z.string().trim().max(1000).default(''),
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
  today: string;
}

/** Everything the user may see, with each asset's latest inspection. */
export async function listAssets(db: Db, actor: SessionUser): Promise<AssetPage> {
  const siteOnly = isSiteScopedOnly(actor);
  const today = bangkokDateString();
  if (siteOnly && actor.projectIds.length === 0) return { rows: [], canManage: false, today };

  const rows = await db
    .select({ asset: assets, projectName: projects.name })
    .from(assets)
    .leftJoin(projects, eq(projects.id, assets.projectId))
    .where(siteOnly ? inArray(assets.projectId, actor.projectIds) : undefined)
    .orderBy(asc(assets.code));
  const latest = rows.length
    ? await db
        .selectDistinctOn([assetInspections.assetId], {
          assetId: assetInspections.assetId,
          inspectedOn: assetInspections.inspectedOn,
          result: assetInspections.result,
        })
        .from(assetInspections)
        .where(inArray(assetInspections.assetId, rows.map((r) => r.asset.id)))
        .orderBy(assetInspections.assetId, desc(assetInspections.inspectedOn), desc(assetInspections.createdAt))
    : [];
  const latestByAsset = new Map(latest.map((l) => [l.assetId, l]));

  return {
    today,
    canManage: can(actor, 'asset.manage'),
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
      .values({ ...data, code, purchaseValue: data.purchaseValue.toFixed(2), createdBy: actor.id })
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
      .set({ ...data, purchaseValue: data.purchaseValue.toFixed(2), updatedAt: new Date() })
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
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(assetInspections).values({ ...data, assetId, inspectedBy: actor.id }).returning();
    await logActivity(tx, { entityType: 'ASSET', entityId: assetId, action: `INSPECT_${data.result}`, userId: actor.id, note: data.note || undefined });
    return { id: row!.id };
  });
}

export interface InspectionRow {
  id: string;
  inspectedOn: string;
  result: InspectionResult;
  note: string;
  inspectorName: string;
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
    photos: photos.filter((p) => p.entityId === i.id).map(({ id, url, name }) => ({ id, url, name })),
  }));
}
