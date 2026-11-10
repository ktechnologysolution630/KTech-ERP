import { pgTable, uuid, text, timestamp, numeric, date, index, integer, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { users } from './core';
import { projects, vendors } from './master';
import { boqLines } from './boq';

export type StockMovementType = 'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'ADJUST' | 'RETURN';
/** What a stock document records; BORROW moves stock like a transfer that is expected back */
export type StockDocType = 'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'BORROW';
export type StockIssueKind = 'MATERIAL_ISSUE' | 'RETURN_IN' | 'RETURN_SUPPLIER' | 'DAMAGE_LOSS' | 'OTHER';

/**
 * One stock document (รับเข้า / จ่ายออก / โอนย้าย / ยืม) with its header as on the form;
 * each of its lines is a stock movement pointing back here.
 */
export const stockDocs = pgTable(
  'stock_docs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    number: text('number').notNull().unique(),
    type: text('type').$type<StockDocType>().notNull(),
    docDate: date('doc_date').notNull(),
    docTime: text('doc_time').default('').notNull(),
    /** Receipt: the store received into. Issue / transfer / borrow: the source. null = central store */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Transfer / borrow destination, or where an issue went; null = central store */
    targetProjectId: uuid('target_project_id').references(() => projects.id, { onDelete: 'set null' }),
    warehouseName: text('warehouse_name').default('').notNull(),
    // ---- Receipt
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    supplierName: text('supplier_name').default('').notNull(),
    poNumber: text('po_number').default('').notNull(),
    deliveryNoteNo: text('delivery_note_no').default('').notNull(),
    taxInvoiceNo: text('tax_invoice_no').default('').notNull(),
    taxInvoiceDate: date('tax_invoice_date'),
    receiverName: text('receiver_name').default('').notNull(),
    inspectorName: text('inspector_name').default('').notNull(),
    taxType: text('tax_type').$type<'VAT7' | 'NONE' | 'INCLUSIVE' | 'EXEMPT'>().default('VAT7').notNull(),
    accountingMethod: text('accounting_method').$type<'STOCK' | 'PROJECT_COST' | 'EXPENSE'>().default('STOCK').notNull(),
    accountingStatus: text('accounting_status').$type<'PENDING' | 'AWAITING_TAX_INVOICE' | 'POSTED'>().default('PENDING').notNull(),
    debitAccount: text('debit_account').default('Inventory').notNull(),
    creditAccount: text('credit_account').default('Trade Payables').notNull(),
    payMethod: text('pay_method').$type<'CASH' | 'TRANSFER' | 'CREDIT'>().default('CREDIT').notNull(),
    creditDays: integer('credit_days'),
    // ---- Issue
    issueKind: text('issue_kind').$type<StockIssueKind>(),
    useProjectId: uuid('use_project_id').references(() => projects.id, { onDelete: 'set null' }),
    boqCategoryId: uuid('boq_category_id').references((): AnyPgColumn => boqLines.id, { onDelete: 'set null' }),
    boqLineId: uuid('boq_line_id').references((): AnyPgColumn => boqLines.id, { onDelete: 'set null' }),
    zone: text('zone').default('').notNull(),
    usageNote: text('usage_note').default('').notNull(),
    // ---- Totals of the lines (receipts)
    beforeVat: numeric('before_vat', { precision: 14, scale: 2 }).default('0').notNull(),
    vat: numeric('vat', { precision: 14, scale: 2 }).default('0').notNull(),
    net: numeric('net', { precision: 14, scale: 2 }).default('0').notNull(),
    notes: text('notes').default('').notNull(),
    performedBy: uuid('performed_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('stock_docs_project_idx').on(t.projectId)],
);
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
  /** The stock document this line belongs to; null for movements made before documents or by the system */
  docId: uuid('doc_id').references((): AnyPgColumn => stockDocs.id, { onDelete: 'set null' }),
  /** Receipt lines: price before discount, discount, VAT and extra cost (freight…) in baht */
  listPrice: numeric('list_price', { precision: 14, scale: 2 }),
  discount: numeric('discount', { precision: 14, scale: 2 }).default('0').notNull(),
  vat: numeric('vat', { precision: 14, scale: 2 }).default('0').notNull(),
  extraCost: numeric('extra_cost', { precision: 14, scale: 2 }).default('0').notNull(),
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
