'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Printer, XCircle } from 'lucide-react';
import { PrintRoot } from '@/components/project-site/report-sheet';
import { bahtText, D, formatMoneyDisplay } from '@/domain/money';
import { SALES_DOC_META, SALES_VAT_LABEL, type SalesDocKind, type SalesVatMode } from '@/domain/sales-doc';
import { formatThaiDate } from '@/domain/thai';
import type { CompanyHeader } from '@/components/doc-paper';
import { SignedRow } from '@/components/signed-row';
import type { Signer } from '@/domain/signature';
import { cancelSalesDocAction } from '../../actions';

export interface SalesDocViewData {
  id: string;
  kind: SalesDocKind;
  number: string;
  docDate: string;
  dueDate: string | null;
  reference: string;
  customerName: string;
  customerTaxId: string;
  customerBranch: string;
  customerAddress: string;
  contactName: string;
  phone: string;
  email: string;
  projectLabel: string;
  milestone: string;
  accountCategory: string;
  vatMode: SalesVatMode;
  whtRate: string;
  payMethod: 'TRANSFER' | 'CASH' | 'CHEQUE' | 'PROMPTPAY' | 'CARD' | null;
  retention: string;
  retentionRate: string;
  bank: string;
  bankBranch: string;
  accountName: string;
  accountNo: string;
  notes: string;
  subtotal: string;
  discount: string;
  beforeVat: string;
  vat: string;
  total: string;
  wht: string;
  payable: string;
  status: 'ISSUED' | 'CANCELLED';
  cancelReason: string | null;
  creatorName: string;
  lines: { id: string; isSection: boolean; name: string; detail: string; qty: string; unit: string; unitPrice: string; amount: string }[];
}

const PAY_LABEL = { TRANSFER: 'โอนเงิน', CASH: 'เงินสด', CHEQUE: 'เช็ค', PROMPTPAY: 'พร้อมเพย์', CARD: 'บัตรเครดิต' } as const;

function Paper({ doc, company, signers }: { doc: SalesDocViewData; company: CompanyHeader; signers: Signer[] }) {
  const meta = SALES_DOC_META[doc.kind];
  const nos = doc.lines.reduce<number[]>((acc, l, i) => [...acc, (acc[i - 1] ?? 0) + (l.isSection ? 0 : 1)], []);
  const money = (v: string) => formatMoneyDisplay(v);
  return (
    <div className="a4-page mx-auto w-full max-w-[1000px] bg-white px-8 py-8 text-[13px] text-slate-800">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-3">
          {company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="" className="h-16 w-16 object-contain" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded bg-[#2453d4] text-lg font-bold text-white">{company.name.replace(/^บริษัท\s*/, '').slice(0, 2)}</div>
          )}
          <div className="text-xs text-slate-600">
            <p className="text-sm font-bold text-slate-900">{company.name}</p>
            <p>ที่อยู่ : {company.address || '-'}</p>
            <p>เลขประจำตัวผู้เสียภาษีอากร: {company.taxId || '-'}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-[#102d72]">{meta.th}</p>
          <p className="text-[10px] tracking-widest text-slate-500">{meta.en}</p>
          <table className="ml-auto mt-2 text-xs">
            <tbody>
              <tr>
                <td className="pr-3 text-slate-500">เลขที่:</td>
                <td className="font-semibold">{doc.number}</td>
              </tr>
              <tr>
                <td className="pr-3 text-slate-500">วันที่:</td>
                <td>{formatThaiDate(doc.docDate)}</td>
              </tr>
              {doc.dueDate && (
                <tr>
                  <td className="pr-3 text-slate-500">ครบกำหนด:</td>
                  <td>{formatThaiDate(doc.dueDate)}</td>
                </tr>
              )}
              {doc.reference && (
                <tr>
                  <td className="pr-3 text-slate-500">อ้างอิง:</td>
                  <td>{doc.reference}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <hr className="my-4 border-slate-200" />
      <div className="grid grid-cols-2 gap-6 text-xs">
        <div>
          <p className="font-semibold text-slate-500">{doc.kind === 'EXP' ? 'ผู้ขาย / ผู้รับเงิน' : 'ลูกค้า'}</p>
          <p className="text-sm font-semibold">{doc.customerName || '-'}</p>
          <p>{doc.customerAddress}</p>
          <p>
            เลขประจำตัวผู้เสียภาษี: {doc.customerTaxId || '-'} {doc.customerBranch && `สาขา ${doc.customerBranch}`}
          </p>
          <p>
            ผู้ติดต่อ: {doc.contactName || '-'} · โทรศัพท์: {doc.phone || '-'} · อีเมล: {doc.email || '-'}
          </p>
        </div>
        <div>
          <p className="font-semibold text-slate-500">โครงการ</p>
          <p>{doc.projectLabel || 'ไม่ระบุโครงการ'}</p>
          {doc.milestone && <p>งวดงาน: {doc.milestone}</p>}
          {doc.accountCategory && <p>หมวดบัญชี: {doc.accountCategory}</p>}
        </div>
      </div>
      <table className="mt-4 w-full border-collapse text-xs">
        <thead className="bg-[#102d72] text-white">
          <tr>
            <th className="w-12 border border-[#102d72] px-2 py-1.5">ลำดับ</th>
            <th className="border border-[#102d72] px-2 py-1.5 text-left">รายการ</th>
            <th className="w-20 border border-[#102d72] px-2 py-1.5 text-right">จำนวน</th>
            <th className="w-20 border border-[#102d72] px-2 py-1.5">หน่วย</th>
            <th className="w-28 border border-[#102d72] px-2 py-1.5 text-right">ราคาต่อหน่วย</th>
            <th className="w-28 border border-[#102d72] px-2 py-1.5 text-right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) =>
            l.isSection ? (
              <tr key={l.id} className="bg-slate-50">
                <td className="border border-slate-200" />
                <td colSpan={5} className="border border-slate-200 px-2 py-1.5 font-semibold">
                  {l.name}
                </td>
              </tr>
            ) : (
              <tr key={l.id} className="align-top">
                <td className="border border-slate-200 px-2 py-1.5 text-center">{nos[i]}</td>
                <td className="border border-slate-200 px-2 py-1.5">
                  {l.name}
                  {l.detail && <div className="whitespace-pre-line text-[11px] text-slate-500">{l.detail}</div>}
                </td>
                <td className="border border-slate-200 px-2 py-1.5 text-right">{Number(l.qty).toLocaleString('th-TH')}</td>
                <td className="border border-slate-200 px-2 py-1.5 text-center">{l.unit}</td>
                <td className="border border-slate-200 px-2 py-1.5 text-right">{money(l.unitPrice)}</td>
                <td className="border border-slate-200 px-2 py-1.5 text-right">{money(l.amount)}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      <div className="mt-4 grid grid-cols-2 gap-6 text-xs">
        <div className="space-y-2">
          <p className="rounded bg-slate-50 px-3 py-2">
            <span className="text-slate-500">จำนวนเงินตัวอักษร </span>({bahtText(D(doc.payable))})
          </p>
          {doc.notes && <p className="whitespace-pre-line">หมายเหตุ: {doc.notes}</p>}
          {doc.payMethod && (
            <p>
              วิธีชำระเงิน: {PAY_LABEL[doc.payMethod]}
              {doc.bank && ` · ${doc.bank}`}
              {doc.bankBranch && ` สาขา ${doc.bankBranch}`}
              {doc.accountNo && ` · ${doc.payMethod === 'CHEQUE' ? 'เช็คเลขที่' : 'เลขบัญชี'} ${doc.accountNo}`}
            </p>
          )}
        </div>
        <table className="w-full">
          <tbody className="[&_td]:px-2 [&_td]:py-1">
            <tr>
              <td>รวมเป็นเงิน</td>
              <td className="text-right">{money(doc.subtotal)}</td>
            </tr>
            {Number(doc.discount) > 0 && (
              <tr>
                <td>ส่วนลด</td>
                <td className="text-right">{money(doc.discount)}</td>
              </tr>
            )}
            {doc.vatMode !== 'INCLUSIVE_HIDDEN' && (
              <tr>
                <td>{SALES_VAT_LABEL[doc.vatMode]}</td>
                <td className="text-right">{money(doc.vat)}</td>
              </tr>
            )}
            <tr>
              <td>ราคาไม่รวมภาษีมูลค่าเพิ่ม</td>
              <td className="text-right">{money(doc.beforeVat)}</td>
            </tr>
            <tr>
              <td>จำนวนเงินรวมทั้งสิ้น</td>
              <td className="text-right">{money(doc.total)}</td>
            </tr>
            {Number(doc.wht) > 0 && (
              <tr>
                <td>หัก ณ ที่จ่าย {Number(doc.whtRate)}%</td>
                <td className="text-right">{money(doc.wht)}</td>
              </tr>
            )}
            {Number(doc.retention) > 0 && (
              <tr>
                <td>หักประกันผลงาน {Number(doc.retentionRate)}%</td>
                <td className="text-right">-{money(doc.retention)}</td>
              </tr>
            )}
            <tr className="bg-[#102d72] font-bold text-white">
              <td>{doc.kind === 'EXP' ? 'ยอดสุทธิที่ต้องจ่าย' : 'ยอดชำระ'}</td>
              <td className="text-right">{money(doc.payable)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <SignedRow signers={signers} className="mt-10" />
      {doc.status === 'CANCELLED' && <p className="mt-6 text-center text-lg font-bold text-red-600">ยกเลิกแล้ว: {doc.cancelReason}</p>}
    </div>
  );
}

/** The issued document with print and cancel */
export function SalesDocView({ doc, slug, company, signers }: { doc: SalesDocViewData; slug: string; company: CompanyHeader; signers: Signer[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
        <div className="text-xs text-slate-600">
          {doc.number} · ผู้จัดทำ {doc.creatorName} ·{' '}
          <span className={doc.status === 'ISSUED' ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'}>{doc.status === 'ISSUED' ? 'ออกแล้ว' : 'ยกเลิก'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Printer className="h-4 w-4" /> พิมพ์ / บันทึก PDF
          </button>
          {doc.status === 'ISSUED' && (
            <button type="button" onClick={() => setCancelling((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100">
              <XCircle className="h-4 w-4" /> ยกเลิกเอกสาร
            </button>
          )}
        </div>
      </div>
      {cancelling && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลที่ยกเลิก (จำเป็น)" aria-label="เหตุผลที่ยกเลิก" className="flex-1 rounded border border-red-300 bg-white px-2 py-1.5" />
          <button
            type="button"
            disabled={pending || !reason.trim()}
            onClick={() =>
              startTransition(async () => {
                const r = await cancelSalesDocAction(doc.id, slug, reason);
                if (!r.ok) setError(r.error);
                else {
                  setCancelling(false);
                  router.refresh();
                }
              })
            }
            className="rounded bg-red-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            ยืนยันยกเลิก
          </button>
          {error && <span className="text-red-700">{error}</span>}
        </div>
      )}
      <div className="rounded-sm border border-slate-200 shadow-sm">
        <Paper doc={doc} company={company} signers={signers} />
      </div>
      <PrintRoot>
        <Paper doc={doc} company={company} signers={signers} />
      </PrintRoot>
    </div>
  );
}
