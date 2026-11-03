import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { ADVANCE_STATUS_LABELS, EXPENSE_EVIDENCE_LABELS } from '@/domain/advance';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { getAdvance, listUsableSubstitutes } from '@/server/services/advances';
import { AdvanceActions, RemoveExpenseButton } from './advance-actions';

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function AdvanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();
  let adv: Awaited<ReturnType<typeof getAdvance>>;
  try {
    adv = await getAdvance(db, actor, id);
  } catch (err) {
    if (err instanceof DomainError && err.status === 404) notFound();
    throw err;
  }
  const substitutes = adv.payeeId === actor.id ? await listUsableSubstitutes(db, actor) : [];

  return (
    <div className="space-y-4 text-xs">
      <Link href="/advances" className="text-slate-500 hover:text-slate-800">
        ← เงินทดรองจ่ายทั้งหมด
      </Link>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-mono">{adv.number}</h1>
            <p className="text-slate-600">
              {adv.payeeName} · {adv.projectName ?? 'สำนักงาน'} · ขอวันที่ {adv.requestDate}
              {adv.paidAt && ` · จ่ายวันที่ ${adv.paidAt}`}
            </p>
            <p className="text-slate-800 mt-1">{adv.purpose}</p>
            {adv.decisionNote && <p className="text-red-600">หมายเหตุผู้อนุมัติ: {adv.decisionNote}</p>}
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-semibold">{ADVANCE_STATUS_LABELS[adv.status]}</span>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            ['เงินทดรอง', adv.amount],
            ['ใช้จริง', adv.spent],
            ['คืนเงินสด', adv.returned],
            ['คงค้าง', adv.outstanding],
            ['บริษัทต้องจ่ายเพิ่ม', adv.reimbursable],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-slate-50 p-2">
              <dt className="text-slate-500">{k}</dt>
              <dd className="font-mono font-semibold">{baht(v as number)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <AdvanceActions
        key={`${adv.status}-${adv.outstanding}`}
        advanceId={adv.id}
        status={adv.status}
        isPayee={adv.payeeId === actor.id}
        canClear={adv.canClear}
        permissions={adv.permissions}
        outstanding={adv.outstanding}
        substitutes={substitutes}
      />

      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <h2 className="font-bold text-sm">รายการค่าใช้จ่ายที่เคลียร์</h2>
        {adv.expenses.length === 0 && <p className="text-slate-400">ยังไม่มีรายการ</p>}
        {adv.expenses.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-2 border-b border-slate-50 py-1.5">
            <span className="font-mono">{e.spentOn}</span>
            <span className="font-medium">{e.description}</span>
            <span className="text-slate-500">
              {EXPENSE_EVIDENCE_LABELS[e.evidence]}
              {e.substituteNumber && ` ${e.substituteNumber}`}
              {e.reference && ` · ${e.reference}`}
            </span>
            <span className="ml-auto font-mono">{baht(e.amount)}</span>
            {adv.canClear && <RemoveExpenseButton expenseId={e.id} />}
          </div>
        ))}
      </section>
    </div>
  );
}
