import Link from 'next/link';
import { getDb } from '@/db/client';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { closedThrough, listClosings, previewYearClose } from '@/server/services/gl-period';
import { CloseYearForm, ClosePeriodForm, ReopenForm } from './close-client';

export default async function GlClosePage() {
  const actor = await requireUser();
  const db = await getDb();
  const canManage = can(actor, 'gl.manage');
  const canReopen = canManage && can(actor, 'data.delete');
  const today = bangkokDateString();
  const lastYear = Number(today.slice(0, 4)) - 1;
  const [closings, through, preview] = await Promise.all([listClosings(db, actor), closedThrough(db), previewYearClose(db, actor, lastYear)]);
  const prevMonth = (() => {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();
  const yearClosed = through !== null && through >= `${lastYear}-12-31`;

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <Link href="/accounting/gl" className="text-xs text-brand hover:underline">
          ← สมุดรายวันและบัญชีแยกประเภท
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">ปิดงวด / ปิดบัญชีสิ้นปี</h1>
        <p className="text-xs text-slate-500">
          เมื่อปิดงวดแล้ว เอกสารที่ลงวันที่ในงวดนั้น (บิลซื้อ ใบสำคัญจ่าย ใบแจ้งหนี้ ใบเสร็จ ฯลฯ) จะสร้าง แก้ไข หรือยกเลิกไม่ได้ เพื่อให้งบที่ส่งไปแล้วไม่เปลี่ยน
        </p>
      </div>

      <div className={`rounded-xl border p-4 text-sm ${through ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`}>
        {through ? <>ปิดงวดบัญชีถึงวันที่ <b>{through}</b></> : 'ยังไม่ได้ปิดงวดใด ๆ'}
      </div>

      {canManage && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">ปิดงวดรายเดือน</h2>
            <p className="mt-1 text-xs text-slate-500">ทำหลังยื่น ภ.พ.30 / ภ.ง.ด. ของเดือนนั้นแล้ว</p>
          </div>
          <ClosePeriodForm defaultMonth={prevMonth} />
          {!yearClosed && (
            <div className="border-t border-slate-100 pt-4">
              <h2 className="text-sm font-semibold text-slate-900">ปิดบัญชีสิ้นปี {lastYear}</h2>
              <p className="mt-1 mb-2 text-xs text-slate-500">โอนยอดรายได้และค่าใช้จ่าย {preview.accounts} บัญชี เข้าบัญชีกำไร(ขาดทุน)สะสม ลงวันที่ {preview.through}</p>
              <CloseYearForm year={lastYear} netProfit={preview.netProfit} />
            </div>
          )}
          {canReopen && through && (
            <div className="border-t border-slate-100 pt-4">
              <h2 className="text-sm font-semibold text-slate-900">เปิดงวด (เจ้าของ / ผู้ดูแลระบบ)</h2>
              <p className="mt-1 mb-2 text-xs text-slate-500">ใช้เมื่อจำเป็นต้องแก้เอกสารย้อนหลัง เปิดได้ทีละครั้งจากงวดล่าสุด</p>
              <ReopenForm />
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">ประวัติการปิดงวด</h2>
        {closings.length === 0 ? (
          <p className="text-xs text-slate-500">ยังไม่มี</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-1.5 pr-2 font-medium">ปิดถึง</th>
                <th className="py-1.5 pr-2 font-medium">ประเภท</th>
                <th className="py-1.5 pr-2 font-medium">ผู้ปิด</th>
                <th className="py-1.5 pr-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {closings.map((c) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2">{c.closedThrough}</td>
                  <td className="py-1.5 pr-2">{c.kind === 'YEAR' ? 'ปิดบัญชีสิ้นปี' : 'ปิดงวด'}</td>
                  <td className="py-1.5 pr-2">{c.closedByName ?? '-'}</td>
                  <td className="py-1.5 pr-2">{c.reopenedAt ? <span className="text-slate-500">เปิดแล้ว: {c.reopenReason}</span> : <span className="text-amber-700">ปิดอยู่</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
