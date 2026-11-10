import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './core';
import { projects, vendors } from './master';
import { pos, poInstallments } from './po';

export type InvoiceStatus = 'ACTIVE' | 'CANCELLED';

export type PayableSourceType =
  | 'CREDIT_INVOICE'
  | 'PREPAID_REQUEST'
  | 'INSTALLMENT'
  | 'CONTRACTOR_CLAIM'
  | 'LABOR'
  | 'EXPENSE';

export type PayableStatus = 'OPEN' | 'IN_PV' | 'PAID' | 'CANCELLED';

export type PvStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID'
  | 'CANCELLED';

import { type ChequeStatus, type PayMethod } from '@/domain/payment-terms';
export type { PayMethod };

export type WhtFormType = 'PND3' | 'PND53';
export type WhtCertStatus = 'ACTIVE' | 'VOID';

export const invoices = pgTable('invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  poId: uuid('po_id')
    .notNull()
    .references(() => pos.id),
  vendorId: uuid('vendor_id')
    .notNull()
    .references(() => vendors.id),
  invoiceNo: text('invoice_no').notNull(),
  invoiceDate: date('invoice_date').notNull(),
  isTaxInvoice: boolean('is_tax_invoice').default(true).notNull(),
  beforeVat: numeric('before_vat', { precision: 14, scale: 2 }).notNull(),
  vat: numeric('vat', { precision: 14, scale: 2 }).notNull(),
  gross: numeric('gross', { precision: 14, scale: 2 }).notNull(),
  /** The day the bill was (or will be) placed with us, from the PO's billing schedule */
  billingDate: date('billing_date'),
  dueDate: date('due_date'),
  status: text('status').$type<InvoiceStatus>().default('ACTIVE').notNull(),
  cancelReason: text('cancel_reason'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const payables = pgTable('payables', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceType: text('source_type').$type<PayableSourceType>().notNull(),
  poId: uuid('po_id').references(() => pos.id),
  // Project the cost belongs to (from the PO or the PRV); null for office purchases
  projectId: uuid('project_id').references(() => projects.id),
  vendorId: uuid('vendor_id')
    .notNull()
    .references(() => vendors.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  installmentId: uuid('installment_id').references(() => poInstallments.id),
  beforeVat: numeric('before_vat', { precision: 14, scale: 2 }).notNull(),
  vat: numeric('vat', { precision: 14, scale: 2 }).notNull(),
  gross: numeric('gross', { precision: 14, scale: 2 }).notNull(),
  dueDate: date('due_date').notNull(),
  status: text('status').$type<PayableStatus>().default('OPEN').notNull(),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => users.id),
  note: text('note').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('payables_project_idx').on(t.projectId)]);

export const invoicePayableMatches = pgTable('invoice_payable_matches', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  payableId: uuid('payable_id')
    .notNull()
    .references(() => payables.id, { onDelete: 'cascade' }),
  gross: numeric('gross', { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const pvs = pgTable(
  'pvs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    status: text('status').$type<PvStatus>().default('DRAFT').notNull(),
    note: text('note').default('').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    overrideReason: text('override_reason'),
    paidAt: date('paid_at'),
    payMethod: text('pay_method').$type<PayMethod>(),
    payFromAccount: text('pay_from_account'),
    payRef: text('pay_ref'),
    chequeNo: text('cheque_no'),
    chequeBank: text('cheque_bank'),
    chequeDate: date('cheque_date'),
    chequeStatus: text('cheque_status').$type<ChequeStatus>(),
    chequeCollectedBy: text('cheque_collected_by'),
    chequeCollectedAt: date('cheque_collected_at'),
    chequeClearedAt: date('cheque_cleared_at'),
    chequeVoidReason: text('cheque_void_reason'),
    paidBy: uuid('paid_by').references(() => users.id),
    beforeVat: numeric('before_vat', { precision: 14, scale: 2 }).default('0.00').notNull(),
    vat: numeric('vat', { precision: 14, scale: 2 }).default('0.00').notNull(),
    gross: numeric('gross', { precision: 14, scale: 2 }).default('0.00').notNull(),
    wht: numeric('wht', { precision: 14, scale: 2 }).default('0.00').notNull(),
    net: numeric('net', { precision: 14, scale: 2 }).default('0.00').notNull(),
    whtCertId: uuid('wht_cert_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('pvs_number_idx').on(t.number)],
);

export const pvLines = pgTable('pv_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  pvId: uuid('pv_id')
    .notNull()
    .references(() => pvs.id, { onDelete: 'cascade' }),
  payableId: uuid('payable_id')
    .notNull()
    .references(() => payables.id),
  beforeVat: numeric('before_vat', { precision: 14, scale: 2 }).notNull(),
  vat: numeric('vat', { precision: 14, scale: 2 }).notNull(),
  gross: numeric('gross', { precision: 14, scale: 2 }).notNull(),
  whtRate: integer('wht_rate').default(0).notNull(),
  wht: numeric('wht', { precision: 14, scale: 2 }).notNull(),
  net: numeric('net', { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const whtCerts = pgTable(
  'wht_certs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    pvId: uuid('pv_id')
      .notNull()
      .references(() => pvs.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    formType: text('form_type').$type<WhtFormType>().notNull(),
    paidAt: date('paid_at').notNull(),
    incomeType: text('income_type').default('ค่าจ้างทำของ/ค่าบริการ').notNull(),
    basis: numeric('basis', { precision: 14, scale: 2 }).notNull(),
    wht: numeric('wht', { precision: 14, scale: 2 }).notNull(),
    status: text('status').$type<WhtCertStatus>().default('ACTIVE').notNull(),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('wht_certs_number_idx').on(t.number),
    uniqueIndex('wht_certs_pv_idx').on(t.pvId),
  ],
);
