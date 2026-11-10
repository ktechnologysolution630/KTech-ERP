import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  date,
  primaryKey,
  jsonb,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { type ProjectStatus } from '@/domain/project';
import { type CreditBasis, type PayMethod } from '@/domain/payment-terms';
import { users } from './core';

export type VendorType = 'INDIVIDUAL' | 'COMPANY';
export type VendorStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type VendorCategory = 'GOODS' | 'SERVICE' | 'SUBCONTRACTOR' | 'MANUFACTURER' | 'DISTRIBUTOR';

/** One person to reach at a vendor */
export interface VendorContact {
  kind: '' | 'PO' | 'SALES' | 'ACCOUNTING' | 'GENERAL' | 'SIGNATORY';
  name: string;
  position: string;
  department: string;
  phone: string;
  mobile: string;
  email: string;
  lineId: string;
  primary: boolean;
  receivesPo: boolean;
  receivesAccounting: boolean;
}

/** One bank account a vendor is paid into; the primary one also fills bankName / bankAccountNo */
export interface VendorBankAccount {
  bank: string;
  branch: string;
  accountName: string;
  accountNo: string;
  accountType: string;
  promptPay: string;
  primary: boolean;
}

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    active: boolean('active').default(true).notNull(),
    status: text('status').$type<ProjectStatus>().default('IN_PROGRESS').notNull(),
    clientName: text('client_name').default('').notNull(),
    projectGroup: text('project_group').default('').notNull(),
    contactName: text('contact_name').default('').notNull(),
    contactPhone: text('contact_phone').default('').notNull(),
    location: text('location').default('').notNull(),
    budget: numeric('budget', { precision: 16, scale: 2 }).default('0.00').notNull(),
    startDate: date('start_date'),
    endDate: date('end_date'),
    pmUserId: uuid('pm_user_id').references((): AnyPgColumn => users.id),
    coverImageUrl: text('cover_image_url').default('').notNull(),
    // Billing customer (ลูกค้า); clientName stays as the free-text display name
    customerId: uuid('customer_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('projects_code_idx').on(t.code)],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<VendorType>().default('COMPANY').notNull(),
    taxId: text('tax_id'),
    branch: text('branch').default('00000').notNull(),
    address: text('address').default('').notNull(),
    phone: text('phone').default('').notNull(),
    bankName: text('bank_name').default('').notNull(),
    bankAccountNo: text('bank_account_no').default('').notNull(),
    bankAccountName: text('bank_account_name').default('').notNull(),
    defaultCreditDays: integer('default_credit_days').default(30).notNull(),
    defaultWhtRate: integer('default_wht_rate').default(0).notNull(),
    /** Billing day schedule ('' any day, 'M:25', 'W:2'); see domain/payment-terms */
    billingSchedule: text('billing_schedule').default('').notNull(),
    creditBasis: text('credit_basis').$type<CreditBasis>().default('BILLING').notNull(),
    /** Cheque hand-over schedule, same format as billingSchedule */
    chequeSchedule: text('cheque_schedule').default('').notNull(),
    defaultPayMethod: text('default_pay_method').$type<PayMethod>().default('TRANSFER').notNull(),
    /** What this vendor sells, in the buyer's own words; not tied to the item list */
    suppliedItems: text('supplied_items').default('').notNull(),
    contactPerson: text('contact_person').default('').notNull(),
    altAddress: text('alt_address').default('').notNull(),
    email: text('email').default('').notNull(),
    fax: text('fax').default('').notNull(),
    // ---- General
    tradeName: text('trade_name').default('').notNull(),
    website: text('website').default('').notNull(),
    lineId: text('line_id').default('').notNull(),
    status: text('status').$type<VendorStatus>().default('ACTIVE').notNull(),
    remark: text('remark').default('').notNull(),
    // ---- Structured address (address keeps the house number / first line)
    building: text('building').default('').notNull(),
    moo: text('moo').default('').notNull(),
    soi: text('soi').default('').notNull(),
    road: text('road').default('').notNull(),
    subdistrict: text('subdistrict').default('').notNull(),
    district: text('district').default('').notNull(),
    province: text('province').default('').notNull(),
    postcode: text('postcode').default('').notNull(),
    country: text('country').default('ไทย').notNull(),
    contacts: jsonb('contacts').$type<VendorContact[]>().default([]).notNull(),
    // ---- Tax
    branchType: text('branch_type').$type<'HQ' | 'BRANCH'>().default('HQ').notNull(),
    vatRegistered: boolean('vat_registered').default(true).notNull(),
    defaultVatRate: integer('default_vat_rate').default(7).notNull(),
    whtIncomeType: text('wht_income_type').default('').notNull(),
    taxInvoiceName: text('tax_invoice_name').default('').notNull(),
    // ---- Purchasing terms (defaults for a new PO)
    category: text('category').$type<VendorCategory | ''>().default('').notNull(),
    productCategory: text('product_category').default('').notNull(),
    brand: text('brand').default('').notNull(),
    leadTimeDays: integer('lead_time_days'),
    minOrderQty: numeric('min_order_qty', { precision: 14, scale: 3 }),
    minOrderValue: numeric('min_order_value', { precision: 14, scale: 2 }),
    defaultDiscount: numeric('default_discount', { precision: 14, scale: 2 }),
    currency: text('currency').default('THB').notNull(),
    vatMode: text('vat_mode').$type<'EXCLUSIVE' | 'INCLUSIVE' | 'NONE'>().default('EXCLUSIVE').notNull(),
    deliveryTerms: text('delivery_terms').default('').notNull(),
    serviceArea: text('service_area').default('').notNull(),
    recommended: boolean('recommended').default(false).notNull(),
    // ---- Payment
    paymentTerms: text('payment_terms').default('').notNull(),
    creditLimit: numeric('credit_limit', { precision: 14, scale: 2 }),
    depositRequired: boolean('deposit_required').default(false).notNull(),
    depositPercent: numeric('deposit_percent', { precision: 5, scale: 2 }),
    bankAccounts: jsonb('bank_accounts').$type<VendorBankAccount[]>().default([]).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('vendors_code_idx').on(t.code)],
);

export const units = pgTable(
  'units',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('units_name_idx').on(t.name)],
);

export const items = pgTable(
  'items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    category: text('category'),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('items_code_idx').on(t.code)],
);
