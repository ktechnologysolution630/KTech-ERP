import { customType, pgTable, uuid, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './core';

export type EntityType =
  | 'PR'
  | 'PO'
  | 'RECEIPT'
  | 'INVOICE'
  | 'PAYABLE'
  | 'PV'
  | 'CLOSE_SHORT'
  | 'BOQ'
  | 'MILESTONE'
  | 'VO'
  | 'AR_INVOICE'
  | 'ADVANCE'
  | 'RECEIPT_SUBSTITUTE'
  | 'STOCK_ADJUST'
  | 'PRV'
  | 'PROJECT'
  | 'DAILY_REPORT';

/** Project workspace files: documents (folders, versions by name) or photos (albums). */
export type AttachmentKind = 'FILE' | 'PHOTO';

export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: text('entity_type').$type<EntityType>().notNull(),
  entityId: uuid('entity_id').notNull(),
  action: text('action').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  note: text('note'),
  data: jsonb('data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const comments = pgTable('comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: text('entity_type').$type<EntityType>().notNull(),
  entityId: uuid('entity_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const attachments = pgTable('attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: text('entity_type').$type<EntityType>().notNull(),
  entityId: uuid('entity_id').notNull(),
  url: text('url').notNull(),
  name: text('name').notNull(),
  size: integer('size').notNull(),
  contentType: text('content_type').notNull(),
  kind: text('kind').$type<AttachmentKind>().default('FILE').notNull(),
  /** Document category or photo album; empty for document attachments */
  folder: text('folder').default('').notNull(),
  /** Photo description, shown under the photo on reports */
  caption: text('caption').default('').notNull(),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('attachments_entity_idx').on(t.entityType, t.entityId)]);

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

/** Uploaded file contents. Kept in the database because a host's local disk may be wiped on every deploy or restart. */
export const storedFiles = pgTable('stored_files', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  content: bytea('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  href: text('href').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
