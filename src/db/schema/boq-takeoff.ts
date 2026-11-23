import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './core';
import { projects } from './master';
import type { TakeoffData } from '@/domain/boq-takeoff';

/**
 * A quantity take-off made on a CAD drawing printed to PDF. The PDF itself stays on the user's computer;
 * only its name and fingerprint are kept, so reopening the work can check the same drawing was chosen.
 */
export const boqTakeoffs = pgTable(
  'boq_takeoffs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    name: text('name').notNull(),
    // Kept when the project is deleted: the measurements are still worth having
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    fileName: text('file_name').default('').notNull(),
    fileFingerprint: text('file_fingerprint').default('').notNull(),
    pageCount: integer('page_count').default(0).notNull(),
    data: jsonb('data').$type<TakeoffData>().notNull(),
    /** When the items were last added to the project's BOQ, and which BOQ */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentBoqNumber: text('sent_boq_number').default('').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('boq_takeoffs_project_idx').on(t.projectId)],
);
