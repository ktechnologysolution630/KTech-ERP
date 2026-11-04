import { date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { type AssetStatus, type InspectionResult } from '@/domain/asset';
import { users } from './core';
import { projects } from './master';

/** ทะเบียนทรัพย์สิน: machines, vehicles and tools the company keeps track of */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').default('').notNull(),
    serialNo: text('serial_no').default('').notNull(),
    /** Where it is now; null means the office */
    projectId: uuid('project_id').references(() => projects.id),
    custodian: text('custodian').default('').notNull(),
    purchaseDate: date('purchase_date'),
    purchaseValue: numeric('purchase_value', { precision: 16, scale: 2 }).default('0.00').notNull(),
    salvageValue: numeric('salvage_value', { precision: 16, scale: 2 }).default('0.00').notNull(),
    /** Null means the asset is not depreciated */
    usefulLifeYears: integer('useful_life_years'),
    inspectEveryDays: integer('inspect_every_days').default(90).notNull(),
    status: text('status').$type<AssetStatus>().default('ACTIVE').notNull(),
    /** Depreciation stops on this date */
    retiredOn: date('retired_on'),
    /** The due period people were last told about, so each one is announced only once */
    dueNotifiedFor: text('due_notified_for'),
    note: text('note').default('').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('assets_code_idx').on(t.code), index('assets_project_idx').on(t.projectId)],
);

/** One check of an asset; never edited afterwards, so the history stays what was found at the time */
export const assetInspections = pgTable(
  'asset_inspections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id),
    inspectedOn: date('inspected_on').notNull(),
    result: text('result').$type<InspectionResult>().notNull(),
    note: text('note').default('').notNull(),
    /** Where the phone was when the check was confirmed; null on checks from before location was asked for */
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    locationAccuracyM: integer('location_accuracy_m'),
    inspectedBy: uuid('inspected_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('asset_inspections_asset_idx').on(t.assetId, t.inspectedOn)],
);
