import { pgTable, uuid, text, timestamp, numeric, date, boolean, integer, index } from 'drizzle-orm/pg-core';
import { users } from './core';
import { projects, vendors } from './master';

import { customers } from './ar';
import type { SalesDocKind, SalesVatMode } from '@/domain/sales-doc';

/**
 * Sales documents outside milestone billing: ใบเสนอราคา, ใบเสร็จรับเงิน, ใบกำกับภาษี, ใบเพิ่มหนี้ and
 * ใบกำกับภาษีอย่างย่อ. The customer is copied onto the document, so later edits to the customer
 * do not change what was issued.
 */
export type CompanyAccountType = 'SAVINGS' | 'CURRENT' | 'FIXED' | 'CASH' | 'OTHER';

/** The company's own bank and cash accounts, with the balance they started from */
export const companyAccounts = pgTable('company_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  bank: text('bank').notNull(),
  accountName: text('account_name').notNull(),
  accountNo: text('account_no').notNull(),
  branch: text('branch').default('').notNull(),
  type: text('type').$type<CompanyAccountType>().default('SAVINGS').notNull(),
  currency: text('currency').default('THB').notNull(),
  openingBalance: numeric('opening_balance', { precision: 14, scale: 2 }).default('0').notNull(),
  openingDate: date('opening_date'),
  ownerName: text('owner_name').default('').notNull(),
  isDefaultReceive: boolean('is_default_receive').default(false).notNull(),
  isDefaultPay: boolean('is_default_pay').default(false).notNull(),
  active: boolean('active').default(true).notNull(),
  notes: text('notes').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const salesDocs = pgTable(
  'sales_docs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: text('kind').$type<SalesDocKind>().notNull(),
    number: text('number').notNull().unique(),
    docDate: date('doc_date').notNull(),
    dueDate: date('due_date'),
    reference: text('reference').default('').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    /** Payee of a payment voucher (EXP) */
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    /** Company bank / cash account the money went into or out of */
    accountId: uuid('account_id').references(() => companyAccounts.id, { onDelete: 'set null' }),
    customerName: text('customer_name').default('').notNull(),
    customerTaxId: text('customer_tax_id').default('').notNull(),
    customerBranch: text('customer_branch').default('').notNull(),
    customerAddress: text('customer_address').default('').notNull(),
    contactName: text('contact_name').default('').notNull(),
    phone: text('phone').default('').notNull(),
    email: text('email').default('').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    milestone: text('milestone').default('').notNull(),
    accountCategory: text('account_category').default('').notNull(),
    vatMode: text('vat_mode').$type<SalesVatMode>().default('EXCLUSIVE').notNull(),
    discountType: text('discount_type').$type<'PERCENT' | 'AMOUNT'>().default('AMOUNT').notNull(),
    discountValue: numeric('discount_value', { precision: 14, scale: 2 }).default('0').notNull(),
    whtRate: numeric('wht_rate', { precision: 5, scale: 2 }).default('0').notNull(),
    retentionRate: numeric('retention_rate', { precision: 5, scale: 2 }).default('0').notNull(),
    retention: numeric('retention', { precision: 14, scale: 2 }).default('0').notNull(),
    payMethod: text('pay_method').$type<'TRANSFER' | 'CASH' | 'CHEQUE' | 'PROMPTPAY' | 'CARD'>(),
    bank: text('bank').default('').notNull(),
    bankBranch: text('bank_branch').default('').notNull(),
    accountName: text('account_name').default('').notNull(),
    accountNo: text('account_no').default('').notNull(),
    notes: text('notes').default('').notNull(),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).default('0').notNull(),
    discount: numeric('discount', { precision: 14, scale: 2 }).default('0').notNull(),
    beforeVat: numeric('before_vat', { precision: 14, scale: 2 }).default('0').notNull(),
    vat: numeric('vat', { precision: 14, scale: 2 }).default('0').notNull(),
    total: numeric('total', { precision: 14, scale: 2 }).default('0').notNull(),
    wht: numeric('wht', { precision: 14, scale: 2 }).default('0').notNull(),
    payable: numeric('payable', { precision: 14, scale: 2 }).default('0').notNull(),
    status: text('status').$type<'ISSUED' | 'CANCELLED'>().default('ISSUED').notNull(),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('sales_docs_kind_idx').on(t.kind, t.docDate)],
);

export const salesDocLines = pgTable('sales_doc_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  docId: uuid('doc_id')
    .notNull()
    .references(() => salesDocs.id, { onDelete: 'cascade' }),
  sort: integer('sort').notNull(),
  /** A heading row (พื้นที่หลัก, e.g. ห้องโถง) that groups the lines under it */
  isSection: boolean('is_section').default(false).notNull(),
  name: text('name').notNull(),
  detail: text('detail').default('').notNull(),
  qty: numeric('qty', { precision: 14, scale: 3 }).default('0').notNull(),
  unit: text('unit').default('').notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).default('0').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).default('0').notNull(),
});

export type AccountCategoryType = 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY' | 'OTHER';

/** หมวดรายรับ / หมวดค่าใช้จ่าย: the company's chart of categories offered on accounting documents */
export const accountCategories = pgTable('account_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').$type<AccountCategoryType>().notNull(),
  groupName: text('group_name').default('').notNull(),
  /** Usual VAT of documents in this category */
  vatDefault: text('vat_default').$type<'VAT7' | 'NONE'>().default('VAT7').notNull(),
  /** Usual withholding tax rate in percent; 0 for none */
  whtRate: numeric('wht_rate', { precision: 5, scale: 2 }).default('0').notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
