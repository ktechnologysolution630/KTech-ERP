import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listProjects, listVendors } from '@/server/services/master';
import { listOrderablePrLines } from '@/server/services/pr';
import { listBoqMaterialOptions } from '@/server/services/boq-overrun';
import { listLastPurchasePrices } from '@/server/services/price-history';
import { PoForm } from '@/components/po-form';
import { companyHeaderFrom } from '@/components/doc-paper-data';
import { getSettings } from '@/server/services/settings';
import { bangkokDateString } from '@/domain/thai';

export default async function NewPoPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const actor = await requireUser();
  const db = await getDb();
  const params = await searchParams;
  const [projects, vendors, orderable, boqMaterials, settings, lastPrices] = await Promise.all([
    listProjects(db, actor),
    listVendors(db),
    listOrderablePrLines(db, actor),
    listBoqMaterialOptions(db, actor),
    getSettings(db),
    listLastPurchasePrices(db),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">สร้างใบสั่งซื้อ PO</h1>
      <PoForm
        projects={projects}
        vendors={vendors}
        company={companyHeaderFrom(settings)}
        currentUserName={actor.name}
        today={bangkokDateString()}
        initialProjectId={params.projectId}
        boqMaterials={boqMaterials}
        lastPrices={lastPrices}
        orderablePrLines={orderable.map((l) => ({
          id: l.id,
          prNumber: l.prNumber,
          projectId: l.projectId,
          projectCode: l.projectCode,
          description: l.description,
          unitName: l.unitName,
          remainingQty: l.remainingQty.toFixed(3),
          estUnitPrice: l.estUnitPrice,
        }))}
      />
    </div>
  );
}
