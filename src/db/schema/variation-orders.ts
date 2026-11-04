import { pgTable, uuid, text, timestamp, integer, numeric, date, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { type VoPriority, type VoStatus, type VoType } from '@/domain/variation-order';
import { users } from './core';
import { projects } from './master';
import { projectTasks } from './tasks';

/**
 * งานเพิ่ม-ลด (VO). Added work is priced by the VO's own BOQ (boqs.kind = 'VO') when it has
 * item lines, otherwise entered directly; deducted work is a single amount. All amounts are
 * before VAT. Approved VOs adjust the contract value and schedule.
 */
export const variationOrders = pgTable(
  'variation_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    title: text('title').notNull(),
    description: text('description').default('').notNull(),
    requestDate: date('request_date').notNull(),
    voType: text('vo_type').$type<VoType>().default('ADD').notNull(),
    /** ผู้ร้องขอ: free text, often the customer or consultant rather than a system user */
    requesterName: text('requester_name').default('').notNull(),
    responsibleUserId: uuid('responsible_user_id').references(() => users.id),
    workArea: text('work_area').default('').notNull(),
    priority: text('priority').$type<VoPriority>().default('NORMAL').notNull(),
    changeReason: text('change_reason').default('').notNull(),
    /** มูลค่างานเดิม: value of the work being changed, for reference */
    originalAmount: numeric('original_amount', { precision: 16, scale: 2 }).default('0.00').notNull(),
    /** Before VAT. Equals the VO BOQ's after-discount total whenever the BOQ has item lines */
    addAmount: numeric('add_amount', { precision: 16, scale: 2 }).default('0.00').notNull(),
    deductAmount: numeric('deduct_amount', { precision: 16, scale: 2 }).default('0.00').notNull(),
    deductNote: text('deduct_note').default('').notNull(),
    vatPercent: numeric('vat_percent', { precision: 5, scale: 2 }).default('7.00').notNull(),
    costCode: text('cost_code').default('').notNull(),
    costCategory: text('cost_category').default('').notNull(),
    costNote: text('cost_note').default('').notNull(),
    scheduleImpact: boolean('schedule_impact').default(false).notNull(),
    daysAdded: integer('days_added').default(0).notNull(),
    daysReduced: integer('days_reduced').default(0).notNull(),
    /** Contract extension (+) or reduction (−) in calendar days = days_added − days_reduced */
    daysImpact: integer('days_impact').default(0).notNull(),
    impactStartDate: date('impact_start_date'),
    impactEndDate: date('impact_end_date'),
    criticalPath: boolean('critical_path').default(false).notNull(),
    affectedTaskId: uuid('affected_task_id').references(() => projectTasks.id, { onDelete: 'set null' }),
    /** As typed on the form; set whether or not it matches a task, and kept if the task is later deleted */
    affectedActivity: text('affected_activity').default('').notNull(),
    timeReason: text('time_reason').default('').notNull(),
    status: text('status').$type<VoStatus>().default('DRAFT').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('variation_orders_number_idx').on(t.number), index('variation_orders_project_idx').on(t.projectId)],
);
