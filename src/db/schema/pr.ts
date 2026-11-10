import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  date,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './core';
import { items, projects } from './master';

export type PrStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'CLOSED';

export const prs = pgTable(
  'prs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<PrStatus>().default('DRAFT').notNull(),
    note: text('note').default('').notNull(),
    rejectReason: text('reject_reason'),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('prs_number_idx').on(t.number)],
);

export const prLines = pgTable('pr_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => prs.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id),
  description: text('description').notNull(),
  // Work category (งานโครงสร้าง, งานสถาปัตยกรรม, …); null on PRs made before categories
  category: text('category'),
  unitName: text('unit_name').notNull(),
  qty: numeric('qty', { precision: 14, scale: 3 }).notNull(),
  estUnitPrice: numeric('est_unit_price', { precision: 14, scale: 2 }),
  neededDate: date('needed_date'),
  note: text('note').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
