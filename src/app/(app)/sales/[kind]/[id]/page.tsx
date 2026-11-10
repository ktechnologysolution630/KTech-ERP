import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { kindFromSlug, SALES_DOC_META } from '@/domain/sales-doc';
import { requireUser } from '@/server/auth/current-user';
import { getSalesDoc } from '@/server/services/sales-docs';
import { getSettings } from '@/server/services/settings';
import { companyHeaderFrom } from '@/components/doc-paper-data';
import { SalesDocView } from './sales-doc-view';

export default async function SalesDocPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
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
  const settings = await getSettings(db);

  return (
    <div className="space-y-4">
      <Link href={`/sales/${slug}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> กลับไปหน้า{SALES_DOC_META[kind].th}
      </Link>
      <SalesDocView doc={doc} slug={slug} company={companyHeaderFrom(settings)} />
    </div>
  );
}
