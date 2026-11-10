import Link from 'next/link';
import { getDb } from '@/db/client';
import { bangkokDateString, formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listLedger } from '@/server/services/accounting';
import { listProjects } from '@/server/services/master';
import { getSettings } from '@/server/services/settings';
import { PrintRoot } from '@/components/project-site/report-sheet';
import { PrintButton } from '../print-button';
import { money, MonthYearFields, periodOf, selectCls, THAI_MONTHS, yearsAround } from '../shared';

type Sp = { year?: string; month?: string; projectId?: string; type?: string; party?: string; view?: string };

export default async function AccountingReportsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const today = bangkokDateString();
  const { year, month } = periodOf(sp, today);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const view = sp.view === 'OUT' ? 'OUT' : 'IN';
  const projectId = sp.projectId === 'OFFICE' ? null : sp.projectId || undefined;
  const [ledger, projects, settings] = await Promise.all([listLedger(db, actor, { from, to, projectId }), listProjects(db, actor), getSettings(db)]);
  const ofView = ledger.filter((r) => r.direction === view);
  const types = [...new Set(ofView.map((r) => r.docType))];
  const parties = [...new Set(ofView.map((r) => r.party).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  const rows = ofView.filter((r) => (!sp.type || r.docType === sp.type) && (!sp.party || r.party === sp.party)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const tot = rows.reduce((a, r) => ({ net: a.net + r.net, base: a.base + r.beforeVat, vat: a.vat + r.vat, wht: a.wht + r.wht }), { net: 0, base: 0, vat: 0, wht: 0 });
  const title = view === 'IN' ? 'รายงานการขาย' : 'รายงานรายจ่าย';
  const keep = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>), ...extra })}`;

  const report = (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="text-base font-bold">{title}</p>
          <p className="text-[10px] tracking-widest text-slate-500">{view === 'IN' ? 'ACCOUNTING SALES REPORT' : 'ACCOUNTING EXPENSE REPORT'}</p>
        </div>
        <div className="text-right">
          <p>{settings.companyName}</p>
          <p>
            ประจำเดือน {THAI_MONTHS[month - 1]} {year + 543} · โครงการ {projectId === undefined ? 'รวมทั้งหมด' : projectId === null ? 'สำนักงาน / ส่วนกลาง' : (projects.find((p) => p.id === projectId)?.name ?? '-')}
          </p>
          <p>จำนวนรายการ {rows.length} รายการ</p>
        </div>
      </div>
      <table className="w-full min-w-[1000px] border-collapse">
        <thead className="bg-[#102d72] text-white">
          <tr>
            {['วันที่', 'เลขที่', 'ประเภทเอกสาร', 'โครงการ', view === 'IN' ? 'ลูกค้า' : 'ผู้ขาย / ผู้รับเงิน', 'หมวด', view === 'IN' ? 'ยอดรับสุทธิ' : 'ยอดจ่ายสุทธิ', 'ฐาน VAT', 'VAT 7%', 'ยอด WHT'].map((h) => (
              <th key={h} className={`border border-[#102d72] px-2 py-2 font-medium ${['ยอดรับสุทธิ', 'ยอดจ่ายสุทธิ', 'ฐาน VAT', 'VAT 7%', 'ยอด WHT'].includes(h) ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={10} className="py-8 text-center text-slate-400">
                ไม่มีรายการในเดือนนี้
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-100">
                <td className="px-2 py-1.5">{formatThaiDate(r.date)}</td>
                <td className="px-2 py-1.5 font-mono">
                  <Link href={r.href} className="text-[#2453d4] hover:underline">
                    {r.number}
                  </Link>
                </td>
                <td className="px-2 py-1.5">{r.docType}</td>
                <td className="px-2 py-1.5">{r.projectName}</td>
                <td className="px-2 py-1.5">{r.party || '-'}</td>
                <td className="px-2 py-1.5 text-slate-500">{r.category}</td>
                <td className="px-2 py-1.5 text-right">{money(r.net)}</td>
                <td className="px-2 py-1.5 text-right">{money(r.beforeVat)}</td>
                <td className="px-2 py-1.5 text-right">{money(r.vat)}</td>
                <td className="px-2 py-1.5 text-right">{r.wht ? money(r.wht) : '-'}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot className="bg-slate-50 font-semibold">
          <tr>
            <td colSpan={6} className="px-2 py-2 text-right">
              รวม
            </td>
            <td className="px-2 py-2 text-right">{money(tot.net)}</td>
            <td className="px-2 py-2 text-right">{money(tot.base)}</td>
            <td className="px-2 py-2 text-right">{money(tot.vat)}</td>
            <td className="px-2 py-2 text-right">{money(tot.wht)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">รายงานบัญชี</h1>
          <p className="text-xs text-slate-500">รายงานรายรับ รายจ่าย ภาษีขาย ภาษีซื้อ และยอดหัก ณ ที่จ่ายจากเอกสารบัญชี</p>
        </div>
        <PrintButton label="พิมพ์ A4 / PDF" />
      </div>
      <form className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <input type="hidden" name="view" value={view} />
        <select name="projectId" defaultValue={sp.projectId ?? ''} aria-label="โครงการ" className={selectCls}>
          <option value="">รวมทั้งหมด</option>
          <option value="OFFICE">สำนักงาน / ส่วนกลาง</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} {p.name}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={sp.type ?? ''} aria-label="ประเภทเอกสาร" className={selectCls}>
          <option value="">ประเภทเอกสารทั้งหมด</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select name="party" defaultValue={sp.party ?? ''} aria-label="คู่ค้า" className={`${selectCls} max-w-56`}>
          <option value="">{view === 'IN' ? 'ลูกค้าทั้งหมด' : 'ผู้ขายทั้งหมด'}</option>
          {parties.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <MonthYearFields year={year} month={month} years={yearsAround(year)} />
        <button className="rounded-lg bg-[#2453d4] px-3 py-2 text-xs font-semibold text-white">แสดง</button>
      </form>
      <div className="flex gap-1 text-xs">
        {(
          [
            ['IN', 'รายงานการขาย'],
            ['OUT', 'รายงานรายจ่าย'],
          ] as const
        ).map(([k, l]) => (
          <Link key={k} href={keep({ view: k, type: '', party: '' })} className={`rounded-lg px-3 py-1.5 ${view === k ? 'bg-[#2453d4] text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
            {l}
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">{report}</div>
      <PrintRoot>
        <div className="a4-page p-6">{report}</div>
      </PrintRoot>
    </div>
  );
}
