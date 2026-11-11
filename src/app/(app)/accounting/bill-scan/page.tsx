import { getDb } from '@/db/client';
import { categoryOptions, EXPENSE_CATEGORIES } from '@/domain/sales-doc';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listAccountCategories } from '@/server/services/account-categories';
import { listProjects } from '@/server/services/master';
import { listCompanyAccounts, listVendorsForSales } from '@/server/services/sales-docs';
import { getSettings } from '@/server/services/settings';
import { BillScanClient } from './bill-scan-client';

export default async function BillScanPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [vendors, projects, accounts, categories, settings] = await Promise.all([
    listVendorsForSales(db, actor),
    listProjects(db, actor),
    listCompanyAccounts(db, actor),
    listAccountCategories(db, actor, { types: ['EXPENSE'], activeOnly: true }),
    getSettings(db),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">สแกนบิล</h1>
        <p className="text-xs text-slate-500">อ่านรูปบิลหรือ PDF แล้วตรวจสอบก่อนบันทึกเป็นรายจ่าย ไม่จำกัดจำนวนบิลต่อเดือน</p>
      </div>
      <BillScanClient
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, taxId: v.taxId }))}
        projects={projects}
        accounts={accounts.filter((a) => a.active).map((a) => ({ id: a.id, label: `${a.bank} ${a.accountNo}`, isDefaultPay: a.isDefaultPay }))}
        categories={categories.length > 0 ? categoryOptions(categories) : EXPENSE_CATEGORIES.map((label) => ({ label }))}
        ownTaxId={settings.companyTaxId}
        ownName={settings.companyName}
        today={bangkokDateString()}
      />
    </div>
  );
}
