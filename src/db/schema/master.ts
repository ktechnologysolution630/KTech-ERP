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
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { type ProjectStatus } from '@/domain/project';
import { type CreditBasis, type PayMethod } from '@/domain/payment-terms';
import { users } from './core';

export type VendorType = 'INDIVIDUAL' | 'COMPANY';

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
