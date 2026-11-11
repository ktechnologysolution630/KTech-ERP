import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { poLines, pos, vendors, type PoStatus } from '@/db/schema';
import { type VatMode } from '@/domain/money';
import { netUnitPrice, priceIncrease, priceKeys, type LastPurchasePrice, type PriceIncrease } from '@/domain/price-history';
import { bangkokDateString } from '@/domain/thai';

/** An order counts as a purchase once it is approved; a draft or one still waiting has bought nothing */
const BOUGHT: PoStatus[] = ['APPROVED', 'ORDERED', 'COMPLETED'];

/**
 * What each thing cost the last time it was bought, newest purchase first, one entry per item and
 * unit. `exceptPoId` leaves out the order being written, and `before` keeps to orders made earlier
 * than it, so an old PO is compared with what came before it and not with what came after.
 */
export async function listLastPurchasePrices(db: Db, opts: { exceptPoId?: string; before?: Date } = {}): Promise<LastPurchasePrice[]> {
  const rows = await db
    .select({
      itemId: poLines.itemId,
      description: poLines.description,
      unitName: poLines.unitName,
      qty: poLines.qty,
      unitPrice: poLines.unitPrice,
      discount: poLines.discount,
      vatMode: pos.vatMode,
      poId: pos.id,
      poNumber: pos.number,
      docDate: pos.docDate,
      createdAt: pos.createdAt,
      vendorName: vendors.name,
    })
    .from(poLines)
    .innerJoin(pos, eq(pos.id, poLines.poId))
    .innerJoin(vendors, eq(vendors.id, pos.vendorId))
    .where(and(inArray(pos.status, BOUGHT), opts.exceptPoId ? ne(pos.id, opts.exceptPoId) : undefined, opts.before ? lt(pos.createdAt, opts.before) : undefined))
    .orderBy(desc(sql`coalesce(${pos.docDate}, (${pos.createdAt} at time zone 'Asia/Bangkok')::date)`), desc(pos.createdAt), desc(poLines.sort));

  const latest: LastPurchasePrice[] = [];
  // Rows come newest first, so only the first sight of an item in a unit is kept
  const seen = new Set<string>();
  for (const r of rows) {
    const price = netUnitPrice(r, r.vatMode);
    // A free sample or a line with no quantity sets no price to compare with
    if (!price) continue;
    const keys = priceKeys(r);
    if (keys.length === 0 || keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    latest.push({
      itemId: r.itemId,
      description: r.description,
      unitName: r.unitName,
      unitPrice: price.toDecimalPlaces(2).toNumber(),
      poId: r.poId,
      poNumber: r.poNumber,
      purchasedOn: r.docDate ?? bangkokDateString(r.createdAt),
      vendorName: r.vendorName,
    });
  }
  return latest;
}

export interface PoPriceIncrease extends PriceIncrease {
  description: string;
  unitName: string;
}

interface PoLineForPrice {
  itemId?: string | null;
  description: string;
  unitName: string;
  qty: string | number;
  unitPrice: string | number;
  discount?: string | number;
}

/** The lines of an order that cost more per unit than the last time the same thing was bought */
export async function listPoPriceIncreases(
  db: Db,
  po: { id: string; vatMode: VatMode; createdAt: Date; lines: PoLineForPrice[] },
): Promise<PoPriceIncrease[]> {
  if (po.lines.length === 0) return [];
  const history = await listLastPurchasePrices(db, { exceptPoId: po.id, before: po.createdAt });
  if (history.length === 0) return [];
  return po.lines.flatMap((l) => {
    const up = priceIncrease(l, po.vatMode, history);
    return up ? [{ ...up, description: l.description, unitName: l.unitName }] : [];
  });
}
