import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './core';

/**
 * A person's own signature, drawn or uploaded on their profile. Kept apart from `users` so the
 * picture is not read every time a user row is. It is put on a document's signature line once that
 * person has prepared or approved it in the system.
 */
export const userSignatures = pgTable('user_signatures', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** PNG as a data URL, ready for an <img> and for the PDF renderer */
  image: text('image').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
