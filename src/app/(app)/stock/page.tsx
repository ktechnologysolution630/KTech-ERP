import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import {
  getStockOverview,
  getAllStockItems,
  listRecentAdjustRequests,
} from '@/server/services/stock';
import { listProjectOptions, listUserNameOptions } from '@/server/services/lookups';
import { StockClient } from './stock-client';

export default async function StockPage() {
  const user = await requireUser();

  const db = await getDb();
  const overview = await getStockOverview(db);
  const allItems = await getAllStockItems(db);
  const allProjects = await listProjectOptions(db);
  const rawAdjustRequests = await listRecentAdjustRequests(db, 30);
  const allUsers = await listUserNameOptions(db);

  const userMap = new Map(allUsers.map((u) => [u.id, u.name]));
  const projectMap = new Map(allProjects.map((p) => [p.id, p.name]));
  const itemMap = new Map(allItems.map((i) => [i.id, i]));

  const adjustRequests = rawAdjustRequests.map((r) => ({
    id: r.id,
    requestNumber: r.requestNumber,
    sku: itemMap.get(r.stockItemId)?.sku || '-',
    itemName: itemMap.get(r.stockItemId)?.name || '-',
    projectName: r.projectId ? projectMap.get(r.projectId) || 'โครงการ' : 'คลังกลาง',
    currentQty: Number(r.currentQty),
    adjustedQty: Number(r.adjustedQty),
    differenceQty: Number(r.differenceQty),
    reason: r.reason,
    status: r.status,
    requestedByName: userMap.get(r.requestedBy) || '-',
    createdAt: r.createdAt,
  }));

  return (
    <StockClient
      overview={overview}
      allItems={allItems}
      projects={allProjects}
      adjustRequests={adjustRequests}
      userRoles={user.roles}
    />
  );
}
