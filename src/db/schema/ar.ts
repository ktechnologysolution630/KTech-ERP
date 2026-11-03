import { pgTable, uuid, text, timestamp, integer, numeric, date, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { type ArInvoiceStatus, type ArPayMethod } from '@/domain/ar';
import { type VatMode } from '@/domain/money';
import { users } from './core';
import { projects } from './master';
import { milestones } from './milestones';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    taxId: text('tax_id'),
    branch: text('branch').default('00000').notNull(),
    address: text('address').default('').notNull(),
    contactName: text('contact_name').default('').notNull(),
    phone: text('phone').default('').notNull(),
    email: text('email').default('').notNull(),
    creditDays: integer('credit_days').default(30).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('customers_code_idx').on(t.code)],
);

/** ใบแจ้งหนี้/วางบิล to a customer, usually one per receive milestone (งวดงานรับ). */
export const arInvoices = pgTable(
  'ar_invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number'),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    projectId: uuid('project_id').references(() => projects.id),
    milestoneId: uuid('milestone_id').references(() => milestones.id),
    docDate: date('doc_date').notNull(),
    dueDate: date('due_date').notNull(),
    vatMode: text('vat_mode').$type<VatMode>().default('INCLUSIVE').notNull(),
    beforeVat: numeric('before_vat', { precision: 16, scale: 2 }).default('0.00').notNull(),
    vat: numeric('vat', { precision: 16, scale: 2 }).default('0.00').notNull(),
    gross: numeric('gross', { precision: 16, scale: 2 }).default('0.00').notNull(),
    /** หักประกันผลงาน withheld by the customer on this bill; still owed until released */
    retentionAmount: numeric('retention_amount', { precision: 16, scale: 2 }).default('0.00').notNull(),
    status: text('status').$type<ArInvoiceStatus>().default('DRAFT').notNull(),
    note: text('note').default('').notNull(),
    voidReason: text('void_reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('ar_invoices_number_idx').on(t.number),
    index('ar_invoices_customer_idx').on(t.customerId),
    index('ar_invoices_milestone_idx').on(t.milestoneId),
  ],
);

export const arInvoiceLines = pgTable('ar_invoice_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => arInvoices.id, { onDelete: 'cascade' }),
  sort: integer('sort').notNull(),
  description: text('description').notNull(),
  qty: numeric('qty', { precision: 14, scale: 3 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 16, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
});

/** ใบเสร็จรับเงิน/ใบกำกับภาษี: money received against one invoice; carries its share of output VAT. */
export const arReceipts = pgTable(
  'ar_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => arInvoices.id),
    receiptDate: date('receipt_date').notNull(),
    method: text('method').$type<ArPayMethod>().default('TRANSFER').notNull(),
    reference: text('reference').default('').notNull(),
    amountReceived: numeric('amount_received', { precision: 16, scale: 2 }).notNull(),
    /** ภาษีหัก ณ ที่จ่าย deducted by the customer; settles the invoice like cash */
    whtAmount: numeric('wht_amount', { precision: 16, scale: 2 }).default('0.00').notNull(),
    beforeVat: numeric('before_vat', { precision: 16, scale: 2 }).notNull(),
    vat: numeric('vat', { precision: 16, scale: 2 }).notNull(),
    voided: boolean('voided').default(false).notNull(),
    voidReason: text('void_reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('ar_receipts_number_idx').on(t.number), index('ar_receipts_invoice_idx').on(t.invoiceId)],
);

/** ใบลดหนี้ against an issued invoice. */
export const arCreditNotes = pgTable(
  'ar_credit_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => arInvoices.id),
    docDate: date('doc_date').notNull(),
    reason: text('reason').notNull(),
    beforeVat: numeric('before_vat', { precision: 16, scale: 2 }).notNull(),
    vat: numeric('vat', { precision: 16, scale: 2 }).notNull(),
    gross: numeric('gross', { precision: 16, scale: 2 }).notNull(),
    voided: boolean('voided').default(false).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('ar_credit_notes_number_idx').on(t.number), index('ar_credit_notes_invoice_idx').on(t.invoiceId)],
);
