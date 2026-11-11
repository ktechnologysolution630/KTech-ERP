'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { vendors } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { requireWriter } from '@/server/auth/current-user';
import { assertCan } from '@/server/policy';
import { upsertVendor } from '@/server/services/master';
import { updateVendor } from '@/server/services/vendor-detail';
import type { VendorProfileValues } from '@/components/vendor-profile-values';

const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());

/** Form values as the vendor service takes them */
function toVendorInput(v: VendorProfileValues) {
  const credit = Number(v.defaultCreditDays);
  const lead = v.leadTimeDays.trim() === '' ? null : Number(v.leadTimeDays);
  return {
    name: v.name,
    type: v.type,
    taxId: v.taxId.trim() || null,
    branch: v.branchType === 'HQ' ? '00000' : v.branch.trim() || '00000',
    address: v.address,
    phone: '',
    bankName: '',
    bankAccountNo: '',
    bankAccountName: '',
    defaultCreditDays: Number.isInteger(credit) && credit >= 0 ? credit : 0,
    defaultWhtRate: v.defaultWhtRate,
    suppliedItems: v.suppliedItems,
    billingSchedule: v.billingSchedule,
    creditBasis: v.creditBasis,
    chequeSchedule: v.chequeSchedule,
    defaultPayMethod: v.defaultPayMethod,
    tradeName: v.tradeName,
    website: v.website,
    lineId: v.lineId,
    status: v.status,
    remark: v.remark,
    building: v.building,
    moo: v.moo,
    soi: v.soi,
    road: v.road,
    subdistrict: v.subdistrict,
    district: v.district,
    province: v.province,
    postcode: v.postcode,
    country: v.country,
    // Rows left completely blank are dropped
    contacts: v.contacts.filter((c) => c.name || c.phone || c.mobile || c.email || c.lineId),
    branchType: v.branchType,
    vatRegistered: v.vatRegistered,
    defaultVatRate: v.defaultVatRate,
    whtIncomeType: v.whtIncomeType,
    taxInvoiceName: v.taxInvoiceName,
    category: v.category,
    productCategory: v.productCategory,
    brand: v.brand,
    leadTimeDays: lead !== null && Number.isInteger(lead) && lead >= 0 ? lead : null,
    minOrderQty: blankToNull(v.minOrderQty),
    minOrderValue: blankToNull(v.minOrderValue),
    defaultDiscount: blankToNull(v.defaultDiscount),
    currency: v.currency,
    vatMode: v.vatMode,
    deliveryTerms: v.deliveryTerms,
    serviceArea: v.serviceArea,
    recommended: v.recommended,
    paymentTerms: v.paymentTerms,
    creditLimit: blankToNull(v.creditLimit),
    depositRequired: v.depositRequired,
    depositPercent: v.depositRequired ? blankToNull(v.depositPercent) : null,
    bankAccounts: v.bankAccounts.filter((b) => b.bank || b.accountNo || b.accountName || b.promptPay),
  };
}

/** Adds a supplier (id null) or saves the whole profile of one */
export async function saveVendorProfileAction(
  id: string | null,
  values: VendorProfileValues,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireWriter();
  const db = await getDb();
  try {
    let savedId: string;
    if (id) {
      const saved = await updateVendor(db, actor, id, toVendorInput(values));
      savedId = saved!.id;
    } else {
      assertCan(actor, 'master.manage');
      const code = values.code.trim();
      // Adding must not quietly overwrite another supplier with the same code
      const [taken] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.code, code)).limit(1);
      if (taken) throw new DomainError('DUPLICATE_CODE', `รหัสซัพพลายเออร์ ${code} มีอยู่แล้ว`, 409);
      const saved = await upsertVendor(db, actor, { ...toVendorInput(values), code, active: values.status === 'ACTIVE' });
      savedId = saved!.id;
    }
    revalidatePath('/purchasing/vendors');
    revalidatePath(`/purchasing/vendors/${savedId}`);
    revalidatePath('/po/new');
    return { ok: true, id: savedId };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}
