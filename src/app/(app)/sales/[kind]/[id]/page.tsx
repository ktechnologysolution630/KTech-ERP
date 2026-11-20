import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { CONVERT_TO, kindFromSlug, SALES_DOC_META } from '@/domain/sales-doc';
import { requireUser } from '@/server/auth/current-user';
import { getSalesDoc, SALES_EDIT_IN_PLACE } from '@/server/services/sales-docs';
import { getSettings } from '@/server/services/settings';
import { getFormTemplates } from '@/server/services/form-templates';
import { labelSigners } from '@/domain/form-templates';
import { companyHeaderFrom } from '@/components/doc-paper-data';
import { SalesDocView } from './sales-doc-view';
import { listAttachments } from '@/server/services/attachments';
import { AttachmentsBox } from '@/components/attachments';
import { salesDocSigners } from '@/server/services/doc-signers';
import { can } from '@/server/policy';
import { DeleteDocButton } from '@/components/bulk-delete';
import { deleteSalesDocsAction } from '@/app/(app)/accounting/delete-actions';

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
  const [settings, attachments, signers, forms] = await Promise.all([
    getSettings(db),
    listAttachments(db, 'SALES_DOC', id),
    salesDocSigners(db, doc),
    getFormTemplates(db),
  ]);
  const text = forms.texts[kind];
  // A quotation or voucher is changed in place; a tax document is corrected by issuing a new one
  const edit =
    doc.status === 'ISSUED' && can(actor, 'ar.manage')
      ? SALES_EDIT_IN_PLACE.includes(kind)
        ? { href: `/sales/${slug}/${doc.id}/edit`, label: 'แก้ไข', hint: 'แก้ไขเอกสารนี้ เลขที่เดิม' }
        : { href: `/sales/${slug}/new?from=${doc.id}`, label: 'แก้ไข (ออกใบใหม่)', hint: `เปิดฟอร์มที่กรอกข้อมูลเดิมไว้ เมื่อบันทึก ${doc.number} จะถูกยกเลิกและออกเลขใหม่แทน` }
      : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/sales/${slug}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> กลับไปหน้า{SALES_DOC_META[kind].th}
        </Link>
        {/* Once cancelled, the owner or admin can remove it for good */}
        {doc.status === 'CANCELLED' && can(actor, 'accounting.delete') && (
          <DeleteDocButton
            action={deleteSalesDocsAction}
            id={doc.id}
            label={doc.number}
            noun={SALES_DOC_META[kind].th}
            hint={`${SALES_DOC_META[kind].th}ที่ยกเลิกแล้วจะถูกลบออกจากระบบ`}
            backTo={`/sales/${slug}?cancelled=1`}
          />
        )}
      </div>
      <DocChain doc={doc} canConvert={doc.status === 'ISSUED' && can(actor, 'ar.manage')} />
      <SalesDocView
        doc={doc}
        slug={slug}
        company={companyHeaderFrom(settings, forms.header)}
        signers={labelSigners(signers, text.signatureLabels)}
        text={text}
        edit={edit}
      />
      <div className="max-w-xl">
        <AttachmentsBox entityType="SALES_DOC" entityId={doc.id} items={attachments} />
      </div>
    </div>
  );
}

/** แปลงเอกสาร: where this document came from, what was made from it, and the next documents it can become */
function DocChain({ doc, canConvert }: { doc: Awaited<ReturnType<typeof getSalesDoc>>; canConvert: boolean }) {
  const targets = canConvert ? (CONVERT_TO[doc.kind] ?? []) : [];
  if (!doc.source && doc.children.length === 0 && targets.length === 0) return null;
  const link = (d: { id: string; kind: keyof typeof SALES_DOC_META; number: string }) => (
    <Link href={`/sales/${SALES_DOC_META[d.kind].slug}/${d.id}`} className="font-mono text-[#2453d4] hover:underline">
      {d.number}
    </Link>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600 print:hidden">
      {doc.source && (
        <span>
          อ้างอิงจาก{SALES_DOC_META[doc.source.kind].th} {link(doc.source)}
        </span>
      )}
      {doc.children.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          เปิดเป็นเอกสารแล้ว:
          {doc.children.map((c) => (
            <span key={c.id} className={c.status === 'CANCELLED' ? 'line-through opacity-60' : ''}>
              {SALES_DOC_META[c.kind].th} {link(c)}
            </span>
          ))}
        </span>
      )}
      {targets.length > 0 && (
        <span className="ml-auto flex flex-wrap gap-2">
          {targets.map((t) => (
            <Link
              key={t}
              href={`/sales/${SALES_DOC_META[t].slug}/new?convert=${doc.id}`}
              className="rounded-lg bg-[#2453d4] px-3 py-1.5 font-semibold text-white hover:bg-[#1c43ab]"
            >
              เปิด{SALES_DOC_META[t].th}จากใบนี้
            </Link>
          ))}
        </span>
      )}
    </div>
  );
}
