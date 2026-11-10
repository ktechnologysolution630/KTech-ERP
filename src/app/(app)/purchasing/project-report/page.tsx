import Link from 'next/link';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { formatThaiDate } from '@/domain/thai';
import { STATUS_MAP } from '@/components/doc-status-badge';
import { PrintRoot } from '@/components/project-site/report-sheet';
import { requireUser } from '@/server/auth/current-user';
import { listProjects } from '@/server/services/master';
import { getProjectPurchaseReport, type ProjectPurchaseReport } from '@/server/services/project-purchase-report';
import { ReportFilters } from './report-filters';

const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 });
const isoDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

export default async function ProjectPurchaseReportPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; from?: string; to?: string; q?: string }>;
}) {
  const [actor, db, sp] = await Promise.all([requireUser(), getDb(), searchParams]);
  const projects = await listProjects(db, actor);
  const initial = { projectId: sp.projectId ?? '', from: isoDate(sp.from), to: isoDate(sp.to), q: (sp.q ?? '').trim() };

  let report: ProjectPurchaseReport | null = null;
  let error: string | null = null;
  if (initial.projectId) {
    try {
      report = await getProjectPurchaseReport(db, actor, {
        projectId: initial.projectId,
        from: initial.from || null,
        to: initial.to || null,
        q: initial.q,
      });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      error = err.message;
    }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <h1 className="border-b border-slate-200 px-5 py-4 text-lg font-bold text-slate-900">รายงานสรุปการจัดซื้อประจำโครงการ</h1>
        <ReportFilters projects={projects.map((p) => ({ id: p.id, code: p.code, name: p.name }))} initial={initial} hasReport={report !== null} />
        {!report && (
          <div className="bg-slate-50 py-16 text-center text-sm text-slate-500">
            {error ? <span className="font-medium text-red-600">{error}</span> : 'เลือกโครงการและกดสร้างรายงาน'}
          </div>
        )}
      </div>

      {report && (
        <>
          <ReportBody report={report} />
          <PrintRoot>
            <div className="p-2 text-[11px] text-slate-900">
              <h1 className="mb-1 text-base font-bold">รายงานสรุปการจัดซื้อประจำโครงการ</h1>
              <ReportBody report={report} />
            </div>
          </PrintRoot>
        </>
      )}
    </div>
  );
}

function ReportBody({ report }: { report: ProjectPurchaseReport }) {
  const s = report.summary;
  const period =
    report.from || report.to
      ? `${report.from ? formatThaiDate(report.from) : 'เริ่มโครงการ'} – ${report.to ? formatThaiDate(report.to) : 'ปัจจุบัน'}`
      : 'ทั้งหมด';
  const receivedPct = s.amount > 0 ? Math.round((s.receivedAmount / s.amount) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-xs">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">
            {report.project.code} - {report.project.name}
          </h2>
          <span className="text-slate-500">
            ช่วงวันที่: {period}
            {report.q && <> · ค้นหา “{report.q}”</>}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="ใบสั่งซื้อ" value={`${s.poCount.toLocaleString('th-TH')} ใบ`} hint={`${s.lineCount.toLocaleString('th-TH')} รายการ · ${s.vendorCount} ผู้ขาย`} />
          <Stat label="มูลค่าก่อน VAT" value={`฿${money(s.amount)}`} hint={`VAT ฿${money(s.vat)}`} />
          <Stat label="รวมทั้งสิ้น" value={`฿${money(s.gross)}`} />
          <Stat label="รับของแล้ว" value={`฿${money(s.receivedAmount)}`} hint={`${receivedPct}% · ค้างรับ ฿${money(s.outstandingAmount)}`} />
        </div>
      </div>

      {report.pos.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
          ไม่พบใบสั่งซื้อของโครงการนี้{report.from || report.to || report.q ? 'ตามเงื่อนไขที่เลือก' : ''}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SummaryTable
              title="สรุปตามผู้ขาย"
              head={['ผู้ขาย', 'PO', 'มูลค่าก่อน VAT', '%']}
              rows={report.byVendor.map((v) => [v.vendorName, String(v.poCount), money(v.amount), `${v.share}%`])}
            />
            <SummaryTable
              title="สรุปตามหมวดหมู่"
              head={['หมวดหมู่', 'รายการ', 'มูลค่าก่อน VAT', '%']}
              rows={report.byCategory.map((c) => [c.category, String(c.lineCount), money(c.amount), `${c.share}%`])}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <h3 className="border-b border-slate-100 px-4 py-2.5 text-sm font-bold text-slate-900">รายละเอียดใบสั่งซื้อ</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead className="bg-[#102d72] text-white">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">รายการ</th>
                    <th className="px-3 py-2 text-left font-medium">หมวดหมู่</th>
                    <th className="px-3 py-2 text-right font-medium">จำนวน</th>
                    <th className="px-3 py-2 text-right font-medium">ราคา/หน่วย</th>
                    <th className="px-3 py-2 text-right font-medium">รับแล้ว</th>
                    <th className="px-3 py-2 text-right font-medium">มูลค่าก่อน VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {report.pos.map((po) => (
                    <PoRows key={po.id} po={po} />
                  ))}
                  <tr className="bg-slate-100 font-bold">
                    <td colSpan={5} className="px-3 py-2 text-right">
                      รวมก่อน VAT
                    </td>
                    <td className="px-3 py-2 text-right">฿{money(s.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PoRows({ po }: { po: ProjectPurchaseReport['pos'][number] }) {
  const status = STATUS_MAP[po.status];
  return (
    <>
      <tr className="keep-together border-t border-slate-200 bg-slate-50">
        <td colSpan={5} className="px-3 py-2">
          <Link href={`/po/${po.id}`} className="font-mono font-semibold text-[#2453d4] hover:underline">
            {po.number}
          </Link>
          <span className="text-slate-500"> · {formatThaiDate(po.date)} · </span>
          <span className="font-medium">{po.vendorName}</span>
          {status && <span className={`ml-2 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.color}`}>{status.label}</span>}
        </td>
        <td className="px-3 py-2 text-right font-semibold">฿{money(po.amount)}</td>
      </tr>
      {po.lines.map((l, i) => {
        const done = l.qty > 0 && l.receivedQty >= l.qty;
        return (
          <tr key={i} className="border-t border-slate-100">
            <td className="py-1.5 pl-6 pr-3">{l.description}</td>
            <td className="px-3 py-1.5 text-slate-600">{l.category}</td>
            <td className="px-3 py-1.5 text-right">
              {qty(l.qty)} {l.unit}
            </td>
            <td className="px-3 py-1.5 text-right">{money(l.unitPrice)}</td>
            <td className={`px-3 py-1.5 text-right ${done ? 'text-emerald-700' : l.receivedQty > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{qty(l.receivedQty)}</td>
            <td className="px-3 py-1.5 text-right">{money(l.amount)}</td>
          </tr>
        );
      })}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-base font-bold text-slate-900">{value}</div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

function SummaryTable({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <div className="keep-together overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xs">
      <h3 className="border-b border-slate-100 px-4 py-2.5 text-sm font-bold text-slate-900">{title}</h3>
      <table className="w-full">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((cell, i) => (
                <td key={i} className={`px-3 py-1.5 ${i === 0 ? 'text-left' : 'text-right'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
