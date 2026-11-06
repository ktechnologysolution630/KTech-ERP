import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listVendors } from '@/server/services/master';
import { listPos } from '@/server/services/po';
import { PurchasingVendorsClient } from './vendors-client';

export default async function PurchasingVendorsPage() {
  const actor = await requireUser();
  const db = await getDb();

  const [vendors, pos] = await Promise.all([
    listVendors(db),
    listPos(db, actor, {}),
  ]);

  const vendorStats = vendors.map((v) => {
    const vPos = pos.filter((p) => p.vendorId === v.id);
    const totalPurchases = vPos.reduce((sum, p) => sum + Number(p.gross || 0), 0);
    const openPos = vPos.filter((p) => p.status === 'APPROVED' || p.status === 'ORDERED').length;

    return {
      id: v.id,
      code: v.code,
      name: v.name,
      contactPerson: v.taxId ? `Tax ID: ${v.taxId}` : '-',
      creditDays: v.defaultCreditDays ? `${v.defaultCreditDays} วัน` : 'เงินสด / ตามงวด',
      deliveryDays: '3-7 วัน',
      totalPurchases,
      docCount: vPos.length,
      openPosCount: openPos,
    };
  });

  return <PurchasingVendorsClient initialVendors={vendorStats} canImport={can(actor, 'master.manage')} />;
}