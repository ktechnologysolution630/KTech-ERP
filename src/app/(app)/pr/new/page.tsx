import { getDb } from '@/db/client';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listItems, listProjects, listVendors } from '@/server/services/master';
import { listOutstandingPrLines } from '@/server/services/pr-outstanding';
import { getSettings } from '@/server/services/settings';
import { PrForm } from '@/components/pr-form';
import { companyHeaderFrom, vendorRefsFrom } from '@/components/doc-paper-data';

export default async function NewPrPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [projects, items, vendors, settings, outstanding] = await Promise.all([listProjects(db, actor), listItems(db), listVendors(db), getSettings(db), listOutstandingPrLines(db, actor)]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">สร้างใบขอซื้อ PR</h1>
      <PrForm
        projects={projects}
        items={items}
        vendors={vendorRefsFrom(vendors)}
        company={companyHeaderFrom(settings)}
        currentUserName={actor.name}
        today={bangkokDateString()}
        outstanding={outstanding}
      />
    </div>
  );
}
