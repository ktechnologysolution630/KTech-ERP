import { eq, sql, type SQL } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  advances,
  arInvoices,
  assetInspections,
  assets,
  boqs,
  closeShortRequests,
  dailyReports,
  invoices,
  milestones,
  payables,
  pos,
  projects,
  prs,
  prvs,
  pvs,
  stockDocs,
  salesDocs,
  receipts,
  receiptSubstitutes,
  stockAdjustRequests,
  variationOrders,
  items,
  vendors,
  vehicleTripExpenses,
  vehicleTrips,
  type EntityType,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan, isSiteScopedOnly } from '@/server/policy';

/** `people`: those who may always open it, whatever their project access: the requester and driver of a trip */
type Lookup = { table: PgTable; id: PgColumn; project: SQL | PgColumn; people?: SQL };

const tripPeople = (tripIdColumn: PgColumn) =>
  sql<string[]>`(select array[${vehicleTrips.requestedBy}, ${vehicleTrips.driverId}]::text[] from ${vehicleTrips} where ${vehicleTrips.id} = ${tripIdColumn})`;

/** Project of a PO-linked document, via its PO. */
const viaPo = (poIdColumn: PgColumn) => sql<string | null>`(select ${pos.projectId} from ${pos} where ${pos.id} = ${poIdColumn})`;

const LOOKUPS: Record<EntityType, Lookup> = {
  PROJECT: { table: projects, id: projects.id, project: projects.id },
  PR: { table: prs, id: prs.id, project: prs.projectId },
  PO: { table: pos, id: pos.id, project: pos.projectId },
  RECEIPT: { table: receipts, id: receipts.id, project: viaPo(receipts.poId) },
  INVOICE: { table: invoices, id: invoices.id, project: viaPo(invoices.poId) },
  PAYABLE: { table: payables, id: payables.id, project: viaPo(payables.poId) },
  CLOSE_SHORT: { table: closeShortRequests, id: closeShortRequests.id, project: viaPo(closeShortRequests.poId) },
  PV: { table: pvs, id: pvs.id, project: sql<null>`null` },
  BOQ: { table: boqs, id: boqs.id, project: boqs.projectId },
  MILESTONE: { table: milestones, id: milestones.id, project: milestones.projectId },
  VO: { table: variationOrders, id: variationOrders.id, project: variationOrders.projectId },
  AR_INVOICE: { table: arInvoices, id: arInvoices.id, project: arInvoices.projectId },
  ADVANCE: { table: advances, id: advances.id, project: advances.projectId },
  RECEIPT_SUBSTITUTE: { table: receiptSubstitutes, id: receiptSubstitutes.id, project: receiptSubstitutes.projectId },
  STOCK_ADJUST: { table: stockAdjustRequests, id: stockAdjustRequests.id, project: stockAdjustRequests.projectId },
  PRV: { table: prvs, id: prvs.id, project: prvs.projectId },
  DAILY_REPORT: { table: dailyReports, id: dailyReports.id, project: dailyReports.projectId },
  ASSET: { table: assets, id: assets.id, project: assets.projectId },
  ASSET_INSPECTION: {
    table: assetInspections,
    id: assetInspections.id,
    project: sql<string | null>`(select ${assets.projectId} from ${assets} where ${assets.id} = ${assetInspections.assetId})`,
  },
  VENDOR: { table: vendors, id: vendors.id, project: sql<null>`null` },
  ITEM: { table: items, id: items.id, project: sql<null>`null` },
  STOCK_DOC: { table: stockDocs, id: stockDocs.id, project: stockDocs.projectId },
  SALES_DOC: { table: salesDocs, id: salesDocs.id, project: salesDocs.projectId },
  // Read straight off the row: a subquery on the same table would match every trip
  VEHICLE_TRIP: { table: vehicleTrips, id: vehicleTrips.id, project: vehicleTrips.projectId, people: sql<string[]>`array[${vehicleTrips.requestedBy}, ${vehicleTrips.driverId}]::text[]` },
  VEHICLE_EXPENSE: {
    table: vehicleTripExpenses,
    id: vehicleTripExpenses.id,
    project: sql<string | null>`(select ${vehicleTrips.projectId} from ${vehicleTrips} where ${vehicleTrips.id} = ${vehicleTripExpenses.tripId})`,
    people: tripPeople(vehicleTripExpenses.tripId),
  },
};

export const ENTITY_TYPES = Object.keys(LOOKUPS) as EntityType[];

/**
 * Throws unless the document exists and the actor may see it: documents of a project need
 * project access; documents without a project (office POs, PVs…) are for office roles only.
 * Returns the document's project id.
 */
export async function assertEntityAccess(
  db: Db,
  actor: SessionUser,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  const lookup = (LOOKUPS as Record<string, Lookup | undefined>)[entityType];
  if (!lookup || !z.string().uuid().safeParse(entityId).success) {
    throw new DomainError('NOT_FOUND', 'ไม่พบเอกสาร', 404);
  }
  const [row] = await db
    .select({ projectId: sql<string | null>`${lookup.project}`, people: lookup.people ?? sql<null>`null` })
    .from(lookup.table)
    .where(eq(lookup.id, entityId))
    .limit(1);
  if (!row) throw new DomainError('NOT_FOUND', 'ไม่พบเอกสาร', 404);
  if (Array.isArray(row.people) && row.people.includes(actor.id)) return row.projectId;
  if (row.projectId) {
    assertCan(actor, 'project.view', { projectId: row.projectId });
  } else if (isSiteScopedOnly(actor)) {
    throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงเอกสารนี้', 403);
  }
  return row.projectId;
}
