import Link from 'next/link';
import { getDb } from '@/db/client';
import { formatThaiDate } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { listWhtRows } from '@/server/services/accounting';
import { money, selectCls } from '../shared';

export default async function WhtPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = (await listWhtRows(db, actor)).filter(
    (r) => (sp.status === 'VOID' ? r.status === 'VOID' : sp.status === 'ALL' ? true : r.status === 'ACTIVE') && (!q || `${r.number} ${r.payee} ${r.pvNumber}`.toLowerCase().includes(q)),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">หัก ณ ที่จ่าย</h1>
          <p className="text-xs text-slate-500">หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ระบบออกให้อัตโนมัติเมื่อบันทึกจ่ายใบสำคัญจ่าย (PV) ที่มีการหัก ณ ที่จ่าย</p>
        </div>
        <form className="flex flex-wrap items-center gap-2">
          <input name="q" defaultValue={sp.q ?? ''} placeholder="ค้นหาเลขที่ ผู้ถูกหักภาษี PV" aria-label="ค้นหา" className={`${selectCls} w-56`} />
          <select name="status" defaultValue={sp.status ?? 'ACTIVE'} aria-label="สถานะ" className={selectCls}>
            <option value="ACTIVE">ออกแล้ว</option>
            <option value="VOID">ยกเลิก</option>
            <option value="ALL">ทั้งหมด</option>
          </select>
          <button className="rounded-lg bg-[#2453d4] px-3 py-2 text-xs font-semibold text-white">ตัวกรอง</button>
          <Link href="/accounting/wht-report" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
            รายงานภาษีหัก ณ ที่จ่าย
          </Link>
        </form>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-[#102d72] text-white">
            <tr>
              {['เลขที่', 'วันที่', 'ผู้ถูกหักภาษี', 'แบบ', 'อ้างอิง PV', 'ยอดรวม (ฐานภาษี)', 'ภาษีที่หัก', 'สถานะ', ''].map((h) => (
                <th key={h} className={`px-3 py-2.5 font-medium ${h.startsWith('ยอด') || h === 'ภาษีที่หัก' ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400">
                  ไม่มีรายการ
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-mono font-semibold">{r.number}</td>
                  <td className="px-3 py-2.5">{formatThaiDate(r.paidAt)}</td>
                  <td className="px-3 py-2.5">{r.payee}</td>
                  <td className="px-3 py-2.5">{r.formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/pv/${r.pvId}`} className="font-mono text-[#2453d4] hover:underline">
                      {r.pvNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right">{money(r.basis)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">{money(r.wht)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                      {r.status === 'ACTIVE' ? 'ออกแล้ว' : 'ยกเลิก'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <a href={`/api/pdf/wht/${r.id}`} target="_blank" rel="noreferrer" className="text-[#2453d4] hover:underline">
                      พิมพ์
                    </a>
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
