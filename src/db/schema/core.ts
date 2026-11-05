import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  numeric,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { MenuSection } from '@/domain/menu';

export const ROLES = [
  'FOREMAN',
  'ENGINEER',
  'PM',
  'PURCHASING',
  'PURCHASING_HEAD',
  'FINANCE',
  'OWNER',
  'ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  projectIds: string[];
  hiddenMenus: MenuSection[];
};

export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    active: boolean('active').default(true).notNull(),
    /** Stored as what is hidden, so everyone keeps seeing a menu added later until someone hides it */
    hiddenMenus: jsonb('hidden_menus').$type<MenuSection[]>().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const settings = pgTable('settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyName: text('company_name').default('บริษัท เค เทค เอ็นจิเนียริ่ง จำกัด').notNull(),
  companyAddress: text('company_address').default('กรุงเทพมหานคร').notNull(),
  companyTaxId: text('company_tax_id').default('0105500000000').notNull(),
  companyBranch: text('company_branch').default('00000').notNull(),
  logoUrl: text('logo_url'),
  poApprovalLimit: numeric('po_approval_limit', { precision: 14, scale: 2 })
    .default('50000.00')
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const docCounters = pgTable(
  'doc_counters',
  {
    prefix: text('prefix').notNull(),
    period: text('period').notNull(),
    last: integer('last').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.prefix, t.period] })],
);
