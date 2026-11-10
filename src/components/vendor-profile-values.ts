import type { vendors, VendorBankAccount, VendorContact } from '@/db/schema';
import type { CreditBasis, PayMethod } from '@/domain/payment-terms';

/** Everything the supplier form edits */
export interface VendorProfileValues {
  code: string;
  name: string;
  tradeName: string;
  suppliedItems: string;
  website: string;
  lineId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  remark: string;
  address: string;
  building: string;
  moo: string;
  soi: string;
  road: string;
  subdistrict: string;
  district: string;
  province: string;
  postcode: string;
  country: string;
  contacts: VendorContact[];
  type: 'COMPANY' | 'INDIVIDUAL';
  taxId: string;
  branchType: 'HQ' | 'BRANCH';
  branch: string;
  vatRegistered: boolean;
  defaultVatRate: number;
  whtIncomeType: string;
  defaultWhtRate: number;
  taxInvoiceName: string;
  category: '' | 'GOODS' | 'SERVICE' | 'SUBCONTRACTOR' | 'MANUFACTURER' | 'DISTRIBUTOR';
  productCategory: string;
  brand: string;
  leadTimeDays: string;
  minOrderQty: string;
  minOrderValue: string;
  defaultDiscount: string;
  currency: string;
  vatMode: 'EXCLUSIVE' | 'INCLUSIVE' | 'NONE';
  deliveryTerms: string;
  serviceArea: string;
  recommended: boolean;
  defaultPayMethod: PayMethod;
  defaultCreditDays: string;
  paymentTerms: string;
  billingSchedule: string;
  creditBasis: CreditBasis;
  chequeSchedule: string;
  creditLimit: string;
  depositRequired: boolean;
  depositPercent: string;
  bankAccounts: VendorBankAccount[];
}

export const emptyContact = (primary = false): VendorContact => ({
  kind: '',
  name: '',
  position: '',
  department: '',
  phone: '',
  mobile: '',
  email: '',
  lineId: '',
  primary,
  receivesPo: primary,
  receivesAccounting: false,
});

export const emptyBankAccount = (primary = false): VendorBankAccount => ({
  bank: '',
  branch: '',
  accountName: '',
  accountNo: '',
  accountType: 'ออมทรัพย์',
  promptPay: '',
  primary,
});

export const emptyVendorProfile = (): VendorProfileValues => ({
  code: '',
  name: '',
  tradeName: '',
  suppliedItems: '',
  website: '',
  lineId: '',
  status: 'ACTIVE',
  remark: '',
  address: '',
  building: '',
  moo: '',
  soi: '',
  road: '',
  subdistrict: '',
  district: '',
  province: '',
  postcode: '',
  country: 'ไทย',
  contacts: [emptyContact(true)],
  type: 'COMPANY',
  taxId: '',
  branchType: 'HQ',
  branch: '00000',
  vatRegistered: true,
  defaultVatRate: 7,
  whtIncomeType: '',
  defaultWhtRate: 0,
  taxInvoiceName: '',
  category: '',
  productCategory: '',
  brand: '',
  leadTimeDays: '',
  minOrderQty: '',
  minOrderValue: '',
  defaultDiscount: '',
  currency: 'THB',
  vatMode: 'EXCLUSIVE',
  deliveryTerms: '',
  serviceArea: '',
  recommended: false,
  defaultPayMethod: 'TRANSFER',
  defaultCreditDays: '30',
  paymentTerms: '',
  billingSchedule: '',
  creditBasis: 'BILLING',
  chequeSchedule: '',
  creditLimit: '',
  depositRequired: false,
  depositPercent: '',
  bankAccounts: [emptyBankAccount(true)],
});


const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(Number(v)));

/** A stored supplier as the profile form edits it */
export function vendorProfileValuesOf(v: typeof vendors.$inferSelect): VendorProfileValues {
  return {
    code: v.code,
    name: v.name,
    tradeName: v.tradeName,
    suppliedItems: v.suppliedItems,
    website: v.website,
    lineId: v.lineId,
    status: v.status,
    remark: v.remark,
    address: v.address,
    building: v.building,
    moo: v.moo,
    soi: v.soi,
    road: v.road,
    subdistrict: v.subdistrict,
    district: v.district,
    province: v.province,
    postcode: v.postcode,
    country: v.country,
    contacts: v.contacts.length > 0 ? v.contacts : [{ ...emptyContact(true), name: v.contactPerson, phone: v.phone, email: v.email }],
    type: v.type,
    taxId: v.taxId ?? '',
    branchType: v.branchType,
    branch: v.branch,
    vatRegistered: v.vatRegistered,
    defaultVatRate: v.defaultVatRate,
    whtIncomeType: v.whtIncomeType,
    defaultWhtRate: v.defaultWhtRate,
    taxInvoiceName: v.taxInvoiceName,
    category: v.category,
    productCategory: v.productCategory,
    brand: v.brand,
    leadTimeDays: v.leadTimeDays === null ? '' : String(v.leadTimeDays),
    minOrderQty: str(v.minOrderQty),
    minOrderValue: str(v.minOrderValue),
    defaultDiscount: str(v.defaultDiscount),
    currency: v.currency,
    vatMode: v.vatMode,
    deliveryTerms: v.deliveryTerms,
    serviceArea: v.serviceArea,
    recommended: v.recommended,
    defaultPayMethod: v.defaultPayMethod,
    defaultCreditDays: String(v.defaultCreditDays),
    paymentTerms: v.paymentTerms,
    billingSchedule: v.billingSchedule,
    creditBasis: v.creditBasis,
    chequeSchedule: v.chequeSchedule,
    creditLimit: str(v.creditLimit),
    depositRequired: v.depositRequired,
    depositPercent: str(v.depositPercent),
    bankAccounts:
      v.bankAccounts.length > 0
        ? v.bankAccounts
        : [{ ...emptyBankAccount(true), bank: v.bankName, accountNo: v.bankAccountNo, accountName: v.bankAccountName }],
  };
}
