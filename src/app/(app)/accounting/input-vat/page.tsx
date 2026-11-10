import Link from 'next/link';
import { getDb } from '@/db/client';
import { bangkokDateString, formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { inputVatReport } from '@/server/services/accounting';
import { getSettings } from '@/server/services/settings';
import { PrintRoot } from '@/components/project-site/report-sheet';
import { PrintButton } from '../print-button';
import { money, MonthYearFields, periodOf, Stat, THAI_MONTHS, yearsAround } from '../shared';

export default async function InputVatPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const { year, month } = periodOf(sp, bangkokDateString());
  const [r, settings] = await Promise.all([inputVatReport(db, actor, year, month), getSettings(db)]);
  const period = `${THAI_MONTHS[month - 1]} ${year + 543}`;

  const table = (
    <table className="w-full min-w-[900px] border-collapse text-xs">
      <thead className="bg-[#102d72] text-white">
        <tr>
          {['ลำดับ', 'วันที่', 'เลขที่เอกสาร', 'ผู้ขาย', 'เลขผู้เสียภาษี', 'โครงการ', 'ฐานภาษี', 'VAT', 'ยอดรวม', 'ที่มา'].map((h) => (
            <th key={h} className={`border border-[#102d72] px-2 py-2 font-medium ${['ฐานภาษี', 'VAT', 'ยอดรวม'].includes(h) ? 'text-right' : 'text-left'}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {r.rows.length === 0 ? (
          <tr>
            <td colSpan={10} className="py-10 text-center text-slate-400">
              ยังไม่มีข้อมูลภาษีซื้อ
            </td>
          </tr>
        ) : (
          r.rows.map((x, i) => (
            <tr key={x.key} className="border-b border-slate-100">
              <td className="px-2 py-1.5">{i + 1}</td>
              <td className="px-2 py-1.5">{formatThaiDate(x.date)}</td>
              <td className="px-2 py-1.5 font-mono">
                <Link href={x.href} className="text-[#2453d4] hover:underline">
                  {x.number}
                </Link>
              </td>
              <td className="px-2 py-1.5">{x.vendorName}</td>
              <td className="px-2 py-1.5 font-mono">{x.vendorTaxId || '-'}</td>
              <td className="px-2 py-1.5 text-slate-600">{x.projectName}</td>
              <td className="px-2 py-1.5 text-right">{money(x.base)}</td>
              <td className="px-2 py-1.5 text-right">{money(x.vat)}</td>
              <td className="px-2 py-1.5 text-right">{money(x.total)}</td>
              <td className="px-2 py-1.5 text-slate-500">{x.source}</td>
            </tr>
          ))
        )}
      </tbody>
      <tfoot className="bg-slate-50 font-semibold">
        <tr>
          <td colSpan={6} className="px-2 py-2 text-right">
            รวม
          </td>
          <td className="px-2 py-2 text-right">{money(r.totalBase)}</td>
          <td className="px-2 py-2 text-right">{money(r.totalVat)}</td>
          <td className="px-2 py-2 text-right">{money(r.totalBase + r.totalVat)}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ภาษีซื้อ</h1>
          <p className="text-xs text-slate-500">รวบรวม VAT จากใบกำกับภาษีตามใบสั่งซื้อ ใบสำคัญจ่าย และการรับเข้าสต็อกที่มีใบกำกับภาษี</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex items-center gap-2">
            <MonthYearFields year={year} month={month} years={yearsAround(year)} />
            <button className="rounded-lg bg-[#2453d4] px-3 py-2 text-xs font-semibold text-white">แสดง</button>
          </form>
          <a href={`/api/export/purchase-vat?year=${year}&month=${month}`} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            Excel
          </a>
          <PrintButton />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="จำนวนเอกสาร" value={String(r.rows.length)} />
        <Stat label="รวมฐานภาษี" value={money(r.totalBase)} />
        <Stat label="รวมภาษีซื้อ" value={money(r.totalVat)} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">{table}</div>
      <p className="text-[11px] text-slate-400">ไฟล์ Excel ใช้รูปแบบเดิมสำหรับส่งสำนักงานบัญชี (ใบกำกับภาษีตามใบสั่งซื้อ)</p>
      <PrintRoot>
        <div className="a4-page p-6 text-xs">
          <p className="text-base font-bold">รายงานภาษีซื้อ</p>
          <p>
            {settings.companyName} · เลขประจำตัวผู้เสียภาษี {settings.companyTaxId} · ประจำเดือน {period}
          </p>
          <div className="mt-3">{table}</div>
        </div>
      </PrintRoot>
    </div>
  );
}
