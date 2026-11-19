'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Trash2, X } from 'lucide-react';
import { findDuplicateGroups, pickKeeper } from '@/domain/item-duplicates';
import { itemUsageAction } from '../actions';
import type { ItemRow } from './items-table';

type Usage = Record<string, { pr: number; po: number }>;

/** Lists groups of look-alike items so the extra copies can be ticked and sent to the usual delete flow */
export function DuplicateCheck({
  items,
  canDelete,
  onClose,
  onDelete,
}: {
  items: ItemRow[];
  canDelete: boolean;
  onClose: () => void;
  onDelete: (ids: string[]) => void;
}) {
  const groups = useMemo(() => findDuplicateGroups(items), [items]);
  const groupIds = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.id)), [groups]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (groupIds.length === 0) return;
    let live = true;
    itemUsageAction(groupIds)
      .then((u) => live && setUsage(u))
      .catch(() => live && setUsageError(true));
    return () => {
      live = false;
    };
  }, [groupIds]);

  const lines = (id: string) => (usage?.[id]?.pr ?? 0) + (usage?.[id]?.po ?? 0);
  const itemCount = new Set(groupIds).size;

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const tickSuggested = () => {
    const usageMap = new Map(groupIds.map((id) => [id, lines(id)]));
    const next = new Set<string>();
    // Only groups that are plainly the same thing; different names or units need a person to decide
    for (const g of groups.filter((x) => x.sameThing)) {
      const keep = pickKeeper(g, usageMap);
      for (const it of g.items) if (it.id !== keep.id && it.active && lines(it.id) === 0) next.add(it.id);
    }
    setTicked(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="ตรวจสอบรายการสินค้าซ้ำ">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white text-sm shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <h3 className="font-bold text-slate-900">ตรวจสอบรายการสินค้าซ้ำ</h3>
            <p className="mt-0.5 text-xs text-slate-500">เทียบรหัสและชื่อสินค้า โดยไม่สนใจช่องว่าง ตัวพิมพ์เล็ก/ใหญ่ เครื่องหมายวรรคตอน และ x กับ ×</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>

        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="font-semibold text-slate-800">ไม่พบรายการสินค้าซ้ำ</p>
            <p className="text-xs text-slate-500">ตรวจทั้งหมด {items.length.toLocaleString('th-TH')} รายการแล้ว</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
              <span>
                พบ <b>{groups.length.toLocaleString('th-TH')}</b> กลุ่มที่อาจซ้ำกัน รวม <b>{itemCount.toLocaleString('th-TH')}</b> รายการ
              </span>
              {canDelete && (
                <button
                  type="button"
                  onClick={tickSuggested}
                  disabled={!usage && !usageError}
                  className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                  title="เฉพาะกลุ่มที่ชื่อและหน่วยตรงกัน: เก็บรายการที่ใช้ในเอกสารมากที่สุดไว้กลุ่มละ 1 รายการ แล้วเลือกตัวซ้ำที่ยังไม่ถูกใช้"
                >
                  เลือกตัวซ้ำที่ยังไม่ถูกใช้ให้อัตโนมัติ
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {usageError && <p className="text-xs text-red-600">โหลดข้อมูลการใช้งานใน PR/PO ไม่สำเร็จ</p>}
              {groups.map((g) => (
                <section key={g.key} className="overflow-hidden rounded-lg border border-slate-200">
                  <header className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-1.5 text-xs">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${g.reason === 'code' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                      {g.reason === 'code' ? 'รหัสซ้ำ' : 'ชื่อซ้ำ'}
                    </span>
                    <span className="text-slate-600">{g.items.length} รายการ</span>
                    {g.mixedUnits && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">หน่วยต่างกัน ตรวจสอบก่อนลบ</span>}
                    {g.reason === 'code' && !g.sameThing && !g.mixedUnits && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">ชื่อต่างกัน อาจเป็นคนละสินค้า ควรแก้รหัสแทนการลบ</span>
                    )}
                  </header>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {g.items.map((it) => {
                        const u = usage?.[it.id];
                        return (
                          <tr key={it.id} className={ticked.has(it.id) ? 'bg-red-50/60' : it.active ? '' : 'text-slate-400'}>
                            {canDelete && (
                              <td className="w-8 px-3 py-2">
                                <input type="checkbox" checked={ticked.has(it.id)} onChange={() => toggle(it.id)} aria-label={`เลือก ${it.code} ${it.name}`} />
                              </td>
                            )}
                            <td className="w-28 px-3 py-2 font-medium">{it.code}</td>
                            <td className="px-3 py-2">
                              {it.name}
                              {!it.active && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">ปิดใช้งาน</span>}
                            </td>
                            <td className="w-16 px-3 py-2">{it.unitName}</td>
                            <td className="w-32 px-3 py-2 text-slate-500">{it.category || '-'}</td>
                            <td className="w-32 px-3 py-2 text-right">
                              {!u ? (
                                <span className="text-slate-300">{usageError ? '-' : '...'}</span>
                              ) : u.pr + u.po > 0 ? (
                                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                                  ใช้ใน PR {u.pr} · PO {u.po}
                                </span>
                              ) : (
                                <span className="text-slate-400">ยังไม่ถูกใช้</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
            ปิด
          </button>
          {canDelete && groups.length > 0 && (
            <button
              type="button"
              disabled={ticked.size === 0}
              onClick={() => onDelete([...ticked])}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> ลบที่เลือก{ticked.size > 0 && ` (${ticked.size.toLocaleString('th-TH')})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
