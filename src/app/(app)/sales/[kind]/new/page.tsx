import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { kindFromSlug } from '@/domain/sales-doc';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { listCustomersForSales } from '@/server/services/sales-docs';
import { getSettings } from '@/server/services/settings';
import { companyHeaderFrom } from '@/components/doc-paper-data';
import { SalesDocForm } from '../../sales-doc-form';

export default async function NewSalesDocPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind: slug } = await params;
  const kind = kindFromSlug(slug);
  if (!kind) notFound();
  const actor = await requireUser();
  const db = await getDb();
  const [customers, projects, settings] = await Promise.all([listCustomersForSales(db, actor), listProjects(db, actor), getSettings(db)]);
  return (
    <SalesDocForm
      kind={kind}
      company={companyHeaderFrom(settings)}
      customers={customers.map((c) => ({ id: c.id, code: c.code, name: c.name, taxId: c.taxId, branch: c.branch, address: c.address, contactName: c.contactName, phone: c.phone, email: c.email }))}
      projects={projects}
      today={bangkokDateString()}
    />
  );
}
