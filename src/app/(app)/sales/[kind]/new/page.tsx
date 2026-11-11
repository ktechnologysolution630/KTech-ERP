import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { categoryOptions, kindFromSlug } from '@/domain/sales-doc';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { listCompanyAccounts, listCustomersForSales, listVendorsForSales } from '@/server/services/sales-docs';
import { getSettings } from '@/server/services/settings';
import { listAccountCategories } from '@/server/services/account-categories';
import { companyHeaderFrom } from '@/components/doc-paper-data';
import { SalesDocForm } from '../../sales-doc-form';

export default async function NewSalesDocPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind: slug } = await params;
  const kind = kindFromSlug(slug);
  if (!kind) notFound();
  const actor = await requireUser();
  const db = await getDb();
  const [customers, projects, settings, vendors, accounts, categories] = await Promise.all([
    listCustomersForSales(db, actor),
    listProjects(db, actor),
    getSettings(db),
    kind === 'EXP' ? listVendorsForSales(db, actor) : Promise.resolve([]),
    listCompanyAccounts(db, actor),
    listAccountCategories(db, actor, { types: [kind === 'EXP' ? 'EXPENSE' : 'INCOME'], activeOnly: true }),
  ]);
  return (
    <SalesDocForm
      kind={kind}
      company={companyHeaderFrom(settings)}
      customers={customers.map((c) => ({ id: c.id, code: c.code, name: c.name, taxId: c.taxId, branch: c.branch, address: c.address, contactName: c.contactName, phone: c.phone, email: c.email }))}
      vendors={vendors.map((v) => ({ id: v.id, code: v.code, name: v.name, taxId: v.taxId, branch: v.branch, address: v.address, contactName: v.contactPerson, phone: v.phone, email: v.email }))}
      accounts={accounts.filter((a) => a.active).map((a) => ({ id: a.id, label: `${a.bank} ${a.accountNo} (${a.accountName})`, isDefaultReceive: a.isDefaultReceive, isDefaultPay: a.isDefaultPay }))}
      categories={categoryOptions(categories)}
      projects={projects}
      today={bangkokDateString()}
    />
  );
}
