import { type Db } from '@/db/client';
import { type SessionUser } from '@/db/schema';
import { categoryOptions, type SalesDocKind } from '@/domain/sales-doc';
import { bangkokDateString } from '@/domain/thai';
import { listAccountCategories } from '@/server/services/account-categories';
import { getFormTemplates } from '@/server/services/form-templates';
import { listProjects } from '@/server/services/master';
import { listCompanyAccounts, listCustomersForSales, listVendorsForSales } from '@/server/services/sales-docs';
import { getSettings } from '@/server/services/settings';
import { companyHeaderFrom } from '@/components/doc-paper-data';

/** Everything the sales form needs besides the document itself, for the new and edit pages alike */
export async function loadSalesFormData(db: Db, actor: SessionUser, kind: SalesDocKind) {
  const [customers, projects, settings, vendors, accounts, categories, forms] = await Promise.all([
    listCustomersForSales(db, actor),
    listProjects(db, actor),
    getSettings(db),
    kind === 'EXP' ? listVendorsForSales(db, actor) : Promise.resolve([]),
    listCompanyAccounts(db, actor),
    listAccountCategories(db, actor, { types: [kind === 'EXP' ? 'EXPENSE' : 'INCOME'], activeOnly: true }),
    getFormTemplates(db),
  ]);
  return {
    kind,
    company: companyHeaderFrom(settings, forms.header),
    forms: { [kind]: forms.texts[kind] },
    customers: customers.map((c) => ({ id: c.id, code: c.code, name: c.name, taxId: c.taxId, branch: c.branch, address: c.address, contactName: c.contactName, phone: c.phone, email: c.email })),
    vendors: vendors.map((v) => ({ id: v.id, code: v.code, name: v.name, taxId: v.taxId, branch: v.branch, address: v.address, contactName: v.contactPerson, phone: v.phone, email: v.email })),
    accounts: accounts
      .filter((a) => a.active)
      .map((a) => ({ id: a.id, label: `${a.bank} ${a.accountNo} (${a.accountName})`, isDefaultReceive: a.isDefaultReceive, isDefaultPay: a.isDefaultPay })),
    categories: categoryOptions(categories),
    projects,
    today: bangkokDateString(),
  };
}
