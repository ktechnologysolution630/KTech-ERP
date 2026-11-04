import { eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { assets, items, projects, vendors, type SessionUser, type VendorType } from '@/db/schema';
import { ASSET_IMPORT_COLUMNS, parseImportDate } from '@/domain/asset';
import { DomainError } from '@/domain/errors';
import { parseDecimalInput } from '@/domain/money';
import { assertCan } from '@/server/policy';
import { createAsset } from './assets';
import { upsertItem, upsertVendor } from './master';

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
      const purchaseDate = text(columns.purchaseDate) ? parseImportDate(text(columns.purchaseDate)) : null;
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
