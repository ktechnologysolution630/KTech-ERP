import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { formatMoneyDisplay } from '@/domain/money';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listPos } from '@/server/services/po';
import { getVendorDetail } from '@/server/services/vendor-detail';
import { VendorEditButton } from './vendor-edit-button';
import { CREDIT_BASIS_LABEL, PAY_METHOD_LABEL, describeSchedule } from '@/domain/payment-terms';
import { CONTACT_KIND_LABEL, VENDOR_CATEGORY_LABEL, VENDOR_STATUS_LABEL } from '@/domain/vendor-profile';
import { vendorProfileValuesOf } from '@/components/vendor-profile-values';
import { listAttachments } from '@/server/services/attachments';
import { AttachmentsBox } from '@/components/attachments';

const VENDOR_TYPE_LABELS = { COMPANY: 'นิติบุคคล (ภ.ง.ด.53)', INDIVIDUAL: 'บุคคลธรรมดา (ภ.ง.ด.3)' } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-slate-900">{children || '-'}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  const db = await getDb();

  let detail: Awaited<ReturnType<typeof getVendorDetail>>;
  try {
    detail = await getVendorDetail(db, actor, id);
  } catch (err) {
    if (err instanceof DomainError && err.status === 404) notFound();
    if (err instanceof DomainError) {
      return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">{err.message}</div>;
    }
    throw err;
  }
  const { vendor: v, documents } = detail;
  const attachments = await listAttachments(db, 'VENDOR', v.id);
  const fullAddress = [v.address, v.building, v.moo && `หมู่ ${v.moo}`, v.soi && `ซอย ${v.soi}`, v.road && `ถนน ${v.road}`, v.subdistrict, v.district, v.province, v.postcode]
    .filter(Boolean)
    .join(' ');

  // Same figures as the supplier list, so moving between the two pages never shows a different total
  const vendorPos = (await listPos(db, actor, {})).filter((p) => p.vendorId === v.id);
  const totalPurchases = vendorPos.reduce((sum, p) => sum + Number(p.gross || 0), 0);
  const openPos = vendorPos.filter((p) => p.status === 'APPROVED' || p.status === 'ORDERED').length;

  return (
    <div className="space-y-4 font-sans text-xs text-slate-800">
      <Link href="/purchasing/vendors" className="inline-flex items-center gap-1.5 font-semibold text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" />
        กลับไปหน้าซัพพลายเออร์
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{v.name}</h1>
          <p className="mt-0.5 font-mono text-slate-500">
            {v.code}
            {!v.active && <span className="ml-2 font-sans font-semibold text-rose-600">ปิดใช้งาน</span>}
          </p>
        </div>
        {can(actor, 'master.manage') && <VendorEditButton vendorId={v.id} initial={vendorProfileValuesOf(v)} attachments={attachments} />}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="ยอดซื้อรวม" value={`฿${formatMoneyDisplay(totalPurchases)}`} />
        <Stat label="ใบสั่งซื้อทั้งหมด" value={`${vendorPos.length.toLocaleString()} ใบ`} />
        <Stat label="ใบสั่งซื้อเปิดค้าง" value={`${openPos.toLocaleString()} ใบ`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <h2 className="mb-3 text-sm font-bold text-slate-900">ข้อมูลทั่วไป</h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="สถานะ">{VENDOR_STATUS_LABEL[v.status]}{v.recommended ? ' · ซัพพลายเออร์แนะนำ' : ''}</Field>
            <Field label="ชื่อทางการค้า">{v.tradeName}</Field>
            <Field label="หมวดหมู่ผู้ขาย">{v.category ? VENDOR_CATEGORY_LABEL[v.category] : ''}</Field>
            <Field label="หมวดสินค้า / แบรนด์">{[v.productCategory, v.brand].filter(Boolean).join(' / ')}</Field>
            <Field label="เว็บไซต์ / LINE">{[v.website, v.lineId && `LINE: ${v.lineId}`].filter(Boolean).join(' · ')}</Field>
            <Field label="ประเภท">{VENDOR_TYPE_LABELS[v.type]}</Field>
            <Field label="ผู้ติดต่อ">{v.contactPerson}</Field>
            <Field label="เลขประจำตัวประชาชน / ผู้เสียภาษี">{v.taxId}</Field>
            <Field label="สาขา">{v.branchType === 'HQ' ? 'สำนักงานใหญ่' : `สาขา ${v.branch}`}</Field>
            <Field label="ภาษี">{v.vatRegistered ? `จด VAT ${v.defaultVatRate}%` : 'ไม่จด VAT'}{v.taxInvoiceName ? ` · ออกใบกำกับในชื่อ ${v.taxInvoiceName}` : ''}</Field>
            <Field label="โทร / MOBILE">{v.phone}</Field>
            <Field label="E-Mail">{v.email}</Field>
            <Field label="FAX">{v.fax}</Field>
            <div className="sm:col-span-2">
              <Field label="ที่อยู่">{fullAddress}</Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="ที่อยู่สำรอง">{v.altAddress}</Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="รายการสินค้า">{v.suppliedItems}</Field>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <h2 className="mb-3 text-sm font-bold text-slate-900">การชำระเงิน</h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="เครดิต">{v.defaultCreditDays > 0 ? `${v.defaultCreditDays} วัน` : 'เงินสด / ตามงวด'}</Field>
            <Field label="หัก ณ ที่จ่าย">{`${v.defaultWhtRate}%${v.whtIncomeType ? ` (${v.whtIncomeType})` : ''}`}</Field>
            <Field label="เงื่อนไขการชำระเงิน">{v.paymentTerms}</Field>
            <Field label="ระยะเวลาจัดส่ง">{v.leadTimeDays !== null ? `${v.leadTimeDays} วัน` : ''}</Field>
            <Field label="สั่งซื้อขั้นต่ำ">{[v.minOrderQty && `${Number(v.minOrderQty)} หน่วย`, v.minOrderValue && `฿${formatMoneyDisplay(v.minOrderValue)}`].filter(Boolean).join(' / ')}</Field>
            <Field label="วงเงินเครดิต">{v.creditLimit ? `฿${formatMoneyDisplay(v.creditLimit)}` : ''}</Field>
            <Field label="มัดจำ">{v.depositRequired ? `ต้องมีมัดจำ ${v.depositPercent ? `${Number(v.depositPercent)}%` : ''}` : 'ไม่ต้องมี'}</Field>
            <Field label="รอบวางบิล">{describeSchedule(v.billingSchedule, 'วางบิลได้ทุกวัน')}</Field>
            <Field label="เริ่มนับเครดิต">{CREDIT_BASIS_LABEL[v.creditBasis]}</Field>
            <Field label="รอบรับเช็ค / รอบจ่าย">{describeSchedule(v.chequeSchedule, 'ไม่กำหนดรอบ')}</Field>
            <Field label="วิธีจ่ายตั้งต้น">{PAY_METHOD_LABEL[v.defaultPayMethod]}</Field>
            <Field label="ธนาคาร">{v.bankName}</Field>
            <Field label="เลขที่บัญชี">{v.bankAccountNo}</Field>
            <div className="sm:col-span-2">
              <Field label="ชื่อบัญชี">{v.bankAccountName}</Field>
            </div>
          </dl>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <h2 className="mb-3 text-sm font-bold text-slate-900">ผู้ติดต่อ ({v.contacts.length})</h2>
          <ul className="space-y-2">
            {v.contacts.map((c, i) => (
              <li key={i} className="rounded-lg bg-slate-50 p-2">
                <p className="font-semibold text-slate-900">
                  {c.name || '-'} {c.primary && <span className="ml-1 rounded bg-blue-100 px-1.5 text-[10px] text-blue-700">หลัก</span>}
                </p>
                <p className="text-slate-500">{[CONTACT_KIND_LABEL[c.kind], c.position, c.department].filter((x) => x && x !== 'ยังไม่ได้ระบุ').join(' · ')}</p>
                <p>{[c.phone, c.mobile, c.email, c.lineId && `LINE: ${c.lineId}`].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <h2 className="mb-3 text-sm font-bold text-slate-900">บัญชีธนาคาร ({v.bankAccounts.length})</h2>
          <ul className="space-y-2">
            {v.bankAccounts.map((b, i) => (
              <li key={i} className="rounded-lg bg-slate-50 p-2">
                <p className="font-semibold text-slate-900">
                  {b.bank || '-'} {b.primary && <span className="ml-1 rounded bg-blue-100 px-1.5 text-[10px] text-blue-700">หลัก</span>}
                </p>
                <p>
                  {b.accountNo} {b.accountName && `· ${b.accountName}`}
                </p>
                <p className="text-slate-500">{[b.branch && `สาขา ${b.branch}`, b.accountType, b.promptPay && `พร้อมเพย์ ${b.promptPay}`].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </section>
        <AttachmentsBox entityType="VENDOR" entityId={v.id} items={attachments} />
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-bold text-slate-900">เอกสารที่เกี่ยวข้อง ({documents.length.toLocaleString()})</h2>
        {documents.length === 0 ? (
          <p className="py-10 text-center text-slate-400">ยังไม่มีเอกสารของผู้ขายรายนี้</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {documents.map((doc, i) => (
              <li key={`${doc.href}-${i}`} className="flex items-center gap-3 px-5 py-2">
                <span className="w-32 shrink-0 text-slate-500">{doc.label}</span>
                <Link href={doc.href} className="min-w-0 truncate font-mono text-[#2453d4] hover:underline">
                  {doc.number}
                </Link>
                {doc.cancelled && <span className="shrink-0 text-slate-500">(ยกเลิกแล้ว)</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
