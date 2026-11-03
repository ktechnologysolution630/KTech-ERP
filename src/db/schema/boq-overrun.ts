import { pgTable, uuid, text, timestamp, integer, numeric, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { type BoqOverrunLine } from '@/domain/boq-overrun';
import { users } from './core';
import { projects } from './master';
import { pos } from './po';

export type BoqOverrunStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** ใบ AP: request to buy beyond the BOQ budget for one PO revision. */
export const boqOverrunRequests = pgTable(
  'boq_overrun_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    poId: uuid('po_id')
      .notNull()
      .references(() => pos.id, { onDelete: 'cascade' }),
    poRevision: integer('po_revision').notNull(),
    overAmount: numeric('over_amount', { precision: 16, scale: 2 }).notNull(),
    lines: jsonb('lines').$type<BoqOverrunLine[]>().notNull(),
    reason: text('reason').notNull(),
    status: text('status').$type<BoqOverrunStatus>().default('PENDING').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('boq_overrun_number_idx').on(t.number), index('boq_overrun_po_idx').on(t.poId)],
);
