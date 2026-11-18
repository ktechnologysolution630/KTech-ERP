import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { kindFromSlug } from '@/domain/sales-doc';
import { requireUser } from '@/server/auth/current-user';
import { getSalesDoc, SALES_EDIT_IN_PLACE } from '@/server/services/sales-docs';
import { SalesDocForm } from '../../../sales-doc-form';
import { loadSalesFormData } from '../../../sales-form-data';
import { salesDocFormInitial } from '../../../sales-doc-initial';

/** Changes an issued quotation or voucher in place; a tax document goes to the reissue form instead */
export default async function EditSalesDocPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind: slug, id } = await params;
  const kind = kindFromSlug(slug);
  if (!kind) notFound();
  const actor = await requireUser();
  const db = await getDb();
  let doc: Awaited<ReturnType<typeof getSalesDoc>>;
  try {
    doc = await getSalesDoc(db, actor, id);
  } catch (err) {
    if (err instanceof DomainError && err.status === 404) notFound();
    throw err;
  }
  if (doc.kind !== kind) notFound();
  if (doc.status !== 'ISSUED') redirect(`/sales/${slug}/${id}`);
  if (!SALES_EDIT_IN_PLACE.includes(kind)) redirect(`/sales/${slug}/new?from=${id}`);

  const data = await loadSalesFormData(db, actor, kind);
  return <SalesDocForm {...data} initial={salesDocFormInitial(doc)} mode={{ type: 'edit', id: doc.id, number: doc.number }} />;
}
