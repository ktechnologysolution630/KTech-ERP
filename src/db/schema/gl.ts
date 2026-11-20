import { pgTable, uuid, text, timestamp, numeric, date, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './core';
import { projects } from './master';
import type { GlAccountType, GlBook, JournalSource, SystemAccountKey } from '@/domain/gl';

/** ผังบัญชี: the company's chart of accounts. A system key marks the account the automatic postings use. */
export const glAccounts = pgTable(
  'gl_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<GlAccountType>().notNull(),
    /** Which automatic posting uses this account; at most one account per key */
    systemKey: text('system_key').$type<SystemAccountKey>(),
    active: boolean('active').default(true).notNull(),
    sort: integer('sort').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('gl_accounts_code_idx').on(t.code), uniqueIndex('gl_accounts_system_key_idx').on(t.systemKey)],
);

/**
 * สมุดรายวัน: one journal entry, made by the system when a document is approved, paid or issued.
 * An entry is never edited: when its document is cancelled or changed it is voided and, if needed,
 * a new one is posted, so the history stays readable.
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    entryDate: date('entry_date').notNull(),
    book: text('book').$type<GlBook>().notNull(),
    sourceType: text('source_type').$type<JournalSource>().notNull(),
    sourceId: uuid('source_id'),
    sourceNumber: text('source_number').default('').notNull(),
    description: text('description').default('').notNull(),
    partyName: text('party_name').default('').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    total: numeric('total', { precision: 16, scale: 2 }).default('0').notNull(),
    status: text('status').$type<'POSTED' | 'VOID'>().default('POSTED').notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('journal_entries_number_idx').on(t.number),
    index('journal_entries_source_idx').on(t.sourceType, t.sourceId),
    index('journal_entries_date_idx').on(t.entryDate),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    sort: integer('sort').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => glAccounts.id),
    debit: numeric('debit', { precision: 16, scale: 2 }).default('0').notNull(),
    credit: numeric('credit', { precision: 16, scale: 2 }).default('0').notNull(),
    memo: text('memo').default('').notNull(),
  },
  (t) => [index('journal_lines_entry_idx').on(t.entryId), index('journal_lines_account_idx').on(t.accountId)],
);

/**
 * ปิดงวด / ปิดบัญชีสิ้นปี: the books are closed up to closedThrough while a closing is not reopened. No entry
 * dated on or before the latest open closing can be posted, changed or voided. A year-end closing also
 * carries the entry that moved the year's income and expenses into retained earnings.
 */
export const glClosings = pgTable(
  'gl_closings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    closedThrough: date('closed_through').notNull(),
    kind: text('kind').$type<'PERIOD' | 'YEAR'>().notNull(),
    yearCloseEntryId: uuid('year_close_entry_id').references(() => journalEntries.id),
    note: text('note').default('').notNull(),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    reopenedBy: uuid('reopened_by').references(() => users.id, { onDelete: 'set null' }),
    reopenReason: text('reopen_reason'),
  },
  (t) => [index('gl_closings_through_idx').on(t.closedThrough)],
);

/** กระทบยอดเงินฝากธนาคาร: one bank statement matched against the books of one account */
export const bankReconciliations = pgTable(
  'bank_reconciliations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => glAccounts.id),
    statementDate: date('statement_date').notNull(),
    statementBalance: numeric('statement_balance', { precision: 16, scale: 2 }).notNull(),
    /** The book balance on the statement date, kept to show what was outstanding then */
    bookBalance: numeric('book_balance', { precision: 16, scale: 2 }).notNull(),
    note: text('note').default('').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('bank_reconciliations_account_idx').on(t.accountId, t.statementDate)],
);

/** A journal line ticked as on the bank statement; each line is reconciled once */
export const bankRecLines = pgTable(
  'bank_rec_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reconciliationId: uuid('reconciliation_id')
      .notNull()
      .references(() => bankReconciliations.id, { onDelete: 'cascade' }),
    journalLineId: uuid('journal_line_id')
      .notNull()
      .references(() => journalLines.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('bank_rec_lines_line_idx').on(t.journalLineId)],
);
