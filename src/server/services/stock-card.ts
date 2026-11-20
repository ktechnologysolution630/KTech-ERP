import { asc, eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { projects, stockDocs, stockItems, stockMovements, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { buildStockCard, type CardLocation, type CardMovement } from '@/domain/stock-card';
import { bangkokDateString } from '@/domain/thai';
import { isSiteScopedOnly } from '@/server/policy';
import { CENTRAL_STORE } from './stock';

/** A store the card can be read for: the central store (projectId null) or a project's store */
export interface CardStore {
  key: string;
  projectId: string | null;
  name: string;
}

export const CENTRAL_KEY = 'central';
export const ALL_KEY = 'all';

/** The stores this person may see; site staff see the central store and their own projects only */
export async function cardStores(db: Db, actor: SessionUser): Promise<CardStore[]> {
  const scoped = isSiteScopedOnly(actor);
  const projectRows = await db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).orderBy(projects.code);
  return [
    { key: CENTRAL_KEY, projectId: null, name: CENTRAL_STORE },
    ...projectRows.filter((p) => !scoped || actor.projectIds.includes(p.id)).map((p) => ({ key: p.id, projectId: p.id, name: `คลัง ${p.code} ${p.name}` })),
  ];
}

export async function listCardItems(db: Db) {
  return db.select({ id: stockItems.id, sku: stockItems.sku, name: stockItems.name, unit: stockItems.unit }).from(stockItems).orderBy(stockItems.sku);
}

/**
 * สมุดคุมสต็อก of one item at one store (or all stores together) between two dates, with the
 * balance brought forward, valued at moving average cost.
 */
export async function getStockCard(db: Db, actor: SessionUser, input: { stockItemId: string; store: string; from: string; to: string }) {
  const stores = await cardStores(db, actor);
  let at: CardLocation;
  let storeName: string;
  if (input.store === ALL_KEY) {
    if (isSiteScopedOnly(actor)) throw new DomainError('FORBIDDEN', 'ดูได้เฉพาะคลังของโครงการที่รับผิดชอบ', 403);
    at = 'ALL';
    storeName = 'ทุกคลัง';
  } else {
    const store = stores.find((s) => s.key === input.store);
    if (!store) throw new DomainError('FORBIDDEN', 'ไม่มีสิทธิ์ดูคลังนี้', 403);
    at = store.projectId;
    storeName = store.name;
  }
  const [item] = await db.select().from(stockItems).where(eq(stockItems.id, input.stockItemId));
  if (!item) throw new DomainError('NOT_FOUND', 'ไม่พบรายการสินค้า', 404);

  // Every movement of the item; the card picks out what touched this store
  const rows = await db
    .select({ m: stockMovements, docDate: stockDocs.docDate, docNumber: stockDocs.number })
    .from(stockMovements)
    .leftJoin(stockDocs, eq(stockDocs.id, stockMovements.docId))
    .where(eq(stockMovements.stockItemId, item.id))
    .orderBy(asc(stockMovements.createdAt));

  const movements: (CardMovement & { at: number })[] = rows
    .map(({ m, docDate, docNumber }) => ({
      id: m.id,
      date: docDate ?? bangkokDateString(m.createdAt),
      number: docNumber ?? m.movementNumber,
      reference: m.referenceNumber ?? '',
      type: m.type,
      quantity: Number(m.quantity),
      unitCost: Number(m.unitCost),
      projectId: m.projectId,
      targetProjectId: m.targetProjectId,
      notes: m.notes ?? '',
      at: m.createdAt.getTime(),
    }))
    .filter((m) => m.date <= input.to)
    .sort((a, b) => (a.date === b.date ? a.at - b.at : a.date < b.date ? -1 : 1));
  const card = buildStockCard(movements, at, input.from);
  return { item: { id: item.id, sku: item.sku, name: item.name, unit: item.unit, avgCost: Number(item.unitCost) }, storeName, ...card };
}
