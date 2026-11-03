import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/db/client';
import { bahtText, D } from '@/domain/money';
import { PRV_CATEGORY_LABELS } from '@/domain/prv';
import { requireUser } from '@/server/auth/current-user';
import { getPrvById } from '@/server/services/prv';
import { getSettings } from '@/server/services/settings';
import { PrvActions } from './prv-actions';

export default async function PrvDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  const db = await getDb();
  const [prv, settings] = await Promise.all([getPrvById(db, actor, id), getSettings(db)]);
  if (!prv) notFound();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3 print:hidden">
        <Link
          href="/prv"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับไปหน้ารายการ PRV
        </Link>

        <PrvActions id={prv.id} vendorId={prv.vendorId} allowed={prv.allowed} />
      </div>

      {/* Main Payment Certificate Sheet (Printable A4) */}
      <div className="rounded-2xl bg-white border border-slate-200/90 shadow-sm p-6 sm:p-8 space-y-6 text-xs text-slate-800">
        {/* Certificate Header */}
        <div className="text-center border-b border-slate-200 pb-5 space-y-1">
          <div className="inline-block px-3 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold tracking-wider text-[11px] mb-1">
            PAYMENT CERTIFICATE / ใบรับรองการขอเบิกเงิน
          </div>
          <h1 className="text-xl font-bold text-slate-900">{settings.companyName}</h1>
          <p className="text-slate-500 text-[11px]">
            {settings.companyAddress} · เลขประจำตัวผู้เสียภาษี {settings.companyTaxId}
          </p>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-4 bg-slate-50/60 p-4 rounded-xl border border-slate-100">
          <div className="space-y-1.5">
            <div>
              <span className="text-slate-500">โครงการ (Project):</span>{' '}
              <strong className="text-slate-900">{prv.project?.name || '-'}</strong>
            </div>
            <div>
              <span className="text-slate-500">ผู้รับเงิน / ผู้รับเหมา:</span>{' '}
              <strong className="text-slate-900">{prv.payeeName}</strong>
            </div>
            <div>
              <span className="text-slate-500">ประเภทการเบิก:</span>{' '}
              <span className="font-semibold text-slate-700">
                {PRV_CATEGORY_LABELS[prv.category] ?? prv.category}
              </span>
              {prv.installmentNo ? ` (งวดที่ ${prv.installmentNo})` : ''}
            </div>
          </div>

          <div className="space-y-1.5 text-right">
            <div>
              <span className="text-slate-500">เลขที่เอกสาร PRV:</span>{' '}
              <strong className="font-mono text-blue-700 text-sm">{prv.prvNumber}</strong>
            </div>
            <div>
              <span className="text-slate-500">วันที่:</span>{' '}
              <strong className="text-slate-900">{prv.date}</strong>
            </div>
            <div>
              <span className="text-slate-500">อ้างอิงใบสั่งซื้อ PO:</span>{' '}
              <strong className="font-mono text-slate-900">{prv.po?.number || '-'}</strong>
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[#102d72] text-white">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-medium">ลำดับ</th>
                <th className="px-3.5 py-2.5 text-left font-medium">รายละเอียดงานที่ขอเบิก</th>
                <th className="px-3.5 py-2.5 text-right font-medium">จำนวน</th>
                <th className="px-3.5 py-2.5 text-left font-medium">หน่วย</th>
                <th className="px-3.5 py-2.5 text-right font-medium">ราคา/หน่วย</th>
                <th className="px-3.5 py-2.5 text-right font-medium">ผลงาน (%)</th>
                <th className="px-3.5 py-2.5 text-right font-medium">จำนวนเงิน (บาท)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prv.items.map((it, idx) => (
                <tr key={it.id}>
                  <td className="px-3.5 py-2 text-slate-400 font-mono">{idx + 1}</td>
                  <td className="px-3.5 py-2 font-medium text-slate-900">{it.description}</td>
                  <td className="px-3.5 py-2 text-right text-slate-700">{Number(it.quantity).toLocaleString()}</td>
                  <td className="px-3.5 py-2 text-slate-500">{it.unit}</td>
                  <td className="px-3.5 py-2 text-right text-slate-700">
                    ฿{Number(it.unitPrice).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3.5 py-2 text-right text-slate-700">{it.progressPercent}%</td>
                  <td className="px-3.5 py-2 text-right font-bold text-slate-900">
                    ฿{Number(it.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Calculations & Net Summary */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6 pt-2">
          <div className="flex-1 space-y-2">
            <div className="text-slate-500 text-[11px]">
              จำนวนเงินตัวอักษร: <strong className="text-slate-800">{bahtText(D(prv.netAmount))}</strong>
            </div>
            {prv.notes && (
              <div className="rounded-lg bg-slate-50 p-3 border border-slate-200/80 text-[11px] text-slate-600">
                <strong>หมายเหตุ:</strong> {prv.notes}
              </div>
            )}
          </div>

          <div className="w-full sm:w-80 space-y-2 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
            <div className="flex items-center justify-between text-slate-600">
              <span>รวมเป็นจำนวนเงิน</span>
              <span>฿{Number(prv.totalAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
            </div>
            {Number(prv.retentionAmount) > 0 && (
              <div className="flex items-center justify-between text-rose-600">
                <span>หักเงินประกันผลงาน ({prv.retentionPercent}%)</span>
                <span>-฿{Number(prv.retentionAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            {Number(prv.whtAmount) > 0 && (
              <div className="flex items-center justify-between text-rose-600">
                <span>หักภาษี ณ ที่จ่าย ({prv.whtRate}%)</span>
                <span>-฿{Number(prv.whtAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            {Number(prv.vatAmount) > 0 && (
              <div className="flex items-center justify-between text-blue-700">
                <span>ภาษีมูลค่าเพิ่ม (VAT 7%)</span>
                <span>+฿{Number(prv.vatAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-200 flex items-center justify-between font-bold text-slate-900 text-sm">
              <span>คงเหลือจ่ายงวดนี้ (Net Due)</span>
              <span className="text-emerald-700 text-base">
                ฿{Number(prv.netAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Signature Approvals Section (3-Column Layout Matching K-Tec Standards) */}
        <div className="grid grid-cols-3 gap-4 pt-6 border-t border-slate-200 text-center">
          <div className="space-y-4 p-3 rounded-lg border border-slate-100">
            <span className="text-slate-500 font-medium">ผู้ขอเบิก / Site Engineer</span>
            <div className="h-10 flex items-center justify-center font-semibold text-slate-800">
              {prv.requestedByName}
            </div>
            <div className="text-[10px] text-slate-400">วันที่: {prv.date}</div>
          </div>

          <div className="space-y-4 p-3 rounded-lg border border-slate-100">
            <span className="text-slate-500 font-medium">ผู้ตรวจรับรอง / Project Engineer (PM)</span>
            <div className="h-10 flex items-center justify-center font-semibold text-slate-800">
              {prv.verifiedByName || '(รอการตรวจสอบ)'}
            </div>
            <div className="text-[10px] text-slate-400">
              {prv.verifiedAt ? new Date(prv.verifiedAt).toLocaleDateString('th-TH') : 'วันที่: -'}
            </div>
          </div>

          <div className="space-y-4 p-3 rounded-lg border border-slate-100 bg-blue-50/30">
            <span className="text-slate-500 font-medium">ผู้อนุมัติจ่าย / Approved by Owner</span>
            <div className="h-10 flex items-center justify-center font-bold text-emerald-700">
              {prv.approvedByName || '(รอเจ้าของอนุมัติ)'}
            </div>
            <div className="text-[10px] text-slate-400">
              {prv.approvedAt ? new Date(prv.approvedAt).toLocaleDateString('th-TH') : 'วันที่: -'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
