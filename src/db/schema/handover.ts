import { date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { type DefectStatus, type HandoverStatus } from '@/domain/handover';
import { users } from './core';
import { projects } from './master';

/**
 * Handing the finished work over to the customer (one record per project). Acceptance starts
 * the warranty: it gets a WAR- number and runs from the handover date.
 */
export const projectHandovers = pgTable(
  'project_handovers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').$type<HandoverStatus>().default('SCHEDULED').notNull(),
    /** Planned date while SCHEDULED, actual date afterwards */
    handoverDate: date('handover_date').notNull(),
    receivedBy: text('received_by').default('').notNull(),
    note: text('note').default('').notNull(),
    warrantyNumber: text('warranty_number'),
    warrantyMonths: integer('warranty_months').default(12).notNull(),
    structuralWarrantyMonths: integer('structural_warranty_months').default(60).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('project_handovers_project_idx').on(t.projectId),
    uniqueIndex('project_handovers_warranty_number_idx').on(t.warrantyNumber),
  ],
);

/** Defects the customer reports during the warranty period (แจ้งซ่อม). */
export const warrantyDefects = pgTable(
  'warranty_defects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    title: text('title').notNull(),
    location: text('location').default('').notNull(),
    reportedDate: date('reported_date').notNull(),
    reportedBy: text('reported_by').default('').notNull(),
    status: text('status').$type<DefectStatus>().default('OPEN').notNull(),
    fixedDate: date('fixed_date'),
    resolution: text('resolution').default('').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('warranty_defects_number_idx').on(t.number), index('warranty_defects_project_idx').on(t.projectId, t.status)],
);
