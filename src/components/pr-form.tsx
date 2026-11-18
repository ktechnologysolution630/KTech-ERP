'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { createPrAction, updatePrAction } from '@/app/(app)/pr/actions';
import { DateInput } from '@/components/date-input';
import { ItemCombobox } from '@/components/item-combobox';
import {
  AmountAndNet,
  BoxRow,
  DocPaper,
  MetaRow,
  PaperTh,
  SignatureRow,
  TotalsBox,
  VAT_MODE_LABEL,
  VendorBlock,
  paperBox,
  paperCell,
  paperInput,
  paperTableHead,
  paperTableRow,
  type CompanyHeader,
  type VendorRef,
} from '@/components/doc-paper';
import { computeDocTotals, D, formatMoneyDisplay, parseDecimalInput, type VatMode } from '@/domain/money';
import { duplicatesOfOutstanding, formatQty, type OutstandingPrLine } from '@/domain/pr-outstanding';
import { LINE_KIND_LABEL, PR_TYPE_META, prSignatures, type PrLineKind, type PrType } from '@/domain/pr-type';
import { STOCK_CATEGORIES } from '@/domain/stock';
import { classifyItem, groupOfItemCode, groupsOfCategory } from '@/domain/item-groups';
import type { BoqQtyOption } from '@/server/services/pr-boq';

/** Value of the BOQ picker for a goods line that is not in the BOQ */
const OUTSIDE_BOQ = 'OUTSIDE';

/** A BOQ line's name as an item name: imported sheets often start sub-items with "- " */
const boqName = (description: string) => description.replace(/^\s*-\s*/, '').trim();

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
  /** BOQ line the goods line draws on, OUTSIDE_BOQ, or '' while not chosen */
  boq: string;
  qty: string;
  estUnitPrice: string;
  discount: string;
  /** When this line is needed; the goods form asks it per line */
  neededDate: string;
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
  boq: '',
  qty: '1',
  estUnitPrice: '',
  discount: '',
  neededDate: '',
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
    boqLineId?: string | null;
    outsideBoq?: boolean;
    qty: string;
    estUnitPrice: string | null;
    discount: string;
    neededDate: string | null;
    note: string;
  }[];
}

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
  boqOptions = [],
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
  /** BOQ material lines goods can be asked against, with what approved PRs already ask for */
  boqOptions?: BoqQtyOption[];
}) {
  const router = useRouter();
  const prType = existing?.prType ?? prTypeProp;
  const meta = PR_TYPE_META[prType];
  const priced = meta.priced;
  const hasWork = prType !== 'GOODS';
  const kinds: PrLineKind[] = prType === 'GOODS' ? ['GOODS'] : prType === 'LABOR' ? ['LABOR'] : ['GOODS', 'LABOR'];
  /** The goods form asks when each line is needed; the forms with work keep one date in the header */
  const perLineDate = prType === 'GOODS';

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
      boq: l.boqLineId ?? (l.outsideBoq ? OUTSIDE_BOQ : ''),
      qty: String(Number(l.qty)),
      estUnitPrice: l.estUnitPrice ? String(Number(l.estUnitPrice)) : '',
      discount: Number(l.discount) ? String(Number(l.discount)) : '',
      // PRs written while the date sat in the header carry it there
      neededDate: l.neededDate ?? existing.needBy ?? '',
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
  // BOQ of the chosen project; once it has one, every goods line names its BOQ line or "นอก BOQ"
  const projectBoq = useMemo(() => boqOptions.filter((o) => o.projectId === projectId), [boqOptions, projectId]);
  const hasBoq = projectBoq.length > 0;
  /**
   * BOQ lines a goods line of this category may pick: the BOQ groups of that category, and groups whose
   * name names no category (so nothing in the BOQ is out of reach)
   */
  const boqFor = (category: string) => projectBoq.filter((o) => o.category === category || o.category === null);
  /** The picker's sections: consecutive lines under the same major group of the BOQ */
  const groupBoq = (options: BoqQtyOption[]) => {
    const groups: { label: string; options: BoqQtyOption[] }[] = [];
    for (const o of options) {
      const last = groups.at(-1);
      if (last && last.label === o.group) last.options.push(o);
      else groups.push({ label: o.group, options: [o] });
    }
    return groups;
  };
  /** The line's BOQ choice while it belongs to the chosen project */
  const boqOf = (l: LineState) => (hasBoq && (l.boq === OUTSIDE_BOQ || projectBoq.some((o) => o.id === l.boq)) ? l.boq : '');
  /** Per BOQ line: what this PR asks for and how much of it is beyond the BOQ quantity */
  const boqUse = useMemo(() => {
    const use = new Map<string, { option: BoqQtyOption; thisPr: number; over: number }>();
    for (const l of lines) {
      const option = l.kind === 'GOODS' ? projectBoq.find((o) => o.id === l.boq) : undefined;
      if (!option) continue;
      const u = use.get(option.id) ?? { option, thisPr: 0, over: 0 };
      u.thisPr += num(l.qty).toNumber();
      use.set(option.id, u);
    }
    for (const u of use.values()) u.over = Math.min(u.thisPr, Math.max(0, u.option.requested + u.thisPr - u.option.qty));
    return use;
  }, [lines, projectBoq]);
  const overBoq = [...boqUse.values()].filter((u) => u.over > 0);
  const outsideCount = lines.filter((l) => l.kind === 'GOODS' && boqOf(l) === OUTSIDE_BOQ).length;
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
    // Drafts may wait; a PR sent for approval names the BOQ line of every goods line
    const noBoq = submitNow && hasBoq ? lines.find((l) => l.kind === 'GOODS' && !boqOf(l)) : undefined;
    if (noBoq) {
      setError(`กรุณาเลือกรายการ BOQ ของ "${noBoq.description}" หรือเลือก "นอก BOQ"`);
      return;
    }
    const unpriced = lines.find((l) => l.kind === 'LABOR' && !num(l.estUnitPrice).gt(0));
    if (unpriced) {
      setError(`กรุณาระบุราคาค่าจ้างของรายการ "${unpriced.description}"`);
      return;
    }
    setError(null);
    // The header keeps the earliest date of the lines, for anything that reads one date per PR
    const firstNeeded = lines.map((l) => l.neededDate).filter(Boolean).sort()[0] ?? '';
    const header = {
      prType,
      note,
      docDate: docDate || null,
      needBy: (perLineDate ? firstNeeded : needBy) || null,
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
        itemGroup: l.group || null,
        boqLineId: l.kind === 'GOODS' && boqOf(l) && boqOf(l) !== OUTSIDE_BOQ ? boqOf(l) : null,
        outsideBoq: l.kind === 'GOODS' && boqOf(l) === OUTSIDE_BOQ,
        qty: l.qty,
        estUnitPrice: priced ? l.estUnitPrice || null : null,
        discount: priced ? l.discount || '0' : '0',
        neededDate: (perLineDate ? l.neededDate : needBy) || null,
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
          // A BOQ line outside the new category no longer fits the line
          const boqStays = !line.boq || line.boq === OUTSIDE_BOQ || boqFor(category).some((o) => o.id === line.boq);
          setLine(idx, {
            category,
            group: groupsOfCategory(category).some((g) => g.name === line.group) ? line.group : '',
            ...(boqStays ? {} : { boq: '' }),
          });
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

  /** BOQ picker of a goods line, with what the BOQ allows and whether this PR goes beyond it */
  const boqCell = (line: LineState, idx: number, n: number) => {
    if (!projectId) return <p className="px-1.5 py-1 text-xs text-slate-400">เลือกโครงการก่อน</p>;
    if (!hasBoq) return <p className="px-1.5 py-1 text-xs text-slate-400">โครงการนี้ยังไม่มี BOQ</p>;
    const chosen = boqOf(line);
    const use = chosen && chosen !== OUTSIDE_BOQ ? boqUse.get(chosen) : undefined;
    // The category locks the picker to its own BOQ groups
    const options = line.category ? boqFor(line.category) : [];
    return (
      <>
        <select
          value={chosen}
          disabled={!line.category}
          onChange={(e) => {
            const value = e.target.value;
            const option = projectBoq.find((o) => o.id === value);
            const previous = projectBoq.find((o) => o.id === line.boq);
            // The item takes the BOQ line's name, unless someone wrote their own
            const named = !line.description.trim() || (previous && line.description === boqName(previous.description));
            setLine(idx, {
              boq: value,
              // Quantities are counted in the BOQ's unit
              ...(option?.unit ? { unitName: option.unit } : {}),
              ...(option && named ? { description: boqName(option.description), itemId: '' } : {}),
            });
          }}
          aria-label={`รายการ BOQ ที่ ${n + 1}`}
          aria-invalid={!chosen}
          className={`${paperCell} text-xs disabled:bg-slate-50 disabled:text-slate-400 ${chosen ? '' : 'border-amber-400'}`}
        >
          <option value="">{line.category ? '-- เลือกรายการ BOQ --' : 'เลือกหมวดก่อน'}</option>
          {groupBoq(options).map((g, i) => (
            <optgroup key={`${i}-${g.label}`} label={g.label}>
              {g.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {[o.no, boqName(o.description)].filter(Boolean).join(' ')}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={OUTSIDE_BOQ}>นอก BOQ</option>
        </select>
        {line.category && options.length === 0 && (
          <p className="mt-1 px-1 text-[11px] text-slate-500">BOQ ไม่มีรายการในหมวดนี้</p>
        )}
        {use && (
          <p className="mt-1 px-1 text-[11px] text-slate-500">
            BOQ {formatQty(use.option.qty)} {use.option.unit} · ขอแล้ว {formatQty(use.option.requested)} · เหลือ{' '}
            {formatQty(Math.max(0, use.option.remaining))}
          </p>
        )}
        {use && use.over > 0 && (
          <p className="mt-0.5 px-1 text-[11px] font-semibold text-red-600">
            เกิน BOQ {formatQty(use.over)} {use.option.unit}
          </p>
        )}
        {chosen === OUTSIDE_BOQ && <p className="mt-1 px-1 text-[11px] font-semibold text-orange-600">ไม่มีใน BOQ</p>}
      </>
    );
  };

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
        <table className={`w-full border-collapse text-sm ${work ? 'min-w-[1020px]' : priced ? 'min-w-[1260px]' : 'min-w-[1160px]'}`}>
          <thead className={paperTableHead}>
            <tr>
              <PaperTh th="ลำดับ" en="Item" className="w-12" />
              {/* Both tables read category > group > line */}
              <PaperTh th={work ? 'หมวดหมู่ *' : 'หมวด *'} en="Category" className={perLineDate ? 'w-36' : 'w-40'} />
              <PaperTh th="กลุ่ม" en="Group" className={perLineDate ? 'w-40' : 'w-44'} />
              {/* Goods draw on the BOQ, picked before the item itself; hired work is paid through milestones */}
              {!work && <PaperTh th={`รายการ BOQ${hasBoq ? ' *' : ''}`} en="BOQ No." className="w-60" />}
              <PaperTh th={work ? 'รายการงาน / ขอบเขตงาน' : 'รายการ'} en="Description" />
              <PaperTh th={work ? 'ปริมาณ' : 'จำนวน'} en="Quantity" className="w-24" />
              <PaperTh th="หน่วย" en="Unit" className="w-20" />
              {perLineDate && <PaperTh th="กำหนดใช้/รับของ" en="Required Date" className="w-32" />}
              {priced && (
                <>
                  <PaperTh th={work ? 'ค่าจ้างต่อหน่วย *' : 'ราคา/หน่วย'} en="Unit Price" className="w-28" />
                  <PaperTh th="ส่วนลด" en="Discount" className="w-24" />
                  <PaperTh th="จำนวนเงิน" en="Amount" className="w-28" />
                </>
              )}
              <th className="w-8 border border-[#1668a8]" aria-label="ลบ" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, idx }, n) => (
              <tr key={idx} className={paperTableRow}>
                <td className="border border-slate-200 px-2 py-2 text-center text-slate-500">{n + 1}</td>
                {categoryCell(line, idx, n, work)}
                <td className={td}>
                  <select
                    value={line.group}
                    onChange={(e) => setLine(idx, { group: e.target.value })}
                    disabled={!line.category}
                    aria-label={`กลุ่ม${work ? 'งาน' : 'รายการ'}ที่ ${n + 1}`}
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
                {!work && <td className={td}>{boqCell(line, idx, n)}</td>}
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
                <td className={td}>
                  <input type="number" step="0.001" min={0} value={line.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} aria-label={`${work ? 'ปริมาณงาน' : 'จำนวนรายการ'}ที่ ${n + 1}`} className={`${paperCell} text-right`} />
                </td>
                <td className={td}>
                  <input
                    value={line.unitName}
                    onChange={(e) => setLine(idx, { unitName: e.target.value })}
                    list={work ? 'pr-work-units' : undefined}
                    // A line on a BOQ line counts in the BOQ's unit
                    readOnly={!work && !!boqOf(line) && boqOf(line) !== OUTSIDE_BOQ}
                    title={!work && !!boqOf(line) && boqOf(line) !== OUTSIDE_BOQ ? 'ใช้หน่วยตาม BOQ' : undefined}
                    aria-label={`หน่วย${work ? 'งาน' : 'รายการ'}ที่ ${n + 1}`}
                    className={`${paperCell} read-only:bg-slate-50 read-only:text-slate-600`}
                  />
                </td>
                {perLineDate && (
                  <td className={td}>
                    <DateInput value={line.neededDate} onChange={(e) => setLine(idx, { neededDate: e.target.value })} aria-label={`กำหนดใช้/รับของรายการที่ ${n + 1}`} className={paperCell} />
                  </td>
                )}
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
                <td colSpan={work ? 8 : 9} className="border border-slate-200 px-2 py-1.5 text-right">
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
          // A new line starts on the date of the one above it; most of a requisition is needed together
          onClick={() => setLines((prev) => [...prev, { ...emptyLine(kind), neededDate: prev.filter((l) => l.kind === kind).at(-1)?.neededDate ?? '' }])}
          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-[#1668a8] px-3 py-1.5 text-xs font-medium text-[#1668a8] hover:bg-[#eaf2fa]"
        >
          <Plus className="h-3.5 w-3.5" /> {work ? 'เพิ่มรายการงาน' : 'เพิ่มรายการ'}
        </button>
        {!work && (overBoq.length > 0 || outsideCount > 0) && (
          <div role="status" className="mt-3 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-900">
            <p className="font-semibold">ใบขอซื้อนี้ขอเกิน BOQ: หลัง PM อนุมัติแล้ว ต้องให้เจ้าของอนุมัติอีกขั้น</p>
            <ul className="mt-1 list-disc pl-5">
              {overBoq.map((u) => (
                <li key={u.option.id}>
                  {[u.option.no, u.option.description].filter(Boolean).join(' ')}: เกิน {formatQty(u.over)} {u.option.unit} (BOQ{' '}
                  {formatQty(u.option.qty)} · ขอแล้ว {formatQty(u.option.requested)} · ใบนี้ {formatQty(u.thisPr)})
                </li>
              ))}
              {outsideCount > 0 && <li>นอก BOQ {outsideCount} รายการ</li>}
            </ul>
          </div>
        )}
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
            {!perLineDate && (
              <MetaRow label={prType === 'LABOR' ? 'กำหนดเริ่มงาน:' : 'กำหนดรับของ/เริ่มงาน:'}>
                <DateInput value={needBy} onChange={(e) => setNeedBy(e.target.value)} className={paperInput} />
              </MetaRow>
            )}
            {hasWork && (
              <MetaRow label="กำหนดแล้วเสร็จ:">
                <DateInput value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} className={paperInput} />
              </MetaRow>
            )}
          </>
        }
      >
        {/* Two boxes side by side as on the PDF: the vendor (who asks, on the goods form), then where and for which project */}
        <div className={`${paperBox} grid grid-cols-1 md:grid-cols-[1.1fr_1fr]`}>
          <div className="border-b border-[#9db0c4] md:border-b-0 md:border-r">
            {prType === 'GOODS' ? (
              // The goods form leaves the supplier to purchasing, as the printed PR does: it names who asks
              <BoxRow label="ผู้ขอซื้อ">
                <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="ผู้ขอซื้อ" aria-label="ผู้ขอซื้อ" className={`${paperInput} font-semibold`} />
              </BoxRow>
            ) : (
              <VendorBlock
                title={prType === 'LABOR' ? 'ช่าง / ผู้รับเหมาที่ขอจ้าง' : 'ซัพพลายเออร์ / ผู้รับเหมาอ้างอิง'}
                vendors={vendors}
                vendorId={vendorId}
                onChange={setVendorId}
              />
            )}
          </div>
          <div className="text-sm">
            {prType !== 'GOODS' && (
              <>
                <BoxRow label={prType === 'LABOR' ? 'ผู้ขอจ้าง' : 'ผู้ขอซื้อ'}>
                  <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder={prType === 'LABOR' ? 'ผู้ขอจ้าง' : 'ผู้ขอซื้อ'} aria-label={prType === 'LABOR' ? 'ผู้ขอจ้าง' : 'ผู้ขอซื้อ'} className={paperInput} />
                </BoxRow>
                <BoxRow label="แผนก">
                  <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="แผนก / ฝ่าย" aria-label="แผนก / ฝ่าย" className={paperInput} />
                </BoxRow>
              </>
            )}
            <BoxRow label={prType === 'LABOR' ? 'สถานที่ทำงาน' : prType === 'GOODS' ? 'สถานที่จัดส่ง' : 'สถานที่จัดส่ง / ทำงาน'}>
              <input
                value={deliveryPlace}
                onChange={(e) => setDeliveryPlace(e.target.value)}
                placeholder={prType === 'LABOR' ? 'สถานที่ทำงาน' : prType === 'GOODS' ? 'สถานที่จัดส่ง' : 'สถานที่จัดส่ง / ทำงาน'}
                aria-label={prType === 'LABOR' ? 'สถานที่ทำงาน' : 'สถานที่จัดส่ง'}
                className={paperInput}
              />
            </BoxRow>
            <BoxRow label="Project" required>
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
            </BoxRow>
          </div>
        </div>

        {kinds.map(table)}

        {priced ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-600">
                  คำอธิบาย
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
            <AmountAndNet amount={totals.gross} />
          </div>
        ) : (
          <div className="space-y-2 border-t border-[#9db0c4] pt-3">
            <label className="block text-xs font-semibold text-slate-600">
              คำอธิบาย
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="ระบุจุดใช้งานหรือความเร่งด่วน" className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm font-normal" />
            </label>
            <p className="text-xs text-slate-500">ใบขอซื้อสินค้าไม่ต้องใส่ราคา ฝ่ายจัดซื้อจะหาราคาและออกใบสั่งซื้อ (PO) ให้หลังอนุมัติ</p>
          </div>
        )}

        {/* The same boxes the printed PR carries */}
        <SignatureRow roles={[prSignatures(prType)[0]!, 'ผู้จัดการโครงการ (PM)', 'ผู้บริหาร']} />
      </DocPaper>
    </div>
  );
}
