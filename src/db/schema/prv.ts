import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  date,
} from 'drizzle-orm/pg-core';
import { type PrvBankAccount, type PrvPayMethod } from '@/domain/prv';
import { users } from './core';
import { projects, vendors } from './master';
import { pos } from './po';

export type PrvCategory =
  | 'CONTRACTOR_PROGRESS'
  | 'PO_ADVANCE'
  | 'PO_CREDIT'
  | 'EXPENSE'
  | 'PETTY_CASH';

export type PrvStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PM_VERIFIED'
  | 'APPROVED'
  | 'PV_CREATED'
  | 'REJECTED';

export const prvs = pgTable('prvs', {
  id: uuid('id').defaultRandom().primaryKey(),
  prvNumber: text('prv_number').notNull().unique(),
  date: date('date').notNull(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  poId: uuid('po_id').references(() => pos.id),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  payeeName: text('payee_name').notNull(),
  category: text('category').$type<PrvCategory>().default('EXPENSE').notNull(),
  installmentNo: integer('installment_no'),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
  retentionPercent: numeric('retention_percent', { precision: 5, scale: 2 }).default('0').notNull(),
  retentionAmount: numeric('retention_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  whtRate: numeric('wht_rate', { precision: 5, scale: 2 }).default('0').notNull(),
  whtAmount: numeric('wht_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  vatAmount: numeric('vat_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  netAmount: numeric('net_amount', { precision: 14, scale: 2 }).notNull(),
  status: text('status').$type<PrvStatus>().default('DRAFT').notNull(),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => users.id),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  pvId: text('pv_id'),
  /** How the requester asks for it to be paid; finance records what actually happened on the PV */
  payMethod: text('pay_method').$type<PrvPayMethod>(),
  payBank: text('pay_bank').$type<PrvBankAccount>(),
  notes: text('notes').default(''),
  attachments: text('attachments').default('[]'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const prvItems = pgTable('prv_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  prvId: uuid('prv_id')
    .notNull()
    .references(() => prvs.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  documentNo: text('document_no').default('').notNull(),
  poNumber: text('po_number').default('').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).default('1').notNull(),
  unit: text('unit').default('งาน').notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  progressPercent: numeric('progress_percent', { precision: 5, scale: 2 }).default('100').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
