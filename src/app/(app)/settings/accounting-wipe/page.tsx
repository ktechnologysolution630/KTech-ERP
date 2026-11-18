import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { ACCOUNTING_WIPE_CONFIRM, previewAccountingWipe } from '@/server/services/accounting-delete';
import { WipeForm } from './wipe-form';

/** The owner or admin removes every accounting document at once, e.g. after testing, before going live */
export default async function AccountingWipePage() {
  const actor = await requireUser();
  if (!can(actor, 'accounting.delete')) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        หน้านี้สำหรับผู้ดูแลระบบหรือเจ้าของเท่านั้น
      </div>
    );
  }
  const db = await getDb();
  const preview = await previewAccountingWipe(db, actor);

  return (
    <div className="max-w-2xl space-y-4 text-sm">
      <Link href="/settings" className="text-xs text-slate-500 hover:text-slate-800">
        ← ตั้งค่าบริษัท
      </Link>
      <div>
        <h1 className="text-xl font-bold text-slate-900">ล้างข้อมูลบัญชีทั้งหมด</h1>
        <p className="text-xs text-slate-500">ใช้ล้างข้อมูลทดสอบก่อนเริ่มใช้งานจริง หรือเริ่มบันทึกบัญชีใหม่ทั้งหมด</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-bold text-slate-900">เอกสารที่จะถูกลบ</h2>
        {preview.documents.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">ไม่มีเอกสารบัญชีในระบบ</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-xs">
            {preview.documents.map((d) => (
              <li key={d.label} className="flex justify-between py-1.5">
                <span>{d.label}</span>
                <b>{d.count.toLocaleString('th-TH')} ใบ</b>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">รวมถึงไฟล์แนบ ความคิดเห็น และการแจ้งเตือนของเอกสารเหล่านี้</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-bold text-slate-900">สิ่งที่จะถูกปรับกลับ</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-xs">
          {preview.resets.map((r) => (
            <li key={r.label} className="flex justify-between py-1.5">
              <span>{r.label}</span>
              <b>{r.count.toLocaleString('th-TH')} รายการ</b>
            </li>
          ))}
          <li className="py-1.5">ใบสั่งซื้อที่ปิดเพราะจ่ายเงินครบ จะกลับเป็น &quot;สั่งซื้อแล้ว&quot; จนกว่าจะจ่ายใหม่</li>
        </ul>
        <p className="mt-3 text-xs font-semibold text-slate-700">ไม่ถูกลบ</p>
        <p className="text-xs text-slate-500">
          ลูกค้า บัญชีเงินสด/ธนาคาร หมวดบัญชี เลขที่เอกสาร (เลขที่ลบไปจะไม่ถูกนำกลับมาใช้) และเอกสารฝั่งจัดซื้อ สต็อก โครงการ ทั้งหมด
        </p>
      </section>

      <WipeForm confirmWords={ACCOUNTING_WIPE_CONFIRM} nothingToWipe={preview.documents.length === 0} />
    </div>
  );
}
