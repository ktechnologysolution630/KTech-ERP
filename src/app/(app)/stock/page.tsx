import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { getStockPageData } from '@/server/services/stock';
import { StockClient } from './stock-client';

export default async function StockPage() {
  const actor = await requireUser();
  const db = await getDb();
  const data = await getStockPageData(db, actor);
  return <StockClient data={data} />;
}
