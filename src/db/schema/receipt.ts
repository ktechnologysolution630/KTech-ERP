import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  date,
} from 'drizzle-orm/pg-core';
import { users } from './core';
import { poLines, pos } from './po';

export type ReceiptStatus = 'CONFIRMED' | 'CANCELLED';

export const receipts = pgTable('receipts', {
  id: uuid('id').defaultRandom().primaryKey(),
  poId: uuid('po_id')
    .notNull()
    .references(() => pos.id),
  poRevision: integer('po_revision').default(0).notNull(),
  receivedAt: date('received_at').notNull(),
  deliveryNoteNo: text('delivery_note_no').default('').notNull(),
  note: text('note').default('').notNull(),
  receivedBy: uuid('received_by')
    .notNull()
    .references(() => users.id),
  status: text('status').$type<ReceiptStatus>().default('CONFIRMED').notNull(),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const receiptLines = pgTable('receipt_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  receiptId: uuid('receipt_id')
    .notNull()
    .references(() => receipts.id, { onDelete: 'cascade' }),
  poLineId: uuid('po_line_id')
    .notNull()
    .references(() => poLines.id),
  qty: numeric('qty', { precision: 14, scale: 3 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
