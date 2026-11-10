'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Paperclip, Plus, X } from 'lucide-react';
import type { StockPageData } from '@/server/services/stock';
import type { BoqPickCategory, StockDocRow } from '@/server/services/stock-docs';
import { D, formatMoneyDisplay, round2 } from '@/domain/money';
import { DateInput } from '@/components/date-input';
import { createStockDocAction } from './actions';

export type StockDocKind = 'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'BORROW';
export interface StockDocOptions {
  vendors: { id: string; code: string; name: string }[];
  /** Saved documents for the history list */
  docs: StockDocRow[];
  boqTree: BoqPickCategory[];
  meName: string;
  today: string;
}

const KIND_LABEL: Record<StockDocKind, string> = { RECEIVE: 'รับเข้า', ISSUE: 'จ่ายออก', TRANSFER: 'โอนย้าย', BORROW: 'ยืม' };
const STATUS_LABEL: Record<StockDocKind, string> = { RECEIVE: 'พร้อมรับเข้า', ISSUE: 'จ่ายออก', TRANSFER: 'โอนย้าย', BORROW: 'ยืม' };
const ISSUE_KINDS = [
  ['MATERIAL_ISSUE', 'เบิกใช้หน้างาน'],
  ['RETURN_IN', 'คืนเข้าสต็อก'],
  ['RETURN_SUPPLIER', 'คืนผู้ขาย'],
  ['DAMAGE_LOSS', 'ชำรุด/สูญหาย'],
  ['OTHER', 'อื่นๆ'],
] as const;
const TAX_TYPES = [
  ['VAT7', 'VAT 7%'],
  ['NONE', 'ไม่มี VAT'],
  ['INCLUSIVE', 'รวม VAT'],
  ['EXEMPT', 'ยกเว้น VAT'],
] as const;
const ACCOUNTING_METHODS = [
  ['STOCK', 'เข้าทรัพย์สินสต็อก'],
  ['PROJECT_COST', 'บันทึกต้นทุนโครงการทันที'],
  ['EXPENSE', 'บันทึกเป็นค่าใช้จ่าย'],
] as const;
const ACCOUNTING_STATUS = [
  ['PENDING', 'รอดำเนินการ'],
  ['AWAITING_TAX_INVOICE', 'รอใบกำกับภาษี'],
  ['POSTED', 'บันทึกแล้ว'],
] as const;
const ACCOUNTS = ['Inventory', 'Site Inventory', 'Project Cost', 'Consumable Expense', 'Trade Payables', 'GRNI', 'Input VAT'];
const PAY_METHODS = [
  ['CASH', 'เงินสด'],
  ['TRANSFER', 'โอนเงิน'],
  ['CREDIT', 'เครดิต'],
] as const;
/** Debit account that goes with each way of booking a receipt */
const DEBIT_FOR = { STOCK: 'Inventory', PROJECT_COST: 'Project Cost', EXPENSE: 'Consumable Expense' } as const;

const CENTRAL = 'CENTRAL';
const toProjectId = (v: string) => (v === CENTRAL ? null : v);
const toOption = (id: string | null) => id ?? CENTRAL;

const input = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#2453d4] focus:outline-none disabled:bg-slate-50 disabled:text-slate-500';
const cell = 'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-[#2453d4] focus:outline-none read-only:bg-slate-50';

function Field({ label, required, children, wide }: { label: string; required?: boolean; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'md:col-span-3' : ''}`}>
      <span className="mb-1.5 block text-sm text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

function Card({ title, hint, action, children }: { title: string; hint: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

interface Line {
  stockItemId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  extraCost: string;
  note: string;
}
const emptyLine = (): Line => ({ stockItemId: '', sku: '', name: '', unit: '', quantity: '1', unitPrice: '', discount: '', extraCost: '', note: '' });
const n = (v: string) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/** Value of a receipt line as the server will book it (same rule as receiptLineValue) */
function lineValue(l: Line, taxType: string) {
  const qty = n(l.quantity);
  const gross = round2(D(qty).times(D(n(l.unitPrice))).minus(D(n(l.discount))));
  let beforeVat = gross;
  let vat = D(0);
  if (taxType === 'VAT7') vat = round2(gross.times(0.07));
  else if (taxType === 'INCLUSIVE') {
    vat = round2(gross.times(0.07).div(1.07));
    beforeVat = round2(gross.minus(vat));
  }
  const extra = round2(D(n(l.extraCost)));
  return { beforeVat, vat, extra, net: round2(beforeVat.plus(vat).plus(extra)), unitCost: qty > 0 ? round2(beforeVat.plus(extra).div(qty)) : D(0) };
}

/** รับเข้า / จ่ายออก / โอนย้าย / ยืม as one document of several lines */
export function StockDocDialog({
  data,
  options,
  initialKind,
  initialItemId,
  onClose,
}: {
  data: StockPageData;
  options: StockDocOptions;
  initialKind: StockDocKind;
  initialItemId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const movable = data.locations.filter((l) => (l.projectId === null ? data.permissions.moveCentral : data.permissions.movableProjectIds.includes(l.projectId)));
  const projectsOnly = data.locations.filter((l) => l.projectId !== null);
  const itemBySku = useMemo(() => new Map(data.items.map((i) => [i.sku.toLowerCase(), i])), [data.items]);
  const itemById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);

  const [kind, setKind] = useState<StockDocKind>(initialKind);
  const [docDate, setDocDate] = useState(options.today);
  const [docTime, setDocTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [source, setSource] = useState(toOption(movable[0]?.projectId ?? null));
  const [target, setTarget] = useState('');
  const [warehouseName, setWarehouseName] = useState('');
  const [supplier, setSupplier] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [deliveryNoteNo, setDeliveryNoteNo] = useState('');
  const [taxInvoiceNo, setTaxInvoiceNo] = useState('');
  const [taxInvoiceDate, setTaxInvoiceDate] = useState('');
  const [receiverName, setReceiverName] = useState(options.meName);
  const [inspectorName, setInspectorName] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [taxType, setTaxType] = useState('VAT7');
  const [accountingMethod, setAccountingMethod] = useState<'STOCK' | 'PROJECT_COST' | 'EXPENSE'>('STOCK');
  const [accountingStatus, setAccountingStatus] = useState('PENDING');
  const [debitAccount, setDebitAccount] = useState('Inventory');
  const [creditAccount, setCreditAccount] = useState('Trade Payables');
  const [payMethod, setPayMethod] = useState('CREDIT');
  const [creditDays, setCreditDays] = useState('30');
  const [issueKind, setIssueKind] = useState('MATERIAL_ISSUE');
  const [useProject, setUseProject] = useState('');
  const [boqCategory, setBoqCategory] = useState('');
  const [boqLine, setBoqLine] = useState('');
  const [zone, setZone] = useState('');
  const [usageNote, setUsageNote] = useState('');
  const [lines, setLines] = useState<Line[]>(() => {
    const it = initialItemId ? itemById.get(initialItemId) : undefined;
    return [it ? { ...emptyLine(), stockItemId: it.id, sku: it.sku, name: it.name, unit: it.unit, unitPrice: it.unitCost ? String(it.unitCost) : '' } : emptyLine()];
  });

  const setLine = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  /** Typing a known SKU picks that item; anything else is a new item (receipts only) */
  const typeSku = (i: number, sku: string) => {
    const it = itemBySku.get(sku.trim().toLowerCase());
    setLine(i, it ? { sku: it.sku, stockItemId: it.id, name: it.name, unit: it.unit, unitPrice: lines[i]!.unitPrice || (it.unitCost ? String(it.unitCost) : '') } : { sku, stockItemId: '' });
  };
  const pickItem = (i: number, id: string) => {
    const it = itemById.get(id);
    setLine(i, it ? { stockItemId: it.id, sku: it.sku, name: it.name, unit: it.unit } : { stockItemId: '', sku: '', name: '', unit: '' });
  };
  const balanceAt = (itemId: string, loc: string) => itemById.get(itemId)?.balances.find((b) => toOption(b.projectId) === loc)?.quantity ?? 0;

  const values = lines.map((l) => lineValue(l, taxType));
  const totals = values.reduce((a, v) => ({ beforeVat: a.beforeVat.plus(v.beforeVat), vat: a.vat.plus(v.vat), net: a.net.plus(v.net) }), { beforeVat: D(0), vat: D(0), net: D(0) });
  const boqCategories = options.boqTree.filter((c) => c.projectId === useProject);
  const boqLines = boqCategories.find((c) => c.id === boqCategory)?.lines ?? [];

  if (movable.length === 0) {
    return (
      <Shell kind={kind} onClose={onClose}>
        <p className="p-6 text-sm text-slate-600">คุณไม่มีสิทธิ์บันทึกรายการสต็อก (ต้องเป็นฝ่ายจัดซื้อ ผู้บริหาร หรือทีมหน้างานของโครงการ)</p>
      </Shell>
    );
  }

  const submit = () => {
    setError(null);
    const vendor = options.vendors.find((v) => v.name === supplier.trim() || `${v.name} (${v.code})` === supplier.trim());
    const payload = {
      type: kind,
      docDate,
      docTime,
      projectId: toProjectId(source),
      targetProjectId: kind === 'RECEIVE' ? undefined : target ? toProjectId(target) : undefined,
      warehouseName,
      vendorId: vendor?.id ?? null,
      supplierName: vendor ? vendor.name : supplier.trim(),
      poNumber,
      deliveryNoteNo,
      taxInvoiceNo,
      taxInvoiceDate: taxInvoiceDate || null,
      receiverName,
      inspectorName,
      taxType: taxType as 'VAT7',
      accountingMethod,
      accountingStatus: accountingStatus as 'PENDING',
      debitAccount,
      creditAccount,
      payMethod: payMethod as 'CREDIT',
      creditDays: payMethod === 'CREDIT' && creditDays !== '' ? Number(creditDays) : null,
      issueKind: kind === 'ISSUE' ? (issueKind as 'MATERIAL_ISSUE') : undefined,
      useProjectId: kind === 'ISSUE' && useProject ? useProject : null,
      boqCategoryId: kind === 'ISSUE' && boqCategory ? boqCategory : null,
      boqLineId: kind === 'ISSUE' && boqLine ? boqLine : null,
      zone,
      usageNote,
      notes,
      lines: lines.map((l) => ({
        stockItemId: l.stockItemId || undefined,
        newItem: !l.stockItemId && kind === 'RECEIVE' ? { sku: l.sku, name: l.name, unit: l.unit } : undefined,
        quantity: Number(l.quantity),
        unitPrice: kind === 'RECEIVE' ? n(l.unitPrice) : undefined,
        discount: kind === 'RECEIVE' ? n(l.discount) : undefined,
        extraCost: kind === 'RECEIVE' ? n(l.extraCost) : undefined,
        note: l.note,
      })),
    };
    startTransition(async () => {
      const r = await createStockDocAction(payload);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const [docId] = (r.value ?? '').split('|');
      // Files go up once the document exists
      let failed = 0;
      for (const f of files) {
        const fd = new FormData();
        fd.set('file', f);
        fd.set('entityType', 'STOCK_DOC');
        fd.set('entityId', docId ?? '');
        const res = await fetch('/api/upload', { method: 'POST', body: fd }).catch(() => null);
        if (!res?.ok) failed++;
      }
      router.refresh();
      if (failed > 0) setError(`บันทึกเอกสารแล้ว แต่แนบไฟล์ไม่สำเร็จ ${failed} ไฟล์`);
      else onClose();
    });
  };

  const kindSelect = (
    <Field label="ประเภทรายการ" required>
      <select value={kind} onChange={(e) => setKind(e.target.value as StockDocKind)} className={input}>
        {(Object.keys(KIND_LABEL) as StockDocKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <Shell kind={kind} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4 bg-slate-50 p-4 sm:p-6"
      >
        <fieldset disabled={isPending} className="space-y-4">
          {kind === 'RECEIVE' ? (
            <>
              <Card title="ข้อมูลเอกสาร" hint="ใช้ส่วนนี้สำหรับอ้างอิงเอกสาร เลือกผู้ขาย คลังปลายทาง และโครงการ">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {kindSelect}
                  <Field label="เลขที่เอกสารรับเข้า">
                    <input value="ออกเลขอัตโนมัติ (GR)" readOnly disabled className={input} />
                  </Field>
                  <Field label="วันที่รับของ" required>
                    <DateInput value={docDate} onChange={(e) => setDocDate(e.target.value)} required className={input} />
                  </Field>
                  <Field label="วันที่ใบกำกับภาษี">
                    <DateInput value={taxInvoiceDate} onChange={(e) => setTaxInvoiceDate(e.target.value)} className={input} />
                  </Field>
                  <Field label="เลขที่ PO">
                    <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-..." className={input} />
                  </Field>
                  <Field label="เลขที่ใบส่งของ">
                    <input value={deliveryNoteNo} onChange={(e) => setDeliveryNoteNo(e.target.value)} placeholder="DN-..." className={input} />
                  </Field>
                  <Field label="เลขที่ใบกำกับภาษี">
                    <input value={taxInvoiceNo} onChange={(e) => setTaxInvoiceNo(e.target.value)} className={input} />
                  </Field>
                  <Field label="Supplier" required>
                    <input value={supplier} onChange={(e) => setSupplier(e.target.value)} list="stock-doc-vendors" placeholder="กรอกชื่อ Supplier" required className={input} />
                    <datalist id="stock-doc-vendors">
                      {options.vendors.map((v) => (
                        <option key={v.id} value={v.name}>
                          {v.code}
                        </option>
                      ))}
                    </datalist>
                  </Field>
                  <Field label="คลังปลายทาง" required>
                    <input value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} placeholder="กรอกคลังปลายทาง" required className={input} />
                  </Field>
                  <Field label="โครงการ / ไซต์งาน">
                    <select value={source} onChange={(e) => setSource(e.target.value)} className={input}>
                      {movable.map((l) => (
                        <option key={toOption(l.projectId)} value={toOption(l.projectId)}>
                          {l.projectId ? l.name : 'ไม่ระบุ (คลังกลาง)'}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="ผู้รับของ">
                    <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} className={input} />
                  </Field>
                  <Field label="ผู้ตรวจรับ">
                    <input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} className={input} />
                  </Field>
                  <Field label="ผู้ทำรายการ">
                    <input value={options.meName} readOnly disabled className={input} />
                  </Field>
                  <Field label="หมายเหตุ" wide>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={input} />
                  </Field>
                  <div className="md:col-span-3">
                    <span className="mb-1.5 block text-sm text-slate-700">แนบไฟล์เอกสาร</span>
                    <div className="rounded-md border border-dashed border-slate-300 p-3">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                        <Paperclip className="h-4 w-4" /> เพิ่มไฟล์
                        <input type="file" multiple className="sr-only" onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])} />
                      </label>
                      {files.length === 0 ? (
                        <p className="mt-2 text-xs text-slate-400">ยังไม่มีไฟล์แนบ</p>
                      ) : (
                        <ul className="mt-2 space-y-1 text-xs text-slate-600">
                          {files.map((f, i) => (
                            <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                              {f.name}
                              <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" title={`เอา ${f.name} ออก`}>
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </Card>

              <Card title="บัญชีและภาษี" hint="กำหนดประเภทภาษี วิธีบันทึกบัญชี วิธีชำระเงิน และผังบัญชี">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Field label="ประเภทภาษี">
                    <select value={taxType} onChange={(e) => setTaxType(e.target.value)} className={input}>
                      {TAX_TYPES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="วิธีบันทึกบัญชี">
                    <select
                      value={accountingMethod}
                      onChange={(e) => {
                        const m = e.target.value as 'STOCK' | 'PROJECT_COST' | 'EXPENSE';
                        setAccountingMethod(m);
                        setDebitAccount(DEBIT_FOR[m]);
                      }}
                      className={input}
                    >
                      {ACCOUNTING_METHODS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="สถานะบัญชี">
                    <select value={accountingStatus} onChange={(e) => setAccountingStatus(e.target.value)} className={input}>
                      {ACCOUNTING_STATUS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="บัญชีเดบิต">
                    <select value={debitAccount} onChange={(e) => setDebitAccount(e.target.value)} className={input}>
                      {ACCOUNTS.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="บัญชีเครดิต">
                    <select value={creditAccount} onChange={(e) => setCreditAccount(e.target.value)} className={input}>
                      {ACCOUNTS.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="วิธีชำระเงิน">
                    <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={input}>
                      {PAY_METHODS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {payMethod === 'CREDIT' && (
                    <Field label="จำนวนวันเครดิต">
                      <input type="number" min={0} value={creditDays} onChange={(e) => setCreditDays(e.target.value)} className={input} />
                    </Field>
                  )}
                </div>
              </Card>
            </>
          ) : (
            <>
              <Card title="รายการเคลื่อนไหว" hint="สร้างรายการจ่ายออก โอนย้าย หรือยืม จากฟอร์มนี้ได้โดยตรง">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {kindSelect}
                  <Field label="เลขที่เอกสาร">
                    <input value={`ออกเลขอัตโนมัติ (${kind === 'ISSUE' ? 'ISS' : kind === 'TRANSFER' ? 'TRF' : 'BRW'})`} readOnly disabled className={input} />
                  </Field>
                  <Field label="ผู้ทำรายการ">
                    <input value={options.meName} readOnly disabled className={input} />
                  </Field>
                  <Field label="วันที่ / เวลา" required>
                    <div className="flex gap-2">
                      <DateInput value={docDate} onChange={(e) => setDocDate(e.target.value)} required className={input} />
                      <input type="time" value={docTime} onChange={(e) => setDocTime(e.target.value)} aria-label="เวลา" className={`${input} w-32`} />
                    </div>
                  </Field>
                  <Field label={kind === 'ISSUE' && issueKind === 'RETURN_IN' ? 'คลังที่รับคืน' : 'ต้นทาง'} required>
                    <select value={source} onChange={(e) => setSource(e.target.value)} className={input}>
                      {movable.map((l) => (
                        <option key={toOption(l.projectId)} value={toOption(l.projectId)}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="ปลายทาง" required={kind !== 'ISSUE'}>
                    <select value={target} onChange={(e) => setTarget(e.target.value)} required={kind !== 'ISSUE'} className={input}>
                      <option value="">เลือกปลายทาง</option>
                      {data.locations
                        .filter((l) => toOption(l.projectId) !== source)
                        .map((l) => (
                          <option key={toOption(l.projectId)} value={toOption(l.projectId)}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="หมายเหตุ" wide>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={input} />
                  </Field>
                </div>
              </Card>

              {kind === 'ISSUE' && (
                <Card title="นำไปใช้กับงาน" hint="ระบุงานที่นำวัสดุไปใช้ เพื่อติดตามการใช้วัสดุเทียบ BOQ">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <Field label="ประเภทการจ่าย" required>
                      <select value={issueKind} onChange={(e) => setIssueKind(e.target.value)} className={input}>
                        {ISSUE_KINDS.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="โครงการ" required={issueKind === 'MATERIAL_ISSUE'}>
                      <select
                        value={useProject}
                        onChange={(e) => {
                          setUseProject(e.target.value);
                          setBoqCategory('');
                          setBoqLine('');
                        }}
                        required={issueKind === 'MATERIAL_ISSUE'}
                        className={input}
                      >
                        <option value="">เลือกโครงการ</option>
                        {projectsOnly.map((l) => (
                          <option key={l.projectId!} value={l.projectId!}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="หมวด BOQ">
                      <select
                        value={boqCategory}
                        onChange={(e) => {
                          setBoqCategory(e.target.value);
                          setBoqLine('');
                        }}
                        className={input}
                      >
                        <option value="">{boqCategories.length === 0 ? 'ไม่มี BOQ' : 'เลือกหมวด BOQ'}</option>
                        {boqCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="รายการ BOQ">
                      <select value={boqLine} onChange={(e) => setBoqLine(e.target.value)} className={input}>
                        <option value="">{boqLines.length === 0 ? 'ไม่มีรายการ BOQ' : 'เลือกรายการ BOQ'}</option>
                        {boqLines.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="พื้นที่ / Zone / ชั้น">
                      <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="เช่น ชั้น 3 โซน A" className={input} />
                    </Field>
                    <Field label="หมายเหตุการใช้งาน">
                      <input value={usageNote} onChange={(e) => setUsageNote(e.target.value)} className={input} />
                    </Field>
                  </div>
                </Card>
              )}
            </>
          )}

          <Card
            title={kind === 'RECEIVE' ? 'รายการรับเข้า' : 'วัสดุ'}
            hint={kind === 'RECEIVE' ? 'เพิ่มวัสดุที่รับเข้า พร้อมจำนวน ราคา ส่วนลด และต้นทุนเพิ่ม' : 'เลือกวัสดุที่มีในสต็อกและจำนวน'}
            action={
              <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine()])} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <Plus className="h-4 w-4" /> เพิ่มรายการ
              </button>
            }
          >
            <datalist id="stock-doc-skus">
              {data.items.map((it) => (
                <option key={it.id} value={it.sku}>
                  {it.name}
                </option>
              ))}
            </datalist>
            <div className="overflow-x-auto">
              {kind === 'RECEIVE' ? (
                <table className="w-full min-w-[1250px] text-xs">
                  <thead className="bg-[#102d72] text-white">
                    <tr>
                      {['รูป', 'SKU', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'ส่วนลด', 'VAT', 'ต้นทุนเพิ่ม', 'ต้นทุนจริงต่อหน่วย', 'มูลค่าก่อน VAT', 'รวมสุทธิ', 'หมายเหตุ', 'จัดการ'].map((h) => (
                        <th key={h} className="px-2 py-2.5 text-left font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l, i) => {
                      const it = l.stockItemId ? itemById.get(l.stockItemId) : undefined;
                      const v = values[i]!;
                      return (
                        <tr key={i} className="align-top">
                          <td className="px-2 py-2">
                            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 text-slate-400">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {it?.imageUrl ? <img src={it.imageUrl} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4" />}
                            </div>
                          </td>
                          <td className="w-32 px-1 py-2">
                            <input value={l.sku} onChange={(e) => typeSku(i, e.target.value)} list="stock-doc-skus" placeholder="กรอกรหัส SKU" required aria-label={`SKU รายการที่ ${i + 1}`} className={cell} />
                            {l.sku && !l.stockItemId && <span className="mt-0.5 block text-[10px] text-amber-700">วัสดุใหม่</span>}
                          </td>
                          <td className="w-48 px-1 py-2">
                            <input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} readOnly={Boolean(l.stockItemId)} placeholder="กรอกรายการวัสดุ" required aria-label={`รายการที่ ${i + 1}`} className={cell} />
                          </td>
                          <td className="w-20 px-1 py-2">
                            <input type="number" step="any" min={0.001} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} required aria-label={`จำนวนรายการที่ ${i + 1}`} className={`${cell} text-right`} />
                          </td>
                          <td className="w-20 px-1 py-2">
                            <input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} readOnly={Boolean(l.stockItemId)} placeholder="กรอกหน่วย" required aria-label={`หน่วยรายการที่ ${i + 1}`} className={cell} />
                          </td>
                          <td className="w-24 px-1 py-2">
                            <input type="number" step="0.01" min={0} value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} aria-label={`ราคาต่อหน่วยรายการที่ ${i + 1}`} className={`${cell} text-right`} />
                          </td>
                          <td className="w-20 px-1 py-2">
                            <input type="number" step="0.01" min={0} value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} placeholder="0" aria-label={`ส่วนลดรายการที่ ${i + 1}`} className={`${cell} text-right`} />
                          </td>
                          <td className="px-2 py-2.5 text-right">{formatMoneyDisplay(v.vat.toFixed(2))}</td>
                          <td className="w-20 px-1 py-2">
                            <input type="number" step="0.01" min={0} value={l.extraCost} onChange={(e) => setLine(i, { extraCost: e.target.value })} placeholder="0" aria-label={`ต้นทุนเพิ่มรายการที่ ${i + 1}`} className={`${cell} text-right`} />
                          </td>
                          <td className="px-2 py-2.5 text-right">{formatMoneyDisplay(v.unitCost.toFixed(2))}</td>
                          <td className="px-2 py-2.5 text-right">{formatMoneyDisplay(v.beforeVat.toFixed(2))}</td>
                          <td className="px-2 py-2.5 text-right font-semibold">{formatMoneyDisplay(v.net.toFixed(2))}</td>
                          <td className="w-32 px-1 py-2">
                            <input value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} aria-label={`หมายเหตุรายการที่ ${i + 1}`} className={cell} />
                          </td>
                          <td className="px-2 py-2">
                            {lines.length > 1 && (
                              <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="rounded border border-red-200 px-2 py-1 text-red-500 hover:bg-red-50">
                                ลบ
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 font-semibold">
                    <tr>
                      <td colSpan={7} className="px-2 py-2.5 text-right">
                        รวม
                      </td>
                      <td className="px-2 py-2.5 text-right">{formatMoneyDisplay(totals.vat.toFixed(2))}</td>
                      <td colSpan={2} />
                      <td className="px-2 py-2.5 text-right">{formatMoneyDisplay(totals.beforeVat.toFixed(2))}</td>
                      <td className="px-2 py-2.5 text-right text-[#2453d4]">{formatMoneyDisplay(totals.net.toFixed(2))}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="bg-[#102d72] text-white">
                    <tr>
                      {['ลำดับ', 'รายการ', 'SKU', 'คงเหลือที่ต้นทาง', 'จำนวน', 'หน่วย', 'หมายเหตุ', ''].map((h) => (
                        <th key={h} className="px-2 py-2.5 text-left font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-2 py-2 text-center text-slate-500">{i + 1}</td>
                        <td className="px-1 py-2">
                          <select value={l.stockItemId} onChange={(e) => pickItem(i, e.target.value)} required aria-label={`วัสดุรายการที่ ${i + 1}`} className={cell}>
                            <option value="">-- เลือกวัสดุ --</option>
                            {data.items.map((it) => (
                              <option key={it.id} value={it.id}>
                                [{it.sku}] {it.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2 font-mono text-slate-500">{l.sku || '-'}</td>
                        <td className="px-2 py-2 text-right text-slate-500">{l.stockItemId ? balanceAt(l.stockItemId, source).toLocaleString('th-TH') : '-'}</td>
                        <td className="w-24 px-1 py-2">
                          <input type="number" step="any" min={0.001} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} required aria-label={`จำนวนรายการที่ ${i + 1}`} className={`${cell} text-right`} />
                        </td>
                        <td className="px-2 py-2">{l.unit || '-'}</td>
                        <td className="px-1 py-2">
                          <input value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} aria-label={`หมายเหตุรายการที่ ${i + 1}`} className={cell} />
                        </td>
                        <td className="px-2 py-2">
                          {lines.length > 1 && (
                            <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="rounded border border-red-200 px-2 py-1 text-red-500 hover:bg-red-50">
                              ลบ
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </fieldset>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <span className="mr-auto text-[11px] tracking-wide text-slate-400">K TEC STOCK | แบบฟอร์ม{KIND_LABEL[kind]}</span>
          {error && (
            <p role="alert" className="w-full text-right text-sm font-medium text-red-600 sm:w-auto">
              {error}
            </p>
          )}
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="submit" disabled={isPending} className="rounded-md bg-[#2453d4] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1c43ab] disabled:opacity-60">
            {isPending ? 'กำลังบันทึก...' : kind === 'RECEIVE' ? 'ยืนยันรับเข้า' : 'บันทึกรายการ'}
          </button>
        </div>
      </form>
    </Shell>
  );
}

function Shell({ kind, onClose, children }: { kind: StockDocKind; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50 p-2 backdrop-blur-xs sm:p-4" role="dialog" aria-modal="true" aria-label={`แบบฟอร์ม${KIND_LABEL[kind]}`}>
      <div className="flex w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b-2 border-[#102d72] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{kind === 'RECEIVE' ? 'บันทึกรับเข้า' : 'รายการเคลื่อนไหว'}</h2>
            <p className="text-xs text-slate-500">
              {kind === 'RECEIVE' ? 'บันทึกรับเข้าสินค้า ข้อมูลผู้ขาย ภาษี และคลังปลายทาง' : 'สร้างรายการจ่ายออก โอนย้าย หรือยืมจากฟอร์มนี้ได้โดยตรง'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-[#2453d4]">สถานะ: {STATUS_LABEL[kind]}</span>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="ปิด">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
