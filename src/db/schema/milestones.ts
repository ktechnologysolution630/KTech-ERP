import { pgTable, uuid, text, timestamp, integer, numeric, date, uniqueIndex } from 'drizzle-orm/pg-core';
import { type MilestoneKind, type MilestoneStatus } from '@/domain/milestone';
import { users } from './core';
import { projects, vendors } from './master';

export const milestones = pgTable(
  'milestones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<MilestoneKind>().notNull(),
    seq: integer('seq').notNull(),
    title: text('title').notNull(),
    completionCriteria: text('completion_criteria').default('').notNull(),
    // Contractor responsible for a PAY milestone
    vendorId: uuid('vendor_id').references(() => vendors.id),
    plannedDate: date('planned_date'),
    amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
    retentionPercent: numeric('retention_percent', { precision: 5, scale: 2 }).default('0.00').notNull(),
    retentionAmount: numeric('retention_amount', { precision: 16, scale: 2 }).default('0.00').notNull(),
    status: text('status').$type<MilestoneStatus>().default('PLANNED').notNull(),
    claimedAt: date('claimed_at'),
    approvedAt: date('approved_at'),
    paidAt: date('paid_at'),
    note: text('note').default('').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('milestones_project_kind_seq_idx').on(t.projectId, t.kind, t.seq)],
);
