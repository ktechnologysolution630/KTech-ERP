'use client';

import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, FileUp, Loader2, X } from 'lucide-react';
import { defaultUnitOf, type TakeoffKind } from '@/domain/boq-takeoff';
import { decodeDxf, DXF_UNIT_LABEL, dxfGroups, guessDxfUnit, isNoteLayer, readDxf, suggestDxfName, type DxfGroup, type DxfReadResult, type DxfUnit } from '@/domain/dxf-takeoff';
import { extractTextItems } from '@/domain/text-takeoff';
import { findInTakeoff, type ExistingItem } from '@/domain/ai-takeoff-merge';

/**
 * ถอดแบบจาก CAD: a DXF file is read in the browser (nothing is uploaded). Lengths, areas and block
 * counts come straight from the CAD geometry, so they are exact and need no scale. The user names
 * the layers and blocks that are work, picks how each is measured, and they become take-off items.
 */

export interface CadPickedItem {
  category: string;
  description: string;
  kind: TakeoffKind;
  unit: string;
  /** Quantity read from the CAD file, before the factor */
  qty: number;
  factor: number;
  note: string;
}

/** How a CAD group becomes a BOQ quantity */
type Use = 'as-is' | 'volume' | 'perimeter' | 'wall-area';
const USES: Record<DxfGroup['type'], { use: Use; label: string; factorLabel?: string; defaultFactor?: number }[]> = {
  block: [{ use: 'as-is', label: 'จำนวน' }],
  'layer-area': [
    { use: 'as-is', label: 'พื้นที่ (ตร.ม.)' },
    { use: 'volume', label: 'ปริมาตร (ลบ.ม.)', factorLabel: 'หนา/ลึก ม.', defaultFactor: 0.1 },
    { use: 'perimeter', label: 'เส้นรอบรูป (ม.)' },
  ],
  'layer-length': [
    { use: 'as-is', label: 'ความยาว (ม.)' },
    { use: 'wall-area', label: 'พื้นที่ผนัง (ตร.ม.)', factorLabel: 'สูง ม.', defaultFactor: 3 },
  ],
};

interface Row {
  key: string;
  group: DxfGroup | null;
  picked: boolean;
  use: Use;
  factor: number;
  category: string;
  description: string;
  unit: string;
  /** Written-in-notes rows: the quantity and kind read from the text */
  textQty?: number;
  textKind?: TakeoffKind;
  source?: string;
}

const fmt = (n: number, d = 2) => n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
const TYPE_LABEL: Record<DxfGroup['type'], string> = { block: 'บล็อก', 'layer-area': 'พื้นที่ปิด', 'layer-length': 'เส้น' };

function unitFor(g: DxfGroup, use: Use): string {
  if (g.type === 'block') return /ประตู|หน้าต่าง/.test(suggestDxfName(g) ?? '') ? 'ชุด' : 'จุด';
  if (use === 'volume') return 'ลบ.ม.';
  if (use === 'perimeter') return 'ม.';
  if (use === 'wall-area') return 'ตร.ม.';
  return defaultUnitOf(g.kind);
}

function rowsFor(read: DxfReadResult, unit: DxfUnit): Row[] {
  const groups = dxfGroups(read, unit).map((g): Row => {
    const name = suggestDxfName(g);
    return { key: g.key, group: g, picked: Boolean(name) && !isNoteLayer(g.layer), use: 'as-is', factor: 1, category: '', description: name ?? '', unit: unitFor(g, 'as-is') };
  });
  const written = extractTextItems(read.texts.map((text) => ({ page: 1, text }))).map(
    (t, i): Row => ({ key: `text-${i}`, group: null, picked: true, use: 'as-is', factor: 1, category: '', description: t.description, unit: t.unit, textQty: t.qty, textKind: t.kind, source: t.source }),
  );
  return [...written, ...groups];
}

export function CadImportDialog({ categories, existing = [], onAdd, onClose }: { categories: string[]; existing?: ExistingItem[]; onAdd: (items: CadPickedItem[]) => void; onClose: () => void }) {
  // Written totals the take-off already holds start unticked, so they are not counted twice
  const [inTakeoff, setInTakeoff] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState('');
  const [read, setRead] = useState<DxfReadResult | null>(null);
  const [unit, setUnit] = useState<DxfUnit>('mm');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const open = async (file: File) => {
    setError(null);
    setRead(null);
    setRows([]);
    setFileName(file.name);
    if (/\.dwg$/i.test(file.name)) {
      setError('ไฟล์ DWG อ่านโดยตรงไม่ได้ กรุณาเปิดใน AutoCAD แล้ว Save As เป็น DXF (หรือใช้โปรแกรมฟรี ODA File Converter แปลง DWG เป็น DXF) แล้วเปิดไฟล์ DXF ที่นี่');
      return;
    }
    setLoading(true);
    // Let the spinner paint before a large file ties up the page
    await new Promise((r) => setTimeout(r, 30));
    try {
      const r = readDxf(decodeDxf(await file.arrayBuffer()));
      const u = guessDxfUnit(r);
      setRead(r);
      setUnit(u);
      const fresh = rowsFor(r, u);
      const written = fresh.filter((x) => !x.group);
      const hits = findInTakeoff(
        written.map((x) => ({ description: x.description, kind: x.textKind ?? 'count', unit: x.unit, qty: x.textQty ?? 0 })),
        existing,
      );
      const there = new Set(written.filter((_, i) => hits[i]).map((x) => x.key));
      setInTakeoff(there);
      setRows(fresh.map((x) => (there.has(x.key) ? { ...x, picked: false } : x)));
      if (r.raw.length === 0 && r.texts.length === 0) setError('ไม่พบเส้น พื้นที่ หรือบล็อกใน Model space ของไฟล์นี้');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error && err.message === 'BINARY_DXF' ? 'ไฟล์นี้เป็น DXF แบบ Binary กรุณา Save As เป็น DXF แบบ ASCII' : 'อ่านไฟล์ไม่สำเร็จ ไฟล์อาจไม่ใช่ DXF');
    } finally {
      setLoading(false);
    }
  };

  const changeUnit = (u: DxfUnit) => {
    if (!read) return;
    setUnit(u);
    // Keep what the user already named and ticked; only the quantities change
    const fresh = new Map(dxfGroups(read, u).map((g) => [g.key, g]));
    setRows((rs) => rs.map((r) => (r.group ? { ...r, group: fresh.get(r.key) ?? r.group } : r)));
  };

  const update = (key: string, patch: Partial<Row>) => setRows((x) => x.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const qtyOf = (r: Row) => {
    if (!r.group) return r.textQty ?? 0;
    const base = r.use === 'perimeter' ? (r.group.perimeter ?? 0) : r.group.qty;
    return base * (r.use === 'volume' || r.use === 'wall-area' ? r.factor : 1);
  };
  const visible = useMemo(() => rows.filter((r) => showNotes || !r.group || !isNoteLayer(r.group.layer) || r.picked), [rows, showNotes]);
  const hiddenCount = rows.length - visible.length;
  const picked = rows.filter((r) => r.picked && r.description.trim() && qtyOf(r) > 0);

  const add = () =>
    onAdd(
      picked.map((r): CadPickedItem => {
        if (!r.group) return { category: r.category.trim(), description: r.description.trim(), kind: r.textKind ?? 'count', unit: r.unit.trim(), qty: r.textQty ?? 0, factor: 1, note: `ข้อความในไฟล์ CAD ${fileName}: ${r.source ?? ''}` };
        const g = r.group;
        const kind: TakeoffKind = r.use === 'volume' ? 'volume' : r.use === 'perimeter' ? 'length' : g.kind;
        const qty = r.use === 'perimeter' ? (g.perimeter ?? 0) : g.qty;
        const how = USES[g.type].find((u) => u.use === r.use)!;
        return {
          category: r.category.trim(),
          description: r.description.trim(),
          kind,
          unit: r.unit.trim() || defaultUnitOf(kind),
          qty: Math.round(qty * 1000) / 1000,
          factor: r.use === 'volume' || r.use === 'wall-area' ? r.factor : 1,
          note: `CAD ${fileName}: ${TYPE_LABEL[g.type]} ${g.name} (${g.objects} ชิ้น) · ${how.label}${how.factorLabel ? ` × ${how.factorLabel.replace(' ม.', '')} ${r.factor}` : ''}`,
        };
      }),
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="ถอดแบบจากไฟล์ CAD">
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <FileUp className="h-4 w-4 text-brand" /> ถอดแบบจากไฟล์ CAD (DXF)
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <p className="text-slate-600">
            เปิดไฟล์ <b>DXF</b> (จาก AutoCAD: Save As → DXF) ระบบอ่านเส้น พื้นที่ปิด แฮตช์ และบล็อกจากไฟล์โดยตรง ได้ความยาว พื้นที่ จำนวน ตามขนาดจริงในแบบ ไม่ต้องตั้งสเกล แล้วรวมตามเลเยอร์และชื่อบล็อก
            ไฟล์ไม่ถูกอัปโหลด อ่านในเครื่องนี้เท่านั้น
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept=".dxf,.dwg" className="hidden" onChange={(e) => e.target.files?.[0] && void open(e.target.files[0])} />
            <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-1 rounded-lg bg-brand px-3 py-2 font-semibold text-white hover:bg-brand-hover">
              <FileUp className="h-3.5 w-3.5" /> {fileName ? 'เปิดไฟล์อื่น' : 'เลือกไฟล์ DXF'}
            </button>
            {fileName && <span className="font-semibold text-slate-700">{fileName}</span>}
            {read && (
              <label className="ml-auto flex items-center gap-1.5">
                หน่วยที่ใช้เขียนแบบ
                <select value={unit} onChange={(e) => changeUnit(e.target.value as DxfUnit)} className="rounded-lg border border-slate-300 px-2 py-1.5">
                  {(Object.keys(DXF_UNIT_LABEL) as DxfUnit[]).map((u) => (
                    <option key={u} value={u}>
                      {DXF_UNIT_LABEL[u]}
                    </option>
                  ))}
                </select>
                <span className="text-slate-500">{read.declaredUnit ? '(ตามที่ไฟล์ระบุ)' : '(ไฟล์ไม่ได้ระบุ ระบบเดาให้ ตรวจด้วย)'}</span>
              </label>
            )}
          </div>
          {loading && (
            <p className="flex items-center gap-1.5 font-semibold text-brand">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังอ่านไฟล์…
            </p>
          )}
          {error && (
            <p className="flex items-start gap-1 rounded-lg bg-red-50 px-3 py-2 font-semibold text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}
          {rows.length > 0 && (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-blue-800">
              พบ {rows.filter((r) => r.group?.type === 'block').length} บล็อก · {rows.filter((r) => r.group && r.group.type !== 'block').length} เลเยอร์ · ตัวเลขที่เขียนในหมายเหตุ {rows.filter((r) => !r.group).length} รายการ ติ๊กไว้ให้แล้วเฉพาะที่ระบบรู้จักชื่อ ใส่ชื่อรายการแล้วติ๊กเพิ่มได้
              {hiddenCount > 0 && (
                <button type="button" onClick={() => setShowNotes(true)} className="ml-2 font-semibold underline">
                  แสดงเลเยอร์ข้อความ/เส้นบอกระยะอีก {hiddenCount}
                </button>
              )}
            </p>
          )}
          {visible.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[64rem]">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <th className="px-2 py-2">จากไฟล์ CAD</th>
                    <th className="px-2 py-2">ใช้เป็น</th>
                    <th className="px-2 py-2">ชื่อรายการ BOQ</th>
                    <th className="px-2 py-2">หมวดงาน</th>
                    <th className="px-2 py-2 text-right">ปริมาณ</th>
                    <th className="px-2 py-2">หน่วย</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((r) => {
                    const how = r.group ? USES[r.group.type].find((u) => u.use === r.use) : undefined;
                    return (
                      <tr key={r.key} className={r.picked ? '' : 'opacity-60'}>
                        <td className="px-2 py-1.5 align-top">
                          <input type="checkbox" checked={r.picked} onChange={(e) => update(r.key, { picked: e.target.checked })} aria-label="เลือก" />
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          {r.group ? (
                            <>
                              <span className="font-semibold text-slate-900">{r.group.name}</span>
                              <span className="block text-slate-500">
                                {TYPE_LABEL[r.group.type]} · {r.group.objects} ชิ้น{r.group.type === 'block' ? ` · เลเยอร์ ${r.group.layer}` : ''}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-600" title={r.source}>
                              {inTakeoff.has(r.key) && <span className="mr-1 inline-block rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700">มีในงานถอดแบบแล้ว</span>}
                              เขียนในแบบ: {r.source}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          {r.group && USES[r.group.type].length > 1 ? (
                            <div className="flex items-center gap-1">
                              <select
                                value={r.use}
                                onChange={(e) => {
                                  const use = e.target.value as Use;
                                  const opt = USES[r.group!.type].find((u) => u.use === use)!;
                                  update(r.key, { use, factor: opt.defaultFactor ?? 1, unit: unitFor(r.group!, use) });
                                }}
                                className="rounded border border-slate-200 px-1 py-1"
                                aria-label="ใช้เป็น"
                              >
                                {USES[r.group.type].map((u) => (
                                  <option key={u.use} value={u.use}>
                                    {u.label}
                                  </option>
                                ))}
                              </select>
                              {how?.factorLabel && (
                                <label className="flex items-center gap-1 whitespace-nowrap text-slate-500">
                                  × {how.factorLabel}
                                  <input type="number" step="any" min={0} value={r.factor} onChange={(e) => update(r.key, { factor: Math.max(0, Number(e.target.value) || 0) })} className="w-16 rounded border border-slate-200 px-1 py-1 text-right" />
                                </label>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500">{r.group ? USES[r.group.type][0]!.label : 'ตามที่เขียน'}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          <input value={r.description} onChange={(e) => update(r.key, { description: e.target.value, picked: e.target.value.trim() ? true : r.picked })} placeholder="ใส่ชื่อเพื่อเพิ่มเป็นรายการ" className="w-full min-w-[14rem] rounded border border-slate-200 px-1.5 py-1" aria-label="ชื่อรายการ" />
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          <input list="cad-categories" value={r.category} onChange={(e) => update(r.key, { category: e.target.value })} className="w-32 rounded border border-slate-200 px-1.5 py-1" aria-label="หมวดงาน" />
                        </td>
                        <td className="px-2 py-1.5 text-right align-top font-mono font-semibold">{fmt(qtyOf(r), r.group?.type === 'block' ? 0 : 2)}</td>
                        <td className="px-2 py-1.5 align-top">
                          <input value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} className="w-16 rounded border border-slate-200 px-1.5 py-1" aria-label="หน่วย" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="cad-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
            ปิด
          </button>
          <button type="button" onClick={add} disabled={picked.length === 0} className="rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-hover disabled:opacity-50">
            เพิ่ม {picked.length} รายการเข้างานถอดแบบ
          </button>
        </div>
      </div>
    </div>
  );
}
