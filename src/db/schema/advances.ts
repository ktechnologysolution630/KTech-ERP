import { pgTable, uuid, text, timestamp, integer, numeric, date, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { type AdvanceStatus, type ExpenseEvidence, type ReceiptSubstituteStatus } from '@/domain/advance';
import { users } from './core';
import { projects } from './master';

/** ใบขอเงินทดรองจ่าย */
export const advances = pgTable(
  'advances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    payeeId: uuid('payee_id')
      .notNull()
      .references(() => users.id),
    projectId: uuid('project_id').references(() => projects.id),
    requestDate: date('request_date').notNull(),
    purpose: text('purpose').notNull(),
    amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
    status: text('status').$type<AdvanceStatus>().default('PENDING').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').default('').notNull(),
    paidAt: date('paid_at'),
    paidBy: uuid('paid_by').references(() => users.id),
    /** Cash the payee handed back when clearing */
    returnedAmount: numeric('returned_amount', { precision: 16, scale: 2 }).default('0.00').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('advances_number_idx').on(t.number), index('advances_payee_idx').on(t.payeeId)],
);

/** ใบรับรองแทนใบเสร็จรับเงิน: expenses paid where the seller could not issue a receipt */
export const receiptSubstitutes = pgTable(
  'receipt_substitutes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number'),
    payerId: uuid('payer_id')
      .notNull()
      .references(() => users.id),
    projectId: uuid('project_id').references(() => projects.id),
    advanceId: uuid('advance_id').references(() => advances.id),
    docDate: date('doc_date').notNull(),
    total: numeric('total', { precision: 16, scale: 2 }).default('0.00').notNull(),
    status: text('status').$type<ReceiptSubstituteStatus>().default('DRAFT').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decisionNote: text('decision_note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('receipt_substitutes_number_idx').on(t.number)],
);

export const receiptSubstituteLines = pgTable('receipt_substitute_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  substituteId: uuid('substitute_id')
    .notNull()
    .references(() => receiptSubstitutes.id, { onDelete: 'cascade' }),
  sort: integer('sort').notNull(),
  spentOn: date('spent_on').notNull(),
  description: text('description').notNull(),
  /** Who was paid (ชื่อผู้รับเงิน), as written on the form */
  paidTo: text('paid_to').default('').notNull(),
  amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
});

/** Expenses that clear an advance */
export const advanceExpenses = pgTable(
  'advance_expenses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    advanceId: uuid('advance_id')
      .notNull()
      .references(() => advances.id, { onDelete: 'cascade' }),
    spentOn: date('spent_on').notNull(),
    description: text('description').notNull(),
    amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
    evidence: text('evidence').$type<ExpenseEvidence>().default('RECEIPT').notNull(),
    reference: text('reference').default('').notNull(),
    substituteId: uuid('substitute_id').references(() => receiptSubstitutes.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('advance_expenses_advance_idx').on(t.advanceId)],
);
