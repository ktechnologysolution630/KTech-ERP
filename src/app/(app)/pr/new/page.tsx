import Link from 'next/link';
import { Hammer, Layers, ShoppingCart } from 'lucide-react';
import { getDb } from '@/db/client';
import { isPrType, PR_TYPE_META, PR_TYPES, type PrType } from '@/domain/pr-type';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listItems, listProjects, listVendors } from '@/server/services/master';
import { listOutstandingPrLines } from '@/server/services/pr-outstanding';
import { getSettings } from '@/server/services/settings';
import { PrForm } from '@/components/pr-form';
import { companyHeaderFrom, vendorRefsFrom } from '@/components/doc-paper-data';

const ICON: Record<PrType, React.ReactNode> = {
  GOODS: <ShoppingCart className="h-5 w-5" />,
  LABOR: <Hammer className="h-5 w-5" />,
  GOODS_AND_LABOR: <Layers className="h-5 w-5" />,
};

export default async function NewPrPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const sp = await searchParams;
  const prType: PrType = isPrType(sp.type) ? sp.type : 'GOODS';
  const actor = await requireUser();
  const db = await getDb();
  const [projects, items, vendors, settings, outstanding] = await Promise.all([listProjects(db, actor), listItems(db), listVendors(db), getSettings(db), listOutstandingPrLines(db, actor)]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">สร้างใบขอซื้อ PR</h1>
      <nav aria-label="เลือกแบบฟอร์ม" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {PR_TYPES.map((t) => {
          const on = t === prType;
          return (
            <Link
              key={t}
              href={`/pr/new?type=${t}`}
              aria-current={on ? 'page' : undefined}
              className={`flex items-start gap-3 rounded-xl border p-3 transition ${on ? 'border-[#2453d4] bg-blue-50 ring-1 ring-[#2453d4]' : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <span className={`rounded-lg p-2 ${on ? 'bg-[#2453d4] text-white' : 'bg-slate-100 text-slate-500'}`}>{ICON[t]}</span>
              <span>
                <span className={`block text-sm font-bold ${on ? 'text-[#2453d4]' : 'text-slate-900'}`}>{PR_TYPE_META[t].label}</span>
                <span className="block text-xs text-slate-500">{PR_TYPE_META[t].hint}</span>
              </span>
            </Link>
          );
        })}
      </nav>
      {/* The key starts a clean form when another form is chosen */}
      <PrForm
        key={prType}
        prType={prType}
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
