import Link from 'next/link';
import { getDb } from '@/db/client';
import { FORM_DEFS, isFormKind } from '@/domain/form-templates';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { getFormTemplates } from '@/server/services/form-templates';
import { getSettings } from '@/server/services/settings';
import { FormsClient } from './forms-client';

export default async function FormSettingsPage({ searchParams }: { searchParams: Promise<{ form?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, 'settings.manage')) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        หน้านี้สำหรับผู้ดูแลระบบหรือเจ้าของเท่านั้น
      </div>
    );
  }
  const { form } = await searchParams;
  const db = await getDb();
  const [templates, settings] = await Promise.all([getFormTemplates(db), getSettings(db)]);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">แบบฟอร์มเอกสาร</h1>
          <p className="mt-1 text-xs text-slate-600">
            แก้ชื่อเอกสาร ชื่อช่องลงนาม และหมายเหตุท้ายฟอร์ม ที่พิมพ์ออกไปทั้งฟอร์มภายในและฟอร์มภายนอก เอกสารที่เปิดหรือพิมพ์หลังบันทึกจะใช้ข้อความใหม่ทันที
          </p>
        </div>
        <Link href="/settings" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
          ← ตั้งค่าบริษัท
        </Link>
      </div>

      <FormsClient
        defs={FORM_DEFS.map((d) => ({ kind: d.kind, group: d.group, label: d.label, defaults: d.defaults }))}
        texts={templates.texts}
        edited={Object.keys(templates.saved)}
        header={templates.header}
        company={{ name: settings.companyName, address: settings.companyAddress, taxId: settings.companyTaxId }}
        initialKind={isFormKind(form) ? form : 'PO'}
      />
    </div>
  );
}
