import { eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { items, vendors, type SessionUser, type VendorType } from '@/db/schema';
import { assertCan } from '@/server/policy';
import { upsertItem, upsertVendor } from './master';

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
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
