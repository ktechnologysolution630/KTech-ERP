import { pgTable, uuid, text, timestamp, numeric, date, index } from 'drizzle-orm/pg-core';
import { users } from './core';
import { projects } from './master';

export type StockMovementType = 'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'ADJUST' | 'RETURN';
export type StockAdjustStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export const stockItems = pgTable('stock_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').default('ทั่วไป').notNull(),
  unit: text('unit').default('ชิ้น').notNull(),
  unitCost: numeric('unit_cost', { precision: 14, scale: 2 }).default('0').notNull(),
  reorderPoint: numeric('reorder_point', { precision: 14, scale: 2 }).default('0').notNull(),
  imageUrl: text('image_url'),
  notes: text('notes').default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const stockBalances = pgTable('stock_balances', {
  id: uuid('id').defaultRandom().primaryKey(),
  stockItemId: uuid('stock_item_id')
    .notNull()
    .references(() => stockItems.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' }),
  warehouseName: text('warehouse_name').default('คลังหน้างาน').notNull(),
  location: text('location').default('ทั่วไป').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).default('0').notNull(),
  allocatedQty: numeric('allocated_qty', { precision: 14, scale: 3 }).default('0').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  movementNumber: text('movement_number').notNull().unique(),
  stockItemId: uuid('stock_item_id')
    .notNull()
    .references(() => stockItems.id),
  projectId: uuid('project_id')
    .references(() => projects.id),
  type: text('type').$type<StockMovementType>().notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 14, scale: 2 }).default('0').notNull(),
  totalValue: numeric('total_value', { precision: 14, scale: 2 }).default('0').notNull(),
  referenceType: text('reference_type').default('MANUAL').notNull(),
  referenceId: text('reference_id'),
  referenceNumber: text('reference_number'),
  targetProjectId: uuid('target_project_id').references(() => projects.id),
  performedBy: uuid('performed_by')
    .notNull()
    .references(() => users.id),
  locationUsed: text('location_used'),
  notes: text('notes').default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const stockAdjustRequests = pgTable('stock_adjust_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestNumber: text('request_number').notNull().unique(),
  stockItemId: uuid('stock_item_id')
    .notNull()
    .references(() => stockItems.id),
  projectId: uuid('project_id')
    .references(() => projects.id),
  currentQty: numeric('current_qty', { precision: 14, scale: 3 }).notNull(),
  adjustedQty: numeric('adjusted_qty', { precision: 14, scale: 3 }).notNull(),
  differenceQty: numeric('difference_qty', { precision: 14, scale: 3 }).notNull(),
  reason: text('reason').notNull(),
  status: text('status').$type<StockAdjustStatus>().default('PENDING').notNull(),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  notes: text('notes').default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * A stock count: what was physically counted against what the system held at that moment.
 * It is a record only; balances change through an adjustment request (ปรับปรุงยอด).
 */
export const stockCounts = pgTable('stock_counts', {
  id: uuid('id').defaultRandom().primaryKey(),
  countNumber: text('count_number').notNull().unique(),
  countedOn: date('counted_on').notNull(),
  note: text('note').default('').notNull(),
  countedBy: uuid('counted_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const stockCountLines = pgTable(
  'stock_count_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    countId: uuid('count_id')
      .notNull()
      .references(() => stockCounts.id, { onDelete: 'cascade' }),
    stockItemId: uuid('stock_item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'cascade' }),
    /** null = central store */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    systemQty: numeric('system_qty', { precision: 14, scale: 3 }).notNull(),
    countedQty: numeric('counted_qty', { precision: 14, scale: 3 }).notNull(),
    differenceQty: numeric('difference_qty', { precision: 14, scale: 3 }).notNull(),
  },
  (t) => [index('stock_count_lines_count_idx').on(t.countId)],
);
