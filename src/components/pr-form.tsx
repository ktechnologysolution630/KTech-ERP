'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { createPrAction, updatePrAction } from '@/app/(app)/pr/actions';
import { DateInput } from '@/components/date-input';
import { ItemCombobox } from '@/components/item-combobox';
import {
  AmountInWords,
  DocPaper,
  MetaRow,
  SignatureRow,
  TotalsBox,
  VAT_MODE_LABEL,
  VendorBlock,
  paperCell,
  paperInput,
  type CompanyHeader,
  type VendorRef,
} from '@/components/doc-paper';
import { computeDocTotals, D, formatMoneyDisplay, parseDecimalInput, type VatMode } from '@/domain/money';
import { STOCK_CATEGORIES } from '@/domain/stock';

export interface PrItemOption {
  id: string;
  code: string;
  name: string;
  unitName: string;
  /** Switched-off items stay for labels on older lines but are not offered */
  active?: boolean;
}

interface LineState {
  itemId: string;
  description: string;
  detail: string;
  unitName: string;
  category: string;
  qty: string;
  estUnitPrice: string;
  discount: string;
  note: string;
}

const emptyLine = (): LineState => ({
  itemId: '',
  description: '',
  detail: '',
  unitName: 'ชิ้น',
  category: '',
  qty: '1',
  estUnitPrice: '',
  discount: '',
  note: '',
});

/** A typed number, or zero while the field is empty or half-typed */
function num(v: string) {
  const d = parseDecimalInput(v);
  return d && d.isFinite() ? d : D(0);
}

export interface PrFormExisting {
  id: string;
  number: string;
  projectId: string;
  note: string;
  docDate: string | null;
  needBy: string | null;
  vendorId: string | null;
  department: string;
  requesterText: string;
  deliveryPlace: string;
  paymentTerms: string;
  vatMode: VatMode;
  billDiscount: string;
  lines: {
    itemId: string | null;
    description: string;
    detail: string;
    unitName: string;
    category: string | null;
    qty: string;
    estUnitPrice: string | null;
    discount: string;
    neededDate: string | null;
    note: string;
  }[];
}

/** The purchase requisition, laid out like the printed document */
export function PrForm({
  projects,
  items,
  vendors,
  company,
  currentUserName,
  today,
  existing,
}: {
  projects: { id: string; code: string; name: string }[];
  items: PrItemOption[];
  vendors: VendorRef[];
  company: CompanyHeader;
  currentUserName: string;
  today: string;
  existing?: PrFormExisting;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(existing?.projectId ?? '');
  const [docDate, setDocDate] = useState(existing?.docDate ?? today);
  // Older PRs kept the date per line; the earliest one becomes the header date
  const [needBy, setNeedBy] = useState(
    existing?.needBy ?? existing?.lines.map((l) => l.neededDate).filter((d): d is string => !!d).sort()[0] ?? '',
  );
  const [vendorId, setVendorId] = useState(existing?.vendorId ?? '');
  const [department, setDepartment] = useState(existing?.department ?? '');
  const [requester, setRequester] = useState(existing?.requesterText || currentUserName);
  const [deliveryPlace, setDeliveryPlace] = useState(existing?.deliveryPlace ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [paymentTerms, setPaymentTerms] = useState(existing?.paymentTerms ?? '');
  const [vatMode, setVatMode] = useState<VatMode>(existing?.vatMode ?? 'EXCLUSIVE');
  const [billDiscount, setBillDiscount] = useState(existing && Number(existing.billDiscount) ? String(Number(existing.billDiscount)) : '');
  const [lines, setLines] = useState<LineState[]>(
    existing?.lines.map((l) => ({
      itemId: l.itemId ?? '',
      description: l.description,
      detail: l.detail ?? '',
      unitName: l.unitName,
      category: l.category ?? '',
      qty: String(Number(l.qty)),
      estUnitPrice: l.estUnitPrice ? String(Number(l.estUnitPrice)) : '',
      discount: Number(l.discount) ? String(Number(l.discount)) : '',
      note: l.note ?? '',
    })) ?? [emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pickableItems = items.filter((i) => i.active !== false);
  const itemLabel = (id: string) => {
    const it = items.find((i) => i.id === id);
    return it ? `${it.code} - ${it.name}` : '';
  };
  const setLine = (idx: number, patch: Partial<LineState>) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const totals = useMemo(
    () =>
      computeDocTotals({
        vatMode,
        billDiscount: num(billDiscount),
        shipping: D(0),
        lines: lines.map((l) => ({ qty: num(l.qty), unitPrice: num(l.estUnitPrice), discount: num(l.discount) })),
      }),
    [lines, billDiscount, vatMode],
  );

  function handleSave(submitNow: boolean) {
    if (!projectId) {
      setError('กรุณาเลือกโครงการ');
      return;
    }
    const missing = lines.findIndex((l) => !l.category);
    if (missing >= 0) {
      setError(`กรุณาเลือกหมวดหมู่ของรายการที่ ${missing + 1}`);
      return;
    }
    setError(null);
    const header = {
      note,
      docDate: docDate || null,
      needBy: needBy || null,
      vendorId: vendorId || null,
      department,
      requesterName: requester,
      deliveryPlace,
      paymentTerms,
      vatMode,
      billDiscount: billDiscount || '0',
      submitNow,
      lines: lines.map((l) => ({
        itemId: l.itemId || null,
        description: l.description,
        detail: l.detail,
        unitName: l.unitName,
        category: l.category || null,
        qty: l.qty,
        estUnitPrice: l.estUnitPrice || null,
        discount: l.discount || '0',
        neededDate: needBy || null,
        note: l.note,
      })),
    };
    startTransition(async () => {
      const r = existing ? await updatePrAction(existing.id, header) : await createPrAction({ projectId, ...header });
      // Success redirects; only a refusal comes back
      if (r && !r.ok) setError(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        {error && (
          <p role="alert" className="mr-auto text-xs font-medium text-red-600">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSave(false)}
          className="rounded-lg border border-[#2453d4] bg-white px-4 py-2 text-sm font-medium text-[#2453d4] hover:bg-blue-50 disabled:opacity-50"
        >
          บันทึกร่าง
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSave(true)}
          className="rounded-lg bg-[#2453d4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-50"
        >
          {pending ? 'กำลังบันทึก...' : 'สร้างเอกสารและส่งขออนุมัติ'}
        </button>
      </div>

      <DocPaper
        company={company}
        titleTh="ใบขอซื้อ"
        titleEn="PURCHASE REQUISITION"
        meta={
          <>
            <MetaRow label="เลขที่:">
              <input value={existing?.number ?? 'ออกเลขอัตโนมัติเมื่อบันทึก'} readOnly className={`${paperInput} text-slate-500`} />
            </MetaRow>
            <MetaRow label="ประเภท:">
              <select
                value="PR"
                onChange={(e) => {
                  if (e.target.value === 'PO') router.push(projectId ? `/po/new?projectId=${projectId}` : '/po/new');
                }}
                className={paperInput}
              >
                <option value="PR">PR</option>
                <option value="PO">PO</option>
              </select>
            </MetaRow>
            <MetaRow label="วันที่:">
              <DateInput value={docDate} onChange={(e) => setDocDate(e.target.value)} className={paperInput} />
            </MetaRow>
            <MetaRow label="กำหนดใช้/รับของ:">
              <DateInput value={needBy} onChange={(e) => setNeedBy(e.target.value)} className={paperInput} />
            </MetaRow>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <VendorBlock title="ซัพพลายเออร์ / ผู้รับเหมาอ้างอิง" vendors={vendors} vendorId={vendorId} onChange={setVendorId} />
          <div className="space-y-2 text-sm">
            <p className="text-xs font-semibold text-slate-600">
              โครงการ / ผู้ขอซื้อ <span className="text-red-500">*</span>
            </p>
            <select
              disabled={Boolean(existing)}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              aria-label="โครงการ"
              className={`${paperInput} font-semibold disabled:text-slate-500`}
            >
              <option value="">เลือกโครงการ</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.name}
                </option>
              ))}
            </select>
            <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="แผนก / ฝ่าย" aria-label="แผนก / ฝ่าย" className={paperInput} />
            <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="ผู้ขอซื้อ" aria-label="ผู้ขอซื้อ" className={paperInput} />
            <input value={deliveryPlace} onChange={(e) => setDeliveryPlace(e.target.value)} placeholder="สถานที่จัดส่ง" aria-label="สถานที่จัดส่ง" className={paperInput} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="bg-[#102d72] text-xs text-white">
              <tr>
                <th className="w-12 border border-[#102d72] px-2 py-2">ลำดับ</th>
                <th className="border border-[#102d72] px-2 py-2">รายการ</th>
                <th className="w-40 border border-[#102d72] px-2 py-2">หมวดหมู่ *</th>
                <th className="w-24 border border-[#102d72] px-2 py-2">จำนวน</th>
                <th className="w-20 border border-[#102d72] px-2 py-2">หน่วย</th>
                <th className="w-28 border border-[#102d72] px-2 py-2">ราคาต่อหน่วย</th>
                <th className="w-24 border border-[#102d72] px-2 py-2">ส่วนลด</th>
                <th className="w-28 border border-[#102d72] px-2 py-2">จำนวนเงิน</th>
                <th className="w-8 border border-[#102d72]" aria-label="ลบ" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx} className="align-top">
                  <td className="border border-slate-200 px-2 py-2 text-center text-slate-500">{idx + 1}</td>
                  <td className="border border-slate-200 px-1 py-1">
                    <ItemCombobox
                      items={pickableItems}
                      selectedId={line.itemId}
                      value={line.itemId ? itemLabel(line.itemId) : line.description}
                      // Typing is free text: it becomes the item name and drops any picked item
                      onType={(text) => setLine(idx, { itemId: '', description: text })}
                      onPick={(chosen) =>
                        setLine(idx, { itemId: chosen.id, description: chosen.name, unitName: items.find((it) => it.id === chosen.id)?.unitName || line.unitName })
                      }
                    />
                    <textarea
                      value={line.detail}
                      onChange={(e) => setLine(idx, { detail: e.target.value })}
                      placeholder="รายละเอียด"
                      rows={1}
                      aria-label={`รายละเอียดรายการที่ ${idx + 1}`}
                      className={`${paperCell} mt-1 resize-y text-xs text-slate-600`}
                    />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <select
                      value={line.category}
                      onChange={(e) => setLine(idx, { category: e.target.value })}
                      aria-label={`หมวดหมู่รายการที่ ${idx + 1}`}
                      aria-invalid={!line.category}
                      className={`${paperCell} text-xs ${line.category ? '' : 'border-amber-400'}`}
                    >
                      <option value="">-- เลือกหมวด --</option>
                      {STOCK_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input type="number" step="0.001" min={0} value={line.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} aria-label={`จำนวนรายการที่ ${idx + 1}`} className={`${paperCell} text-right`} />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input value={line.unitName} onChange={(e) => setLine(idx, { unitName: e.target.value })} aria-label={`หน่วยรายการที่ ${idx + 1}`} className={paperCell} />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input type="number" step="0.01" min={0} value={line.estUnitPrice} onChange={(e) => setLine(idx, { estUnitPrice: e.target.value })} placeholder="0.00" aria-label={`ราคาต่อหน่วยรายการที่ ${idx + 1}`} className={`${paperCell} text-right`} />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input type="number" step="0.01" min={0} value={line.discount} onChange={(e) => setLine(idx, { discount: e.target.value })} placeholder="0.00" aria-label={`ส่วนลดรายการที่ ${idx + 1}`} className={`${paperCell} text-right`} />
                  </td>
                  <td className="border border-slate-200 px-2 py-2 text-right font-medium">
                    {formatMoneyDisplay(num(line.qty).times(num(line.estUnitPrice)).minus(num(line.discount)).toFixed(2))}
                  </td>
                  <td className="border border-slate-200 px-1 py-2 text-center">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-600" title={`ลบรายการที่ ${idx + 1}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-[#2453d4] px-3 py-1.5 text-xs font-medium text-[#2453d4] hover:bg-blue-50"
          >
            <Plus className="h-3.5 w-3.5" /> เพิ่มรายการ
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <AmountInWords amount={totals.gross} />
            <label className="block text-xs font-semibold text-slate-600">
              หมายเหตุ
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm font-normal" />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              เงื่อนไขการชำระเงิน
              <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm font-normal" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-slate-600">
                รูปแบบ VAT
                <select value={vatMode} onChange={(e) => setVatMode(e.target.value as VatMode)} className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm font-normal">
                  {(['EXCLUSIVE', 'INCLUSIVE', 'NONE'] as const).map((m) => (
                    <option key={m} value={m}>
                      {VAT_MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                VAT (%)
                <input value={vatMode === 'NONE' ? '0' : '7'} readOnly className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm font-normal text-slate-500" />
              </label>
            </div>
          </div>
          <TotalsBox totals={totals} billDiscount={billDiscount} onBillDiscount={setBillDiscount} vatMode={vatMode} />
        </div>

        <SignatureRow roles={['ผู้ขอซื้อ', 'ผู้จัดทำ', 'ผู้อนุมัติ']} />
      </DocPaper>
    </div>
  );
}
