import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plus } from 'lucide-react';
import { getDb } from '@/db/client';
import { formatMoneyDisplay } from '@/domain/money';
import { kindFromSlug, SALES_DOC_META } from '@/domain/sales-doc';
import { formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listSalesDocs } from '@/server/services/sales-docs';

export default async function SalesDocListPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ cancelled?: string }> }) {
  const { kind: slug } = await params;
  const sp = await searchParams;
  const kind = kindFromSlug(slug);
  if (!kind) notFound();
  const meta = SALES_DOC_META[kind];
  const actor = await requireUser();
  const db = await getDb();
  const showCancelled = sp.cancelled === '1';
  const docs = await listSalesDocs(db, actor, kind, { includeCancelled: showCancelled });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{meta.th}</h1>
          <p className="text-xs text-slate-500">{meta.hint}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={showCancelled ? `/sales/${slug}` : `/sales/${slug}?cancelled=1`}
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${showCancelled ? 'border-[#2453d4] bg-blue-50 text-[#2453d4]' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            เอกสารที่ยกเลิก
          </Link>
          <Link href={`/sales/${slug}/new`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1c43ab]">
            <Plus className="h-4 w-4" /> สร้างเอกสาร
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-[#102d72] text-white">
            <tr>
              {['เลขที่', 'วันที่', kind === 'QT' ? 'ครบกำหนด' : 'อ้างอิง', 'ลูกค้า', 'โครงการ', 'ยอดรวม', 'สุทธิ', 'สถานะ'].map((h) => (
                <th key={h} className={`px-3 py-2.5 font-medium ${h === 'ยอดรวม' || h === 'สุทธิ' ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {docs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">
                  ไม่มีรายการ
                </td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5">
                    <Link href={`/sales/${slug}/${d.id}`} className="font-mono font-semibold text-[#2453d4] hover:underline">
                      {d.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">{formatThaiDate(d.docDate)}</td>
                  <td className="px-3 py-2.5 text-slate-600">{kind === 'QT' ? (d.dueDate ? formatThaiDate(d.dueDate) : '-') : d.reference || '-'}</td>
                  <td className="px-3 py-2.5">{d.customerName || '-'}</td>
                  <td className="px-3 py-2.5 text-slate-600">{d.projectLabel || '-'}</td>
                  <td className="px-3 py-2.5 text-right">฿{formatMoneyDisplay(d.total)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">฿{formatMoneyDisplay(d.payable)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${d.status === 'ISSUED' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                      {d.status === 'ISSUED' ? 'ออกแล้ว' : 'ยกเลิก'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
