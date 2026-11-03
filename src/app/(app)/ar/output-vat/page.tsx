import { toBangkok } from '@/domain/thai';
import { outputVatReport } from '@/server/services/ar';
import { baht, requireArUser } from '../ar-guard';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export default async function OutputVatPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const sp = await searchParams;
  const { actor, db } = await requireArUser();
  const now = toBangkok(new Date());
  const year = Number(sp.year) || now.getUTCFullYear();
  const month = Math.min(12, Math.max(1, Number(sp.month) || now.getUTCMonth() + 1));
  const report = await outputVatReport(db, actor, year, month);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">รายงานภาษีขาย</h1>
          <p className="text-xs text-slate-500">จากใบเสร็จรับเงิน/ใบกำกับภาษีที่ออกจริงในเดือน (จุดความรับผิดชอบเมื่อได้รับชำระ)</p>
        </div>
        <form method="get" className="flex gap-2 text-xs">
          <select name="month" defaultValue={month} aria-label="เดือน" className="px-2 py-1.5 border border-slate-200 rounded-lg">
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select name="year" defaultValue={year} aria-label="ปี" className="px-2 py-1.5 border border-slate-200 rounded-lg">
            {[year - 2, year - 1, year, year + 1].map((y) => (
              <option key={y} value={y}>
                {y + 543}
              </option>
            ))}
          </select>
          <button type="submit" className="px-3 py-1.5 rounded-lg bg-[#2453d4] text-white">แสดง</button>
        </form>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-slate-500">จำนวนเอกสาร</div>
          <div className="font-mono font-bold text-base">{report.rows.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-slate-500">รวมฐานภาษี</div>
          <div className="font-mono font-bold text-base">{baht(report.totalBase)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-slate-500">รวมภาษีขาย</div>
          <div className="font-mono font-bold text-base text-[#2453d4]">{baht(report.totalVat)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
        <table className="w-full text-xs min-w-[860px]">
          <thead className="bg-[#102d72] text-white">
            <tr>
              <th className="px-3 py-2 text-left">วันที่</th>
              <th className="px-3 py-2 text-left">เลขที่เอกสาร</th>
              <th className="px-3 py-2 text-left">ลูกค้า</th>
              <th className="px-3 py-2 text-left">เลขผู้เสียภาษี / สาขา</th>
              <th className="px-3 py-2 text-left">โครงการ</th>
              <th className="px-3 py-2 text-right">ฐานภาษี</th>
              <th className="px-3 py-2 text-right">VAT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">ยังไม่มีข้อมูลภาษีขายในเดือนนี้</td>
              </tr>
            )}
            {report.rows.map((r) => (
              <tr key={r.number}>
                <td className="px-3 py-2 font-mono">{r.date}</td>
                <td className="px-3 py-2 font-mono">{r.number}</td>
                <td className="px-3 py-2">{r.customerName}</td>
                <td className="px-3 py-2 font-mono">
                  {r.customerTaxId ?? '-'} / {r.customerBranch}
                </td>
                <td className="px-3 py-2">{r.projectName ?? '-'}</td>
                <td className="px-3 py-2 text-right font-mono">{baht(r.beforeVat)}</td>
                <td className="px-3 py-2 text-right font-mono">{baht(r.vat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
