import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  date,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { type TaskPriority, type TaskStatus } from '@/domain/schedule';
import { users } from './core';
import { projects } from './master';

export const projectTasks = pgTable(
  'project_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // Two-level WBS: a parent groups leaf tasks; deleting a parent deletes its children
    parentId: uuid('parent_id').references((): AnyPgColumn => projectTasks.id, {
      onDelete: 'cascade',
    }),
    sort: integer('sort').notNull(),
    title: text('title').notNull(),
    description: text('description').default('').notNull(),
    status: text('status').$type<TaskStatus>().default('TODO').notNull(),
    priority: text('priority').$type<TaskPriority>().default('MEDIUM').notNull(),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    progress: integer('progress').default(0).notNull(),
    value: numeric('value', { precision: 16, scale: 2 }).default('0.00').notNull(),
    assigneeId: uuid('assignee_id').references(() => users.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('project_tasks_project_sort_idx').on(t.projectId, t.sort),
    index('project_tasks_parent_idx').on(t.parentId),
  ],
);
