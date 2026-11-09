import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './core';
import { projects } from './master';
import { variationOrders } from './variation-orders';

export type BoqKind = 'MAIN' | 'VO';

export const boqs = pgTable(
  'boqs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<BoqKind>().default('MAIN').notNull(),
    // Set for kind = 'VO': the variation order this BOQ prices
    voId: uuid('vo_id').references(() => variationOrders.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    revision: integer('revision').default(0).notNull(),
    estimateDate: date('estimate_date'),
    projectTitle: text('project_title').default('').notNull(),
    location: text('location').default('').notNull(),
    owner: text('owner').default('').notNull(),
    workDetail: text('work_detail').default('').notNull(),
    estimator: text('estimator').default('').notNull(),
    overheadPercent: numeric('overhead_percent', { precision: 5, scale: 2 })
      .default('0.00')
      .notNull(),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 2 })
      .default('0.00')
      .notNull(),
    vatPercent: numeric('vat_percent', { precision: 5, scale: 2 }).default('7.00').notNull(),
    remarks: text('remarks').default('').notNull(),
    materialTotal: numeric('material_total', { precision: 16, scale: 2 }).default('0.00').notNull(),
    laborTotal: numeric('labor_total', { precision: 16, scale: 2 }).default('0.00').notNull(),
    grandTotal: numeric('grand_total', { precision: 16, scale: 2 }).default('0.00').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('boqs_number_idx').on(t.number),
    // One main BOQ per project; VO BOQs are unlimited
    uniqueIndex('boqs_project_main_idx').on(t.projectId).where(sql`${t.kind} = 'MAIN'`),
    // One BOQ per variation order
    uniqueIndex('boqs_vo_idx').on(t.voId).where(sql`${t.voId} IS NOT NULL`),
  ],
);

export const boqLines = pgTable(
  'boq_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    boqId: uuid('boq_id')
      .notNull()
      .references(() => boqs.id, { onDelete: 'cascade' }),
    sort: integer('sort').notNull(),
    isCategory: boolean('is_category').default(false).notNull(),
    isBold: boolean('is_bold').default(false).notNull(),
    no: text('no').default('').notNull(),
    description: text('description').default('').notNull(),
    qty: numeric('qty', { precision: 14, scale: 3 }),
    unit: text('unit').default('').notNull(),
    materialRate: numeric('material_rate', { precision: 14, scale: 2 }),
    laborRate: numeric('labor_rate', { precision: 14, scale: 2 }),
    note: text('note').default('').notNull(),
    /** Highest material-usage alert already sent to the owner and PM: 0, 50, 80, 100 or 101 (over budget) */
    usageAlertLevel: integer('usage_alert_level').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('boq_lines_boq_sort_idx').on(t.boqId, t.sort)],
);
