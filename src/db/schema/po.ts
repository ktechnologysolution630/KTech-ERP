import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  date,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './core';
import { items, projects, vendors } from './master';
import { prLines } from './pr';
import { boqLines } from './boq';
import { type VatMode } from '@/domain/money';

export type PoStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'ORDERED'
  | 'COMPLETED'
  | 'CANCELLED';

export type PoPaymentType = 'CREDIT' | 'PREPAID' | 'INSTALLMENT';

export type InstallmentCondition =
  | 'BEFORE_PRODUCTION'
  | 'BEFORE_DELIVERY'
  | 'AFTER_DELIVERY'
  | 'OTHER';

export type InstallmentStatus = 'PENDING' | 'REQUESTED' | 'PAID' | 'CANCELLED';

export const pos = pgTable(
  'pos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<PoStatus>().default('DRAFT').notNull(),
    paymentType: text('payment_type').$type<PoPaymentType>().default('CREDIT').notNull(),
    creditDays: integer('credit_days'),
    vatMode: text('vat_mode').$type<VatMode>().default('EXCLUSIVE').notNull(),
    billDiscount: numeric('bill_discount', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    shipping: numeric('shipping', { precision: 14, scale: 2 }).default('0.00').notNull(),
    beforeVat: numeric('before_vat', { precision: 14, scale: 2 }).default('0.00').notNull(),
    vat: numeric('vat', { precision: 14, scale: 2 }).default('0.00').notNull(),
    gross: numeric('gross', { precision: 14, scale: 2 }).default('0.00').notNull(),
    deliveryDate: date('delivery_date'),
    deliveryAddress: text('delivery_address').default('').notNull(),
    note: text('note').default('').notNull(),
    currentRevision: integer('current_revision').default(0).notNull(),
    approvedRevision: integer('approved_revision'),
    pendingRevision: jsonb('pending_revision'),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    orderedAt: timestamp('ordered_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    closedShort: boolean('closed_short').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('pos_number_idx').on(t.number)],
);

export const poLines = pgTable('po_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  poId: uuid('po_id')
    .notNull()
    .references(() => pos.id, { onDelete: 'cascade' }),
  prLineId: uuid('pr_line_id').references(() => prLines.id),
  itemId: uuid('item_id').references(() => items.id),
  // BOQ material line this purchase draws on; used for the over-BOQ (AP) check
  boqLineId: uuid('boq_line_id').references(() => boqLines.id),
  description: text('description').notNull(),
  unitName: text('unit_name').notNull(),
  qty: numeric('qty', { precision: 14, scale: 3 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  discount: numeric('discount', { precision: 14, scale: 2 }).default('0.00').notNull(),
  sort: integer('sort').default(0).notNull(),
  allocatedBeforeVat: numeric('allocated_before_vat', { precision: 14, scale: 2 }).notNull(),
  vat: numeric('vat', { precision: 14, scale: 2 }).notNull(),
  gross: numeric('gross', { precision: 14, scale: 2 }).notNull(),
  unitGross: numeric('unit_gross', { precision: 18, scale: 6 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const poInstallments = pgTable('po_installments', {
  id: uuid('id').defaultRandom().primaryKey(),
  poId: uuid('po_id')
    .notNull()
    .references(() => pos.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  name: text('name').notNull(),
  percent: numeric('percent', { precision: 5, scale: 2 }),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  condition: text('condition').$type<InstallmentCondition>().notNull(),
  conditionNote: text('condition_note').default('').notNull(),
  status: text('status').$type<InstallmentStatus>().default('PENDING').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const poRevisions = pgTable('po_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  poId: uuid('po_id')
    .notNull()
    .references(() => pos.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  payload: jsonb('payload').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  reason: text('reason').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const closeShortRequests = pgTable('close_short_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  poId: uuid('po_id')
    .notNull()
    .references(() => pos.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => users.id),
  status: text('status')
    .$type<'PENDING' | 'APPROVED' | 'REJECTED'>()
    .default('PENDING')
    .notNull(),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  rejectReason: text('reject_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
