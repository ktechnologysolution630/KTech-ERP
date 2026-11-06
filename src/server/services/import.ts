import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { assets, items, projects, vendors, type SessionUser, type VendorType } from '@/db/schema';
import { ASSET_IMPORT_COLUMNS } from '@/domain/asset';
import { DomainError } from '@/domain/errors';
import { UNKNOWN_UNIT, type ItemImportRow, type VendorImportRow } from '@/domain/master-import';
import { parseDecimalInput } from '@/domain/money';
import { parseDateText } from '@/domain/thai';
import { assertCan } from '@/server/policy';
import { createAsset } from './assets';
import { upsertItem, upsertVendor } from './master';
import { nextDocNumber } from './numbering';

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

const ASSET_IMPORT_LIMIT = 1000;

/**
 * Adds new assets; rows that fail are reported and the rest still go in. Asset codes are issued by the
 * system, so the serial number is what stops the same file being imported twice.
 */
export async function importAssets(db: Db, actor: SessionUser, rows: Record<string, string>[]): Promise<ImportResult> {
  assertCan(actor, 'asset.manage');
  const result: ImportResult = { created: 0, updated: 0, errors: [] };
  if (rows.length > ASSET_IMPORT_LIMIT) {
    result.errors.push({ row: 1, message: `นำเข้าได้ครั้งละไม่เกิน ${ASSET_IMPORT_LIMIT} แถว กรุณาแบ่งไฟล์แล้วลองใหม่` });
    return result;
  }

  const projectRows = await db.select({ id: projects.id, code: projects.code }).from(projects);
  const projectByCode = new Map(projectRows.map((p) => [p.code.toLowerCase(), p.id]));
  const existing = await db.select({ serialNo: assets.serialNo }).from(assets);
  const serials = new Set(existing.map((a) => a.serialNo.toLowerCase()).filter(Boolean));

  const columns = ASSET_IMPORT_COLUMNS;
  for (const [i, r] of rows.entries()) {
    const text = (header: string) => (r[header] ?? '').trim();
    if (Object.values(columns).every((header) => !text(header))) continue;
    // The header is row 1 of the sheet, so this is the number people see in their file
    const rowNo = i + 2;
    const amount = (header: string): number | undefined => {
      if (!text(header)) return undefined;
      const value = parseDecimalInput(text(header));
      if (!value) throw new DomainError('INVALID_ASSET', `${header}ต้องเป็นตัวเลข`);
      return value.toNumber();
    };
    try {
      const projectCode = text(columns.projectCode);
      const projectId = projectCode ? projectByCode.get(projectCode.toLowerCase()) : null;
      if (projectId === undefined) throw new DomainError('INVALID_ASSET', `ไม่พบรหัสโครงการ ${projectCode}`);
      const purchaseDate = text(columns.purchaseDate) ? parseDateText(text(columns.purchaseDate)) : null;
      if (text(columns.purchaseDate) && !purchaseDate) throw new DomainError('INVALID_ASSET', `${columns.purchaseDate}ไม่ถูกต้อง ใช้รูปแบบ 2026-11-04 หรือ 4/11/2026`);
      const serialNo = text(columns.serialNo);
      if (serialNo && serials.has(serialNo.toLowerCase())) throw new DomainError('INVALID_ASSET', `หมายเลข ${serialNo} มีอยู่แล้ว`);

      await createAsset(db, actor, {
        name: text(columns.name),
        category: text(columns.category),
        serialNo,
        projectId,
        custodian: text(columns.custodian),
        purchaseDate,
        purchaseValue: amount(columns.purchaseValue),
        salvageValue: amount(columns.salvageValue),
        usefulLifeYears: amount(columns.usefulLifeYears) ?? null,
        inspectEveryDays: amount(columns.inspectEveryDays),
        note: text(columns.note),
      });
      if (serialNo) serials.add(serialNo.toLowerCase());
      result.created += 1;
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      result.errors.push({ row: rowNo, message: err.message });
    }
  }
  return result;
}

function parseVendorType(raw: string | undefined): VendorType {
  if (!raw) return 'COMPANY';
  const v = raw.trim();
  if (v === 'บุคคล' || v === 'บุคคลธรรมดา' || v.toUpperCase() === 'INDIVIDUAL') {
    return 'INDIVIDUAL';
  }
  return 'COMPANY';
}

export async function importVendors(
  db: Db,
  actor: SessionUser,
  rows: Record<string, string>[],
): Promise<ImportResult> {
  assertCan(actor, 'master.manage');
  let created = 0;
  let updated = 0;
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;
    try {
      const code = (r['รหัส'] ?? r['code'] ?? '').trim();
      const name = (r['ชื่อ'] ?? r['name'] ?? '').trim();
      const type = parseVendorType(r['ประเภท'] ?? r['type']);
      const taxIdRaw = (r['เลขผู้เสียภาษี'] ?? r['taxId'] ?? '').trim();
      const branchRaw = (r['สาขา'] ?? r['branch'] ?? '').trim() || '00000';
      const address = (r['ที่อยู่'] ?? r['address'] ?? '').trim();
      const phone = (r['โทร'] ?? r['phone'] ?? '').trim();
      const bankName = (r['ธนาคาร'] ?? r['bankName'] ?? '').trim();
      const bankAccountNo = (r['เลขบัญชี'] ?? r['bankAccountNo'] ?? '').trim();
      const bankAccountName = (r['ชื่อบัญชี'] ?? r['bankAccountName'] ?? '').trim();
      const creditDaysStr = (r['เครดิต(วัน)'] ?? r['defaultCreditDays'] ?? '').trim();
      const whtRateStr = (r['หัก ณ ที่จ่าย(%)'] ?? r['defaultWhtRate'] ?? '').trim();

      const existing = code
        ? await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.code, code)).limit(1)
        : [];

      await upsertVendor(db, actor, {
        code,
        name,
        type,
        taxId: taxIdRaw || null,
        branch: branchRaw,
        address,
        phone,
        bankName,
        bankAccountNo,
        bankAccountName,
        defaultCreditDays: creditDaysStr ? Number(creditDaysStr) : 30,
        defaultWhtRate: whtRateStr ? Number(whtRateStr) : 0,
        active: true,
      });

      if (existing.length > 0) updated += 1;
      else created += 1;
    } catch (err) {
      errors.push({
        row: rowNo,
        message: err instanceof Error ? err.message : 'ข้อมูลไม่ถูกต้อง',
      });
    }
  }

  return { created, updated, errors };
}

export interface DirectoryImportResult {
  created: number;
  /** Already in the system and given details it lacked */
  updated: number;
  /** Already in the system with nothing to add */
  unchanged: number;
  errors: { row: number; message: string }[];
}

const DIRECTORY_IMPORT_LIMIT = 5000;

const vendorRowSchema = z.array(
  z.object({
    name: z.string().trim().min(1).max(300),
    type: z.enum(['COMPANY', 'INDIVIDUAL']),
    taxId: z.string().regex(/^\d{13}$/).nullable(),
    branch: z.string().regex(/^\d{5}$/),
    address: z.string().max(500),
    phone: z.string().max(200),
  }),
).max(DIRECTORY_IMPORT_LIMIT);

const itemRowSchema = z.array(
  z.object({
    code: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(300),
    unitName: z.string().trim().min(1).max(50).nullable(),
  }),
).max(DIRECTORY_IMPORT_LIMIT);

const parseRows = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, rows: unknown): T => {
  const parsed = schema.safeParse(rows);
  if (!parsed.success) throw new DomainError('INVALID_IMPORT', 'ข้อมูลที่นำเข้าไม่ถูกต้อง');
  return parsed.data;
};

/**
 * Adds vendors from a list that has no vendor codes, so the system issues them. A vendor already here, by tax id
 * and branch or else by name, only has blanks filled in: credit terms and bank details people set are never replaced.
 * Rows that fail are reported and the rest still go in, so the same file can safely be imported again.
 */
export async function importVendorDirectory(db: Db, actor: SessionUser, rows: VendorImportRow[]): Promise<DirectoryImportResult> {
  assertCan(actor, 'master.manage');
  const parsed = parseRows(vendorRowSchema, rows);
  const existing = await db.select().from(vendors);
  const byTaxId = new Map(existing.filter((v) => v.taxId).map((v) => [`${v.taxId}|${v.branch}`, v]));
  const byName = new Map(existing.map((v) => [v.name.trim(), v]));
  const result: DirectoryImportResult = { created: 0, updated: 0, unchanged: 0, errors: [] };

  for (const [i, row] of parsed.entries()) {
    try {
      const found = (row.taxId && byTaxId.get(`${row.taxId}|${row.branch}`)) || byName.get(row.name);
      if (!found) {
        const saved = await upsertVendor(db, actor, { ...row, code: await nextDocNumber(db, 'V'), bankName: '', bankAccountNo: '', bankAccountName: '', defaultCreditDays: 30, defaultWhtRate: 0, active: true });
        // The same vendor may appear again further down the list
        if (saved.taxId) byTaxId.set(`${saved.taxId}|${saved.branch}`, saved);
        byName.set(saved.name.trim(), saved);
        result.created += 1;
        continue;
      }
      const blanks = {
        ...(!found.taxId && row.taxId ? { taxId: row.taxId, branch: row.branch } : {}),
        ...(!found.address && row.address ? { address: row.address } : {}),
        ...(!found.phone && row.phone ? { phone: row.phone } : {}),
      };
      if (Object.keys(blanks).length === 0) {
        result.unchanged += 1;
        continue;
      }
      await db.update(vendors).set({ ...blanks, updatedAt: new Date() }).where(eq(vendors.id, found.id));
      result.updated += 1;
    } catch (err) {
      result.errors.push({ row: i + 1, message: err instanceof DomainError ? `${row.name}: ${err.message}` : `${row.name}: บันทึกไม่สำเร็จ` });
      if (!(err instanceof DomainError)) console.error('Could not import a vendor', err);
    }
  }
  return result;
}

/** Adds items that are not here yet. Items already here keep what people have set, including their unit. */
export async function importItemCatalog(db: Db, actor: SessionUser, rows: ItemImportRow[]): Promise<DirectoryImportResult> {
  assertCan(actor, 'master.manage');
  const parsed = parseRows(itemRowSchema, rows);
  const known = new Set((await db.select({ code: items.code }).from(items)).map((i) => i.code));
  const result: DirectoryImportResult = { created: 0, updated: 0, unchanged: 0, errors: [] };

  for (const [i, row] of parsed.entries()) {
    if (known.has(row.code)) {
      result.unchanged += 1;
      continue;
    }
    try {
      await upsertItem(db, actor, { code: row.code, name: row.name, unitName: row.unitName ?? UNKNOWN_UNIT, active: true });
      known.add(row.code);
      result.created += 1;
    } catch (err) {
      result.errors.push({ row: i + 1, message: err instanceof DomainError ? `${row.code}: ${err.message}` : `${row.code}: บันทึกไม่สำเร็จ` });
      if (!(err instanceof DomainError)) console.error('Could not import an item', err);
    }
  }
  return result;
}

export async function importItems(
  db: Db,
  actor: SessionUser,
  rows: Record<string, string>[],
): Promise<ImportResult> {
  assertCan(actor, 'master.manage');
  let created = 0;
  let updated = 0;
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;
    try {
      const code = (r['รหัส'] ?? r['code'] ?? '').trim();
      const name = (r['ชื่อ'] ?? r['name'] ?? '').trim();
      const unitName = (r['หน่วย'] ?? r['unit'] ?? '').trim();
      const category = (r['หมวด'] ?? r['category'] ?? '').trim() || null;

      const existing = code
        ? await db.select({ id: items.id }).from(items).where(eq(items.code, code)).limit(1)
        : [];

      await upsertItem(db, actor, {
        code,
        name,
        unitName,
        category,
        active: true,
      });

      if (existing.length > 0) updated += 1;
      else created += 1;
    } catch (err) {
      errors.push({
        row: rowNo,
        message: err instanceof Error ? err.message : 'ข้อมูลไม่ถูกต้อง',
      });
    }
  }

  return { created, updated, errors };
}
