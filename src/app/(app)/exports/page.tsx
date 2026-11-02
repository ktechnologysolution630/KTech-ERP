import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { pvs, vendors, whtCerts } from '@/db/schema';
import { toBangkok } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { assertCan } from '@/server/policy';
import { DocStatusBadge } from '@/components/doc-status-badge';
import { formatMoneyDisplay } from '@/components/money-input';

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const actor = await requireUser();
  assertCan(actor, 'export.view');

  const db = await getDb();
  const nowBkk = toBangkok(new Date());
  const year = Number(sp.year ?? nowBkk.getUTCFullYear());
  const month = Number(sp.month ?? nowBkk.getUTCMonth() + 1);

  const [certs, allVendors, allPvs] = await Promise.all([
    db.select().from(whtCerts).orderBy(desc(whtCerts.paidAt), desc(whtCerts.number)),
    db.select().from(vendors),
    db.select().from(pvs),
  ]);
  const vendorMap = new Map(allVendors.map((v) => [v.id, v]));
  const pvMap = new Map(allPvs.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          ส่งออกข้อมูลบัญชี & หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)
        </h1>
        <p className="text-xs text-slate-600">
          ดาวน์โหลดไฟล์ Excel รายเดือนสำหรับส่งสำนักงานบัญชี (PV จ่ายแล้ว, รายงานภาษีซื้อ, ภ.ง.ด.3/53)
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <form method="get" className="flex flex-wrap items-end gap-3 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">ปี (ค.ศ.)</label>
            <input
              type="number"
              name="year"
              defaultValue={year}
              className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">เดือน</label>
            <select
              name="month"
              defaultValue={month}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  เดือน {m}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-slate-800 text-white px-4 py-2 font-medium"
          >
            เลือกงวดเดือน
          </button>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          <a
            href={`/api/export/pv-paid?year=${year}&month=${month}`}
            className="rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 p-4 block space-y-1"
          >
            <div className="text-sm font-bold text-blue-900">
              1. สรุปใบสำคัญจ่าย (PV จ่ายแล้ว)
            </div>
            <p className="text-xs text-blue-700">
              ไฟล์ Excel (.xlsx) รวมรายการ PV ที่โอนจ่ายแล้วในเดือน {month}/{year}
            </p>
          </a>

          <a
            href={`/api/export/purchase-vat?year=${year}&month=${month}`}
            className="rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 p-4 block space-y-1"
          >
            <div className="text-sm font-bold text-emerald-900">
              2. รายงานภาษีซื้อ (Purchase VAT)
            </div>
            <p className="text-xs text-emerald-700">
              ไฟล์ Excel (.xlsx) รวมใบกำกับภาษีซื้อในเดือน {month}/{year}
            </p>
          </a>

          <a
            href={`/api/export/wht?year=${year}&month=${month}`}
            className="rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 p-4 block space-y-1"
          >
            <div className="text-sm font-bold text-amber-900">
              3. รายงานหัก ณ ที่จ่าย (ภ.ง.ด.3 / 53)
            </div>
            <p className="text-xs text-amber-700">
              ไฟล์ Excel (.xlsx) แยกชีต ภ.ง.ด.3 และ ภ.ง.ด.53 ประจำเดือน {month}/{year}
            </p>
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">
            ทะเบียนหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">เลขที่ 50 ทวิ</th>
              <th className="px-4 py-3 text-left">แบบ</th>
              <th className="px-4 py-3 text-left">วันที่จ่าย</th>
              <th className="px-4 py-3 text-left">ผู้ถูกหัก</th>
              <th className="px-4 py-3 text-left">PV</th>
              <th className="px-4 py-3 text-right">ฐานภาษี</th>
              <th className="px-4 py-3 text-right">ภาษีที่หัก</th>
              <th className="px-4 py-3 text-left">สถานะ</th>
              <th className="px-4 py-3 text-right">พิมพ์</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {certs.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400 text-xs">
                  ยังไม่มีหนังสือรับรองหัก ณ ที่จ่าย
                </td>
              </tr>
            ) : (
              certs.map((c) => {
                const v = vendorMap.get(c.vendorId);
                const pv = pvMap.get(c.pvId);
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{c.number}</td>
                    <td className="px-4 py-3 text-xs">
                      {c.formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}
                    </td>
                    <td className="px-4 py-3 text-xs">{c.paidAt}</td>
                    <td className="px-4 py-3">{v?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-xs">
                      {pv ? (
                        <Link
                          href={`/pv/${pv.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {pv.number}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      ฿{formatMoneyDisplay(c.basis)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-amber-800">
                      ฿{formatMoneyDisplay(c.wht)}
                    </td>
                    <td className="px-4 py-3">
                      <DocStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/api/pdf/wht/${c.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        พิมพ์ 50 ทวิ (PDF)
                      </a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
