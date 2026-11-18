import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { listAdvances, getReceiptSubstitute } from '@/server/services/advances';
import { listProjects } from '@/server/services/master';
import { can } from '@/server/policy';
import { DeleteDocButton } from '@/components/bulk-delete';
import { deleteReceiptSubstitutesAction } from '@/app/(app)/accounting/delete-actions';
import { SubstituteEditor, type SubstituteEditorData } from './substitute-editor';

export default async function ReceiptSubstitutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();

  let doc: SubstituteEditorData | null = null;
  if (id !== 'new') {
    try {
      doc = await getReceiptSubstitute(db, actor, id);
    } catch (err) {
      if (err instanceof DomainError && err.status === 404) notFound();
      throw err;
    }
  }
  const [projects, advanceList] = await Promise.all([listProjects(db, actor), listAdvances(db, actor)]);

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/receipt-substitutes" className="text-slate-500 hover:text-slate-800">
          ← ใบรับรองแทนใบเสร็จทั้งหมด
        </Link>
        {/* Not approved, or cancelled: the owner or admin can remove it for good */}
        {doc && doc.status !== 'APPROVED' && can(actor, 'accounting.delete') && (
          <DeleteDocButton
            action={deleteReceiptSubstitutesAction}
            id={doc.id}
            label={doc.number ?? `ร่าง ${doc.payerName}`}
            noun="ใบรับรองแทนใบเสร็จ"
            hint="ใบรับรองแทนใบเสร็จนี้จะถูกลบออกจากระบบ"
            backTo="/receipt-substitutes"
          />
        )}
      </div>
      <SubstituteEditor
        doc={doc}
        projects={projects.map((p) => ({ id: p.id, label: `${p.code} - ${p.name}` }))}
        advances={advanceList.rows
          .filter((a) => a.payeeId === actor.id && (a.status === 'PAID' || a.status === 'PARTIALLY_CLEARED'))
          .map((a) => ({ id: a.id, label: `${a.number} · ${a.purpose}` }))}
      />
    </div>
  );
}
