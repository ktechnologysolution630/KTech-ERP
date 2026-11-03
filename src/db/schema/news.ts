import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './core';

/** Company news and updates shown on everyone's portal; posted by admins/owners. */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    body: text('body').default('').notNull(),
    imageUrl: text('image_url').default('').notNull(),
    /** Optional "read more" link: an in-app path or an http(s) URL */
    linkUrl: text('link_url').default('').notNull(),
    pinned: boolean('pinned').default(false).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('announcements_created_idx').on(t.pinned, t.createdAt)],
);
