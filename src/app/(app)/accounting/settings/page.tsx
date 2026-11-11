import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { listAccountCategories, listDocRunning } from '@/server/services/account-categories';
import { CategoriesClient } from './categories-client';

export default async function AccountingSettingsPage() {
  const actor = await requireUser();
  const db = await getDb();
  const [categories, running] = await Promise.all([listAccountCategories(db, actor), listDocRunning(db, actor)]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">ตั้งค่าบัญชีและภาษี</h1>
        <p className="text-xs text-slate-500">จัดการข้อมูลกลางของระบบบัญชีและการเงิน</p>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">เลขรันเอกสาร</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left font-medium">เอกสาร</th>
                <th className="px-4 py-2 text-left font-medium">รูปแบบเลขที่</th>
                <th className="px-4 py-2 text-right font-medium">ออกแล้วเดือนนี้</th>
                <th className="px-4 py-2 text-left font-medium">เลขถัดไป</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {running.map((r) => (
                <tr key={r.prefix}>
                  <td className="px-4 py-2">{r.label}</td>
                  <td className="px-4 py-2 font-mono text-slate-500">{r.format}</td>
                  <td className="px-4 py-2 text-right">{r.used}</td>
                  <td className="px-4 py-2 font-mono font-semibold">{r.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-slate-400">เลขที่ประกอบด้วย ตัวย่อเอกสาร - ปี พ.ศ. สองหลักและเดือน - ลำดับ 4 หลัก เริ่มนับใหม่ทุกเดือน และออกให้อัตโนมัติเมื่อบันทึกเอกสาร</p>
      </section>
      <CategoriesClient categories={categories.map((c) => ({ id: c.id, code: c.code, name: c.name, type: c.type, groupName: c.groupName, vatDefault: c.vatDefault, whtRate: Number(c.whtRate), active: c.active }))} />
    </div>
  );
}
