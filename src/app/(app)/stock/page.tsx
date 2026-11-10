import { getDb } from '@/db/client';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listVendors } from '@/server/services/master';
import { getStockPageData } from '@/server/services/stock';
import { listBoqTreeForStock, listStockDocs } from '@/server/services/stock-docs';
import { StockClient } from './stock-client';

export default async function StockPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [data, vendors, boqTree, docs] = await Promise.all([getStockPageData(db, actor), listVendors(db), listBoqTreeForStock(db, actor), listStockDocs(db, actor)]);
  return (
    <StockClient
      data={data}
      docOptions={{
        vendors: vendors.filter((v) => v.active).map((v) => ({ id: v.id, code: v.code, name: v.name })),
        boqTree,
        docs,
        meName: actor.name,
        today: bangkokDateString(),
      }}
    />
  );
}
