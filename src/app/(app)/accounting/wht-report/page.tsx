import { getDb } from '@/db/client';
import { bangkokDateString, formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listWhtRows } from '@/server/services/accounting';
import { getSettings } from '@/server/services/settings';
import { PrintRoot } from '@/components/project-site/report-sheet';
import { DateInput } from '@/components/date-input';
import { PrintButton } from '../print-button';
import { money, selectCls, THAI_MONTHS } from '../shared';

type Sp = { from?: string; to?: string; month?: string; year?: string; form?: string; payee?: string; status?: string };

export default async function WhtReportPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const today = bangkokDateString();
  const [all, settings] = await Promise.all([listWhtRows(db, actor), getSettings(db)]);
  // An explicit date range wins; otherwise a month (default this month) or a whole year
  const year = sp.year === 'ALL' ? null : Number(sp.year) || Number(today.slice(0, 4));
  const month = sp.month === 'ALL' ? null : Number(sp.month) || (sp.from || sp.to ? null : Number(today.slice(5, 7)));
  const inRange = (d: string) => {
    if (sp.from || sp.to) return (!sp.from || d >= sp.from) && (!sp.to || d <= sp.to);
    if (year && d.slice(0, 4) !== String(year)) return false;
    if (month && Number(d.slice(5, 7)) !== month) return false;
    return true;
  };
  const status = sp.status ?? 'ACTIVE';
  const rows = all.filter(
    (r) =>
      inRange(r.paidAt) &&
      (!sp.form || sp.form === 'ALL' || r.formType === sp.form) &&
      (!sp.payee || sp.payee === 'ALL' || r.payee === sp.payee) &&
      (status === 'ALL' || r.status === status),
  );
  const counted = rows.filter((r) => r.status === 'ACTIVE');
  const sumOf = (list: typeof rows) => ({ n: list.length, basis: list.reduce((s, r) => s + r.basis, 0), wht: list.reduce((s, r) => s + r.wht, 0) });
  const total = sumOf(counted);
  const p3 = sumOf(counted.filter((r) => r.formType === 'PND3'));
  const p53 = sumOf(counted.filter((r) => r.formType === 'PND53'));
  const payees = [...new Set(all.map((r) => r.payee))].sort((a, b) => a.localeCompare(b, 'th'));
  const rangeText = sp.from || sp.to ? `${sp.from ? formatThaiDate(sp.from) : '…'} – ${sp.to ? formatThaiDate(sp.to) : '…'}` : `${month ? THAI_MONTHS[month - 1] : 'ทุกเดือน'} ${year ? year + 543 : 'ทุกปี'}`;
  const excelMonth = month ?? Number(today.slice(5, 7));
  const excelYear = year ?? Number(today.slice(0, 4));

  const report = (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="text-base font-bold">รายงานภาษีหัก ณ ที่จ่าย</p>
          <p className="text-[10px] tracking-widest text-slate-500">WITHHOLDING TAX REPORT</p>
        </div>
        <div className="text-right">
          <p>{settings.companyName}</p>
          <p>เลขประจำตัวผู้เสียภาษี {settings.companyTaxId || '-'}</p>
          <p>ช่วงวันที่ {rangeText}</p>
        </div>
      </div>
      <table className="w-full min-w-[1000px] border-collapse">
        <thead className="bg-[#102d72] text-white">
          <tr>
            {['ลำดับ', 'วันที่จ่าย', 'เลขที่หนังสือรับรอง', 'เลขเอกสารอ้างอิง', 'ชื่อผู้ถูกหักภาษี', 'เลขประจำตัวผู้เสียภาษี', 'ประเภทแบบ', 'ประเภทรายได้', 'ฐานภาษี', 'อัตรา %', 'ภาษีที่หัก', 'สถานะ'].map((h) => (
              <th key={h} className={`border border-[#102d72] px-2 py-2 font-medium ${['ฐานภาษี', 'อัตรา %', 'ภาษีที่หัก'].includes(h) ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={12} className="py-8 text-center text-slate-400">
                ไม่พบรายการตามเงื่อนไข
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={r.id} className={`border-b border-slate-100 ${r.status === 'VOID' ? 'text-slate-400 line-through' : ''}`}>
                <td className="px-2 py-1.5">{i + 1}</td>
                <td className="px-2 py-1.5">{formatThaiDate(r.paidAt)}</td>
                <td className="px-2 py-1.5 font-mono">{r.number}</td>
                <td className="px-2 py-1.5 font-mono">{r.pvNumber}</td>
                <td className="px-2 py-1.5">{r.payee}</td>
                <td className="px-2 py-1.5 font-mono">{r.payeeTaxId || '-'}</td>
                <td className="px-2 py-1.5">{r.formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}</td>
                <td className="px-2 py-1.5">{r.incomeType}</td>
                <td className="px-2 py-1.5 text-right">{money(r.basis)}</td>
                <td className="px-2 py-1.5 text-right">{r.rate}</td>
                <td className="px-2 py-1.5 text-right">{money(r.wht)}</td>
                <td className="px-2 py-1.5">{r.status === 'ACTIVE' ? 'ออกแล้ว' : 'ยกเลิก'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <table className="w-full max-w-md border-collapse">
        <thead className="bg-slate-100">
          <tr>
            <th className="px-2 py-1.5 text-left">สรุปรายการ</th>
            <th className="px-2 py-1.5 text-right">จำนวน</th>
            <th className="px-2 py-1.5 text-right">ฐานภาษี (บาท)</th>
            <th className="px-2 py-1.5 text-right">ภาษีหัก ณ ที่จ่าย (บาท)</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['รวม', total],
              ['ภ.ง.ด.3', p3],
              ['ภ.ง.ด.53', p53],
            ] as const
          ).map(([l, s]) => (
            <tr key={l} className="border-b border-slate-100">
              <td className="px-2 py-1.5">{l}</td>
              <td className="px-2 py-1.5 text-right">{s.n} รายการ</td>
              <td className="px-2 py-1.5 text-right">{money(s.basis)}</td>
              <td className="px-2 py-1.5 text-right">{money(s.wht)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-500">ยอดสรุปไม่รวมหนังสือรับรองที่ยกเลิก</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">รายงานภาษีหัก ณ ที่จ่าย</h1>
          <p className="text-xs text-slate-500">ตรวจสอบหนังสือรับรองที่บริษัทออกให้ผู้รับเงิน สำหรับ ภ.ง.ด.3 และ ภ.ง.ด.53</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/export/wht?year=${excelYear}&month=${excelMonth}`} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            Excel ({THAI_MONTHS[excelMonth - 1]})
          </a>
          <PrintButton label="พิมพ์ / PDF" />
        </div>
      </div>
      <form className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
        <label>
          <span className="block text-slate-500">วันที่เริ่มต้น</span>
          <DateInput name="from" defaultValue={sp.from ?? ''} className={selectCls} />
        </label>
        <label>
          <span className="block text-slate-500">วันที่สิ้นสุด</span>
          <DateInput name="to" defaultValue={sp.to ?? ''} className={selectCls} />
        </label>
        <label>
          <span className="block text-slate-500">เดือน</span>
          <select name="month" defaultValue={sp.month ?? (sp.from || sp.to ? 'ALL' : String(Number(today.slice(5, 7))))} className={selectCls}>
            <option value="ALL">ทั้งหมด</option>
            {THAI_MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-slate-500">ปี</span>
          <select name="year" defaultValue={sp.year ?? today.slice(0, 4)} className={selectCls}>
            <option value="ALL">ทั้งหมด</option>
            {[0, 1, 2].map((k) => {
              const y = Number(today.slice(0, 4)) - k;
              return (
                <option key={y} value={y}>
                  {y + 543}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          <span className="block text-slate-500">ประเภทแบบ</span>
          <select name="form" defaultValue={sp.form ?? 'ALL'} className={selectCls}>
            <option value="ALL">ทั้งหมด</option>
            <option value="PND3">ภ.ง.ด.3</option>
            <option value="PND53">ภ.ง.ด.53</option>
          </select>
        </label>
        <label>
          <span className="block text-slate-500">ผู้รับเงิน / คู่ค้า</span>
          <select name="payee" defaultValue={sp.payee ?? 'ALL'} className={`${selectCls} max-w-48`}>
            <option value="ALL">ทั้งหมด</option>
            {payees.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-slate-500">สถานะ</span>
          <select name="status" defaultValue={status} className={selectCls}>
            <option value="ACTIVE">ออกแล้ว</option>
            <option value="VOID">ยกเลิก</option>
            <option value="ALL">ทั้งหมด</option>
          </select>
        </label>
        <button className="rounded-lg bg-[#2453d4] px-4 py-2 font-semibold text-white">ค้นหา</button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">{report}</div>
      <PrintRoot>
        <div className="a4-page p-6">{report}</div>
      </PrintRoot>
    </div>
  );
}
