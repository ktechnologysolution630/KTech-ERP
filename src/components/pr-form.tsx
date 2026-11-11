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
import { duplicatesOfOutstanding, formatQty, type OutstandingPrLine } from '@/domain/pr-outstanding';
import { LINE_KIND_LABEL, PR_TYPE_META, prSignatures, type PrLineKind, type PrType } from '@/domain/pr-type';
import { STOCK_CATEGORIES } from '@/domain/stock';
import { classifyItem, groupOfItemCode, groupsOfCategory } from '@/domain/item-groups';

export interface PrItemOption {
  id: string;
  code: string;
  name: string;
  unitName: string;
  /** Work category kept on the item; the code's group wins when it has one */
  category?: string | null;
  /** Switched-off items stay for labels on older lines but are not offered */
  active?: boolean;
}

interface LineState {
  kind: PrLineKind;
  itemId: string;
  description: string;
  detail: string;
  unitName: string;
  category: string;
  /** Item group under the category; goods only */
  group: string;
  qty: string;
  estUnitPrice: string;
  discount: string;
  note: string;
}

const emptyLine = (kind: PrLineKind): LineState => ({
  kind,
  itemId: '',
  description: '',
  detail: '',
  unitName: kind === 'LABOR' ? 'งาน' : 'ชิ้น',
  category: '',
  group: '',
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
  prType: PrType;
  projectId: string;
  note: string;
  docDate: string | null;
  needBy: string | null;
  workEnd: string | null;
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
    lineKind: PrLineKind;
    unitName: string;
    category: string | null;
    itemGroup: string | null;
    qty: string;
    estUnitPrice: string | null;
    discount: string;
    neededDate: string | null;
    note: string;
  }[];
}

const th = 'border border-[#102d72] px-2 py-2';
const td = 'border border-slate-200 px-1 py-1';

/**
 * The requisition, laid out like the printed document. Three forms share it: goods without prices,
 * hired work with prices, and goods and work together. Goods lines read category, group, item,
 * quantity, unit.
 */
export function PrForm({
  prType: prTypeProp = 'GOODS',
  projects,
  items,
  vendors,
  company,
  currentUserName,
  today,
  existing,
  outstanding = [],
}: {
  /** Form for a new PR; an existing PR keeps its own */
  prType?: PrType;
  projects: { id: string; code: string; name: string }[];
  items: PrItemOption[];
  vendors: VendorRef[];
  company: CompanyHeader;
  currentUserName: string;
  today: string;
  existing?: PrFormExisting;
  /** Lines of open PRs not received in full; a line asking for the same thing again is pointed out */
  outstanding?: OutstandingPrLine[];
}) {
  const router = useRouter();
  const prType = existing?.prType ?? prTypeProp;
  const meta = PR_TYPE_META[prType];
  const priced = meta.priced;
  const hasWork = prType !== 'GOODS';
  const kinds: PrLineKind[] = prType === 'GOODS' ? ['GOODS'] : prType === 'LABOR' ? ['LABOR'] : ['GOODS', 'LABOR'];

  const [projectId, setProjectId] = useState(existing?.projectId ?? '');
  const [docDate, setDocDate] = useState(existing?.docDate ?? today);
  // Older PRs kept the date per line; the earliest one becomes the header date
  const [needBy, setNeedBy] = useState(
    existing?.needBy ?? existing?.lines.map((l) => l.neededDate).filter((d): d is string => !!d).sort()[0] ?? '',
  );
  const [workEnd, setWorkEnd] = useState(existing?.workEnd ?? '');
  const [vendorId, setVendorId] = useState(existing?.vendorId ?? '');
  const [department, setDepartment] = useState(existing?.department ?? '');
  const [requester, setRequester] = useState(existing?.requesterText || currentUserName);
  const [deliveryPlace, setDeliveryPlace] = useState(existing?.deliveryPlace ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [paymentTerms, setPaymentTerms] = useState(existing?.paymentTerms ?? '');
  const [vatMode, setVatMode] = useState<VatMode>(existing?.vatMode ?? (prType === 'LABOR' ? 'NONE' : 'EXCLUSIVE'));
  const [billDiscount, setBillDiscount] = useState(existing && Number(existing.billDiscount) ? String(Number(existing.billDiscount)) : '');
  const [lines, setLines] = useState<LineState[]>(
    existing?.lines.map((l) => ({
      // A PR keeps its form, so a line of the other kind cannot exist outside the combined form
      kind: prType === 'GOODS' ? 'GOODS' : prType === 'LABOR' ? 'LABOR' : l.lineKind,
      itemId: l.itemId ?? '',
      description: l.description,
      detail: l.detail ?? '',
      unitName: l.unitName,
      category: l.category ?? '',
      group: l.itemGroup ?? '',
      qty: String(Number(l.qty)),
      estUnitPrice: l.estUnitPrice ? String(Number(l.estUnitPrice)) : '',
      discount: Number(l.discount) ? String(Number(l.discount)) : '',
      note: l.note ?? '',
    })) ?? kinds.map(emptyLine),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pickableItems = items.filter((i) => i.active !== false);
  /** Items of the line's group, else of its category; the whole register when neither narrows it */
  const itemsFor = (line: LineState) => {
    if (line.group) {
      const inGroup = pickableItems.filter((i) => groupOfItemCode(i.code)?.name === line.group && classifyItem(i).category === line.category);
      if (inGroup.length > 0) return inGroup;
    }
    if (line.category) {
      const inCategory = pickableItems.filter((i) => classifyItem(i).category === line.category);
      if (inCategory.length > 0) return inCategory;
    }
    return pickableItems;
  };
  const itemLabel = (id: string) => {
    const it = items.find((i) => i.id === id);
    return it ? `${it.code} - ${it.name}` : '';
  };
  const setLine = (idx: number, patch: Partial<LineState>) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const amountOf = (l: LineState) => num(l.qty).times(num(l.estUnitPrice)).minus(num(l.discount));

  const totals = useMemo(
    () =>
      computeDocTotals({
        vatMode,
        billDiscount: priced ? num(billDiscount) : D(0),
        shipping: D(0),
        lines: lines.map((l) => ({ qty: num(l.qty), unitPrice: priced ? num(l.estUnitPrice) : D(0), discount: priced ? num(l.discount) : D(0) })),
      }),
    [lines, billDiscount, vatMode, priced],
  );
  const subtotalOf = (kind: PrLineKind) => lines.filter((l) => l.kind === kind).reduce((s, l) => s.plus(amountOf(l)), D(0));

  // Per line: what earlier PRs of this project asked for and are still waiting on (goods only)
  const repeats = useMemo(
    () => lines.map((l) => (l.kind === 'GOODS' ? duplicatesOfOutstanding(l, outstanding, { projectId, exceptPrId: existing?.id }) : [])),
    [lines, outstanding, projectId, existing?.id],
  );
  const repeatedLines = repeats.filter((r) => r.length > 0).length;
  const repeatedPrs = [...new Map(repeats.flat().map((o) => [o.prId, o.prNumber])).entries()];

  function handleSave(submitNow: boolean) {
    if (!projectId) {
      setError('กรุณาเลือกโครงการ');
      return;
    }
    const unnamed = lines.findIndex((l) => !l.description.trim());
    if (unnamed >= 0) {
      setError(`กรุณากรอกชื่อรายการ${lines[unnamed]!.kind === 'LABOR' ? 'งาน' : 'สินค้า'}ให้ครบ`);
      return;
    }
    const missing = lines.findIndex((l) => !l.category);
    if (missing >= 0) {
      setError(`กรุณาเลือกหมวดหมู่ของรายการ "${lines[missing]!.description}"`);
      return;
    }
    const unpriced = lines.find((l) => l.kind === 'LABOR' && !num(l.estUnitPrice).gt(0));
    if (unpriced) {
      setError(`กรุณาระบุราคาค่าจ้างของรายการ "${unpriced.description}"`);
      return;
    }
    setError(null);
    const header = {
      prType,
      note,
      docDate: docDate || null,
      needBy: needBy || null,
      workEnd: hasWork ? workEnd || null : null,
      vendorId: vendorId || null,
      department,
      requesterName: requester,
      deliveryPlace,
      paymentTerms: priced ? paymentTerms : '',
      vatMode,
      billDiscount: priced ? billDiscount || '0' : '0',
      submitNow,
      lines: lines.map((l) => ({
        lineKind: l.kind,
        itemId: l.kind === 'GOODS' ? l.itemId || null : null,
        description: l.description,
        detail: l.detail,
        unitName: l.unitName,
        category: l.category || null,
        itemGroup: l.kind === 'GOODS' ? l.group || null : null,
        qty: l.qty,
        estUnitPrice: priced ? l.estUnitPrice || null : null,
        discount: priced ? l.discount || '0' : '0',
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

  /** Category picker of a line; choosing another category drops a group that is not under it */
  const categoryCell = (line: LineState, idx: number, n: number, work: boolean) => (
    <td className={td}>
      <select
        value={line.category}
        onChange={(e) => {
          const category = e.target.value;
          setLine(idx, { category, group: groupsOfCategory(category).some((g) => g.name === line.group) ? line.group : '' });
        }}
        aria-label={`หมวด${work ? 'หมู่งาน' : 'รายการ'}ที่ ${n + 1}`}
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
  );

  /** The line table of one kind; in the combined form there is one for goods and one for work */
  const table = (kind: PrLineKind) => {
    const rows = lines.map((line, idx) => ({ line, idx })).filter((r) => r.line.kind === kind);
    const work = kind === 'LABOR';
    return (
      <div className="overflow-x-auto" key={kind}>
        {prType === 'GOODS_AND_LABOR' && (
          <p className="mb-1.5 text-sm font-bold text-slate-800">
            ส่วนที่ {work ? 2 : 1} · {LINE_KIND_LABEL[kind]}
          </p>
        )}
        <table className={`w-full border-collapse text-sm ${priced ? (work ? 'min-w-[860px]' : 'min-w-[1020px]') : 'min-w-[780px]'}`}>
          <thead className="bg-[#102d72] text-xs text-white">
            <tr>
              <th className={`w-12 ${th}`}>ลำดับ</th>
              {!work && (
                <>
                  <th className={`w-40 ${th}`}>หมวด *</th>
                  <th className={`w-44 ${th}`}>กลุ่ม</th>
                </>
              )}
              <th className={th}>{work ? 'รายการงาน / ขอบเขตงาน' : 'รายการ'}</th>
              {work && <th className={`w-40 ${th}`}>หมวดหมู่ *</th>}
              <th className={`w-24 ${th}`}>{work ? 'ปริมาณ' : 'จำนวน'}</th>
              <th className={`w-20 ${th}`}>หน่วย</th>
              {priced && (
                <>
                  <th className={`w-28 ${th}`}>
                    {work ? 'ค่าจ้างต่อหน่วย *' : 'ราคาต่อหน่วย'}
                  </th>
                  <th className={`w-24 ${th}`}>ส่วนลด</th>
                  <th className={`w-28 ${th}`}>จำนวนเงิน</th>
                </>
              )}
              <th className="w-8 border border-[#102d72]" aria-label="ลบ" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, idx }, n) => (
              <tr key={idx} className="align-top">
                <td className="border border-slate-200 px-2 py-2 text-center text-slate-500">{n + 1}</td>
                {!work && (
                  <>
                    {categoryCell(line, idx, n, work)}
                    <td className={td}>
                      <select
                        value={line.group}
                        onChange={(e) => setLine(idx, { group: e.target.value })}
                        disabled={!line.category}
                        aria-label={`กลุ่มรายการที่ ${n + 1}`}
                        className={`${paperCell} text-xs disabled:bg-slate-50 disabled:text-slate-400`}
                      >
                        <option value="">{line.category ? '-- เลือกกลุ่ม --' : 'เลือกหมวดก่อน'}</option>
                        {groupsOfCategory(line.category).map((g) => (
                          <option key={g.code} value={g.name}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </>
                )}
                <td className={td}>
                  {work ? (
                    <input
                      value={line.description}
                      onChange={(e) => setLine(idx, { description: e.target.value })}
                      placeholder="เช่น ค่าแรงก่ออิฐฉาบปูน, จ้างเดินท่อประปา"
                      aria-label={`รายการงานที่ ${n + 1}`}
                      className={`${paperCell} font-medium`}
                    />
                  ) : (
                    <ItemCombobox
                      items={itemsFor(line)}
                      selectedId={line.itemId}
                      value={line.itemId ? itemLabel(line.itemId) : line.description}
                      // Typing is free text: it becomes the item name and drops any picked item
                      onType={(text) => setLine(idx, { itemId: '', description: text })}
                      onPick={(chosen) => {
                        const item = items.find((it) => it.id === chosen.id);
                        // The register knows where the item belongs; keep what was chosen when it does not
                        const placed = item ? classifyItem(item) : null;
                        setLine(idx, {
                          itemId: chosen.id,
                          description: chosen.name,
                          unitName: item?.unitName || line.unitName,
                          category: placed?.category || line.category,
                          group: placed?.category ? placed.group : line.group,
                        });
                      }}
                    />
                  )}
                  <textarea
                    value={line.detail}
                    onChange={(e) => setLine(idx, { detail: e.target.value })}
                    placeholder={work ? 'รายละเอียดงาน / พื้นที่ทำงาน' : 'รายละเอียด'}
                    rows={1}
                    aria-label={`รายละเอียด${work ? 'งาน' : 'รายการ'}ที่ ${n + 1}`}
                    className={`${paperCell} mt-1 resize-y text-xs text-slate-600`}
                  />
                  {repeats[idx]!.length > 0 && (
                    <ul className="mt-1 space-y-0.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900" aria-label={`ยอดค้างรับของรายการที่ ${n + 1}`}>
                      {repeats[idx]!.map((o) => (
                        <li key={o.prLineId}>
                          ยังค้างรับ{' '}
                          <strong>
                            {formatQty(o.outstandingQty)} {o.unitName}
                          </strong>{' '}
                          จาก{' '}
                          <a href={`/pr/${o.prId}`} target="_blank" rel="noreferrer" className="font-semibold underline">
                            {o.prNumber}
                          </a>{' '}
                          (ขอ {formatQty(o.qty)} รับแล้ว {formatQty(o.receivedQty)})
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                {work && categoryCell(line, idx, n, work)}
                <td className={td}>
                  <input type="number" step="0.001" min={0} value={line.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} aria-label={`${work ? 'ปริมาณงาน' : 'จำนวนรายการ'}ที่ ${n + 1}`} className={`${paperCell} text-right`} />
                </td>
                <td className={td}>
                  <input value={line.unitName} onChange={(e) => setLine(idx, { unitName: e.target.value })} list={work ? 'pr-work-units' : undefined} aria-label={`หน่วย${work ? 'งาน' : 'รายการ'}ที่ ${n + 1}`} className={paperCell} />
                </td>
                {priced && (
                  <>
                    <td className={td}>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={line.estUnitPrice}
                        onChange={(e) => setLine(idx, { estUnitPrice: e.target.value })}
                        placeholder="0.00"
                        aria-label={`${work ? 'ค่าจ้างต่อหน่วยงาน' : 'ราคาต่อหน่วยรายการ'}ที่ ${n + 1}`}
                        className={`${paperCell} text-right ${work && !num(line.estUnitPrice).gt(0) ? 'border-amber-400' : ''}`}
                      />
                    </td>
                    <td className={td}>
                      <input type="number" step="0.01" min={0} value={line.discount} onChange={(e) => setLine(idx, { discount: e.target.value })} placeholder="0.00" aria-label={`ส่วนลด${work ? 'งาน' : 'รายการ'}ที่ ${n + 1}`} className={`${paperCell} text-right`} />
                    </td>
                    <td className="border border-slate-200 px-2 py-2 text-right font-medium">{formatMoneyDisplay(amountOf(line).toFixed(2))}</td>
                  </>
                )}
                <td className="border border-slate-200 px-1 py-2 text-center">
                  {rows.length > 1 && (
                    <button type="button" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-600" title={`ลบ${work ? 'งาน' : 'รายการ'}ที่ ${n + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {priced && prType === 'GOODS_AND_LABOR' && (
            <tfoot>
              <tr className="bg-slate-50 text-sm font-semibold">
                <td colSpan={work ? 7 : 8} className="border border-slate-200 px-2 py-1.5 text-right">
                  รวม{work ? 'ค่าจ้าง / ค่าแรง' : 'ค่าสินค้า / วัสดุ'}
                </td>
                <td className="border border-slate-200 px-2 py-1.5 text-right">{formatMoneyDisplay(subtotalOf(kind).toFixed(2))}</td>
                <td className="border border-slate-200" />
              </tr>
            </tfoot>
          )}
        </table>
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, emptyLine(kind)])}
          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-[#2453d4] px-3 py-1.5 text-xs font-medium text-[#2453d4] hover:bg-blue-50"
        >
          <Plus className="h-3.5 w-3.5" /> {work ? 'เพิ่มรายการงาน' : 'เพิ่มรายการ'}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <span className="mr-auto rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#2453d4]">แบบฟอร์ม: {meta.label}</span>
        {error && (
          <p role="alert" className="text-xs font-medium text-red-600">
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

      {repeatedLines > 0 && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            มี {repeatedLines} รายการในใบนี้ที่ขอซื้อไว้แล้วและยังได้รับไม่ครบ จากใบขอซื้อเลขที่{' '}
            {repeatedPrs.map(([id, number], i) => (
              <span key={id}>
                {i > 0 && ', '}
                <a href={`/pr/${id}`} target="_blank" rel="noreferrer" className="underline">
                  {number}
                </a>
              </span>
            ))}
          </p>
          <p className="mt-0.5 text-xs">ดูยอดค้างรับใต้แต่ละรายการ ถ้าของเดิมกำลังจะมาส่ง อาจไม่ต้องขอซื้อซ้ำ ระบบไม่ได้ห้ามบันทึก</p>
        </div>
      )}

      <datalist id="pr-work-units">
        {['งาน', 'ตร.ม.', 'ม.', 'จุด', 'ชุด', 'วัน', 'คน-วัน', 'เหมา'].map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <DocPaper
        company={company}
        titleTh={meta.titleTh}
        titleEn={meta.titleEn}
        meta={
          <>
            <MetaRow label="เลขที่:">
              <input value={existing?.number ?? 'ออกเลขอัตโนมัติเมื่อบันทึก'} readOnly className={`${paperInput} text-slate-500`} />
            </MetaRow>
            <MetaRow label="แบบฟอร์ม:">
              <input value={meta.short} readOnly className={`${paperInput} text-slate-500`} />
            </MetaRow>
            <MetaRow label="วันที่:">
              <DateInput value={docDate} onChange={(e) => setDocDate(e.target.value)} className={paperInput} />
            </MetaRow>
            <MetaRow label={prType === 'LABOR' ? 'กำหนดเริ่มงาน:' : prType === 'GOODS' ? 'กำหนดใช้/รับของ:' : 'กำหนดรับของ/เริ่มงาน:'}>
              <DateInput value={needBy} onChange={(e) => setNeedBy(e.target.value)} className={paperInput} />
            </MetaRow>
            {hasWork && (
              <MetaRow label="กำหนดแล้วเสร็จ:">
                <DateInput value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} className={paperInput} />
              </MetaRow>
            )}
          </>
        }
      >
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <VendorBlock
            title={prType === 'LABOR' ? 'ช่าง / ผู้รับเหมาที่ขอจ้าง' : prType === 'GOODS' ? 'ซัพพลายเออร์อ้างอิง' : 'ซัพพลายเออร์ / ผู้รับเหมาอ้างอิง'}
            vendors={vendors}
            vendorId={vendorId}
            onChange={setVendorId}
          />
          <div className="space-y-2 text-sm">
            <p className="text-xs font-semibold text-slate-600">
              โครงการ / ผู้ขอ <span className="text-red-500">*</span>
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
            <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder={prType === 'LABOR' ? 'ผู้ขอจ้าง' : 'ผู้ขอซื้อ'} aria-label={prType === 'LABOR' ? 'ผู้ขอจ้าง' : 'ผู้ขอซื้อ'} className={paperInput} />
            <input
              value={deliveryPlace}
              onChange={(e) => setDeliveryPlace(e.target.value)}
              placeholder={prType === 'LABOR' ? 'สถานที่ทำงาน' : prType === 'GOODS' ? 'สถานที่จัดส่ง' : 'สถานที่จัดส่ง / ทำงาน'}
              aria-label={prType === 'LABOR' ? 'สถานที่ทำงาน' : 'สถานที่จัดส่ง'}
              className={paperInput}
            />
          </div>
        </div>

        {kinds.map(table)}

        {priced ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <AmountInWords amount={totals.gross} />
              <label className="block text-xs font-semibold text-slate-600">
                หมายเหตุ
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm font-normal" />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                {hasWork ? 'เงื่อนไขการจ่ายเงิน / งวดงาน' : 'เงื่อนไขการชำระเงิน'}
                <input
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder={hasWork ? 'เช่น จ่ายเมื่องานแล้วเสร็จ / แบ่ง 2 งวด 50-50' : undefined}
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm font-normal"
                />
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
        ) : (
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600">
              หมายเหตุ
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="ระบุจุดใช้งานหรือความเร่งด่วน" className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm font-normal" />
            </label>
            <p className="text-xs text-slate-500">ใบขอซื้อสินค้าไม่ต้องใส่ราคา ฝ่ายจัดซื้อจะหาราคาและออกใบสั่งซื้อ (PO) ให้หลังอนุมัติ</p>
          </div>
        )}

        <SignatureRow roles={prSignatures(prType)} />
      </DocPaper>
    </div>
  );
}
