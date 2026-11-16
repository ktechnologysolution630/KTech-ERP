import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  date,
  boolean,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { boqLines } from './boq';
import { users } from './core';
import { items, projects, vendors } from './master';
import { type VatMode } from '@/domain/money';
import { type PrLineKind, type PrType } from '@/domain/pr-type';

export type PrStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  /** The PM approved a PR that asks for more than the BOQ; the owner decides next */
  | 'OWNER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'CLOSED';

export const prs = pgTable(
  'prs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<PrStatus>().default('DRAFT').notNull(),
    note: text('note').default('').notNull(),
    /** Which of the three forms the PR was written on */
    prType: text('pr_type').$type<PrType>().default('GOODS').notNull(),
    /** Hired work: when it should be finished (needBy is when it starts) */
    workEnd: date('work_end'),
    /** Document header, as on the printed requisition */
    docDate: date('doc_date'),
    /** Wanted on site by */
    needBy: date('need_by'),
    /** Supplier the requester has in mind; the buyer still picks the PO's vendor */
    vendorId: uuid('vendor_id').references(() => vendors.id),
    department: text('department').default('').notNull(),
    requesterName: text('requester_name').default('').notNull(),
    deliveryPlace: text('delivery_place').default('').notNull(),
    paymentTerms: text('payment_terms').default('').notNull(),
    vatMode: text('vat_mode').$type<VatMode>().default('EXCLUSIVE').notNull(),
    billDiscount: numeric('bill_discount', { precision: 14, scale: 2 }).default('0.00').notNull(),
    rejectReason: text('reject_reason'),
    /** The PM's approval of a PR that went on to the owner for being over the BOQ */
    pmApprovedBy: uuid('pm_approved_by').references(() => users.id),
    pmApprovedAt: timestamp('pm_approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('prs_number_idx').on(t.number)],
);

export const prLines = pgTable('pr_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => prs.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id),
  description: text('description').notNull(),
  /** Goods to buy or work to hire; a combined PR has both */
  lineKind: text('line_kind').$type<PrLineKind>().default('GOODS').notNull(),
  // Work category (งานโครงสร้าง, งานสถาปัตยกรรม, …); null on PRs made before categories
  category: text('category'),
  /** Item group under the category (เหล็กเสริม, สายไฟฟ้า, …); null when none was chosen */
  itemGroup: text('item_group'),
  /** The BOQ material line a goods line draws on; its quantity is counted against the BOQ quantity */
  boqLineId: uuid('boq_line_id').references(() => boqLines.id),
  /** A goods line the requester marked as not in the BOQ; it always needs the owner */
  outsideBoq: boolean('outside_boq').default(false).notNull(),
  unitName: text('unit_name').notNull(),
  qty: numeric('qty', { precision: 14, scale: 3 }).notNull(),
  estUnitPrice: numeric('est_unit_price', { precision: 14, scale: 2 }),
  /** Line discount in baht on the estimate */
  discount: numeric('discount', { precision: 14, scale: 2 }).default('0.00').notNull(),
  /** Longer specification under the item name */
  detail: text('detail').default('').notNull(),
  neededDate: date('needed_date'),
  note: text('note').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
