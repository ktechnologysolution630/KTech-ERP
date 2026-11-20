import Link from 'next/link';
import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { previewSystemReset, SYSTEM_RESET_CONFIRM } from '@/server/services/system-reset';
import { ResetForm } from './reset-form';

/** The owner or admin removes every document on every menu and restarts all running numbers, before going live */
export default async function SystemResetPage() {
  const actor = await requireUser();
  if (!can(actor, 'data.delete')) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        หน้านี้สำหรับผู้ดูแลระบบหรือเจ้าของเท่านั้น
      </div>
    );
  }
  const db = await getDb();
  const preview = await previewSystemReset(db, actor);
  const nothing = preview.documents.length === 0 && preview.counters === 0;

  return (
    <div className="max-w-2xl space-y-4 text-sm">
      <Link href="/settings" className="text-xs text-slate-500 hover:text-slate-800">
        ← ตั้งค่าบริษัท
      </Link>
      <div>
        <h1 className="text-xl font-bold text-slate-900">ล้างข้อมูลทั้งระบบ</h1>
        <p className="text-xs text-slate-500">ลบเอกสารทุกฉบับในทุกเมนู และรีเซ็ตเลขที่เอกสารทุกชนิดให้เริ่มนับใหม่ เช่น ก่อนเริ่มใช้งานจริง</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-bold text-slate-900">สิ่งที่จะถูกลบ</h2>
        {preview.documents.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">ไม่มีเอกสารในระบบ</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-xs">
            {preview.documents.map((d) => (
              <li key={d.label} className="flex justify-between py-1.5">
                <span>{d.label}</span>
                <b>{d.count.toLocaleString('th-TH')} รายการ</b>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">
          เลขที่เอกสารที่จะกลับไปเริ่มที่ 0: <b>{preview.counters.toLocaleString('th-TH')}</b> ตัวนับ (ใบถัดไปได้เลข 0001)
        </p>
        <p className="text-xs text-slate-500">งวดงานกลับเป็น &quot;ตามแผน&quot; และการแจ้งเตือนการใช้งบ BOQ กลับเป็น 0%</p>
      </section>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">
        <h2 className="text-sm font-bold">ไม่ถูกลบ</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>BOQ ทุกฉบับ (รวมโครงการที่ BOQ สังกัด แผนงาน และงวดงาน)</li>
          <li>ซัพพลายเออร์</li>
          <li>ทะเบียนสินค้า และรายการสินค้าในคลัง (ยอดคงเหลือกลับเป็น 0)</li>
          <li>ผู้ใช้งาน เจ้าของ ผู้ดูแลระบบ สิทธิ์ และลายเซ็น</li>
          <li>ลูกค้า บัญชีเงินสด/ธนาคาร หมวดบัญชี ทะเบียนทรัพย์สิน/รถ หน่วยนับ ประกาศ ตั้งค่าบริษัทและแบบฟอร์ม</li>
          <li>เลขรหัสของข้อมูลที่ยังอยู่ (BOQ รหัสโครงการ รหัสซัพพลายเออร์ รหัสสินค้า รหัสทรัพย์สิน) นับต่อ เพื่อไม่ให้เลขซ้ำ</li>
        </ul>
      </section>

      <ResetForm confirmWords={SYSTEM_RESET_CONFIRM} nothingToReset={nothing} />
    </div>
  );
}
