import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { canConvert, kindFromSlug, SALES_DOC_META } from '@/domain/sales-doc';
import { requireUser } from '@/server/auth/current-user';
import { getSalesDoc } from '@/server/services/sales-docs';
import { SalesDocForm } from '../../sales-doc-form';
import { loadSalesFormData } from '../../sales-form-data';
import { salesDocFormInitial } from '../../sales-doc-initial';

/**
 * A new document; with ?from=<id> a tax document issued again, filled from the one it replaces; with
 * ?convert=<id> one converted from a quotation or sales order (QT → SO → TI), filled from it
 */
export default async function NewSalesDocPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ from?: string; convert?: string }> }) {
  const [{ kind: slug }, { from, convert }] = await Promise.all([params, searchParams]);
  const kind = kindFromSlug(slug);
  if (!kind) notFound();
  const actor = await requireUser();
  const db = await getDb();
  const data = await loadSalesFormData(db, actor, kind);

  let replaced: Awaited<ReturnType<typeof getSalesDoc>> | null = null;
  if (from) {
    try {
      replaced = await getSalesDoc(db, actor, from);
    } catch (err) {
      if (err instanceof DomainError && err.status === 404) notFound();
      throw err;
    }
    if (replaced.kind !== kind || replaced.status !== 'ISSUED') notFound();
  }
  let source: Awaited<ReturnType<typeof getSalesDoc>> | null = null;
  if (!from && convert) {
    try {
      source = await getSalesDoc(db, actor, convert);
    } catch (err) {
      if (err instanceof DomainError && err.status === 404) notFound();
      throw err;
    }
    if (!canConvert(source.kind, kind) || source.status !== 'ISSUED') notFound();
  }

  return (
    <SalesDocForm
      {...data}
      initial={replaced ? salesDocFormInitial(replaced) : source ? { ...salesDocFormInitial(source), reference: source.number } : undefined}
      mode={
        replaced
          ? { type: 'reissue', replacesId: replaced.id, number: replaced.number }
          : source
            ? { type: 'convert', sourceId: source.id, number: source.number, sourceLabel: SALES_DOC_META[source.kind].th }
            : { type: 'create' }
      }
    />
  );
}
