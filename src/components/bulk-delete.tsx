'use client';

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
import type { DeleteOutcome } from '@/server/services/record-delete';

/**
 * Tick-and-delete for a list the server draws: the page wraps its table in BulkDeleteProvider and puts a SelectBox in
 * each row, a SelectAllBox in the header and the BulkDeleteBar above. Only shown to whoever may delete.
 */

export type DeleteAction = (ids: string[]) => Promise<{ ok: true; result: DeleteOutcome } | { ok: false; error: string }>;

interface Selection {
  selected: ReadonlyMap<string, string>;
  toggle: (id: string, label: string) => void;
  setMany: (items: { id: string; label: string }[], on: boolean) => void;
  clear: () => void;
  action: DeleteAction;
  /** What one record is called, e.g. ใบกำกับภาษี */
  noun: string;
  /** Counting word, e.g. ใบ or รายการ */
  unit: string;
  /** What goes with each record and what is kept, shown before confirming */
  hint: string;
}

const Ctx = createContext<Selection | null>(null);

export function BulkDeleteProvider({
  action,
  noun,
  unit = 'ใบ',
  hint,
  children,
}: {
  action: DeleteAction;
  noun: string;
  unit?: string;
  hint: string;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlyMap<string, string>>(new Map());
  const value: Selection = {
    selected,
    toggle: (id, label) =>
      setSelected((prev) => {
        const next = new Map(prev);
        if (!next.delete(id)) next.set(id, label);
        return next;
      }),
    setMany: (items, on) =>
      setSelected((prev) => {
        const next = new Map(prev);
        for (const i of items) {
          if (on) next.set(i.id, i.label);
          else next.delete(i.id);
        }
        return next;
      }),
    clear: () => setSelected(new Map()),
    action,
    noun,
    unit,
    hint,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useSelection(): Selection {
  const s = useContext(Ctx);
  if (!s) throw new Error('BulkDeleteProvider is missing');
  return s;
}

export function SelectBox({ id, label }: { id: string; label: string }) {
  const s = useSelection();
  return (
    <input
      type="checkbox"
      checked={s.selected.has(id)}
      onChange={() => s.toggle(id, label)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`เลือก ${label}`}
      className="h-3.5 w-3.5 cursor-pointer accent-red-600"
    />
  );
}

export function SelectAllBox({ items }: { items: { id: string; label: string }[] }) {
  const s = useSelection();
  const all = items.length > 0 && items.every((i) => s.selected.has(i.id));
  return (
    <input
      type="checkbox"
      checked={all}
      disabled={items.length === 0}
      onChange={() => s.setMany(items, !all)}
      aria-label="เลือกทั้งหมด"
      className="h-3.5 w-3.5 cursor-pointer accent-red-600"
    />
  );
}

/** The delete button, its confirmation and what came of it */
export function BulkDeleteBar() {
  const s = useSelection();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DeleteOutcome | null>(null);
  const count = s.selected.size;
  return (
    <>
      <button
        type="button"
        disabled={count === 0}
        onClick={() => {
          setResult(null);
          setConfirming(true);
        }}
        title={count === 0 ? `ติ๊กเลือก${s.noun}ที่จะลบก่อน` : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" /> ลบข้อมูล{count > 0 && ` (${count})`}
      </button>
      {confirming && count > 0 && (
        <ConfirmDelete
          title={`ลบ${s.noun} ${count} ${s.unit}`}
          labels={[...s.selected.values()]}
          hint={s.hint}
          confirmLabel={`ลบ ${count} ${s.unit}`}
          run={() => s.action([...s.selected.keys()])}
          onClose={() => setConfirming(false)}
          onDone={(r) => {
            setConfirming(false);
            setResult(r);
            s.clear();
          }}
        />
      )}
      {result && <DeleteResult result={result} unit={s.unit} onClose={() => setResult(null)} />}
    </>
  );
}

/** What was deleted and what stayed with why; floats at the foot so the list stays in view */
export function DeleteResult({ result, unit, onClose }: { result: DeleteOutcome; unit: string; onClose: () => void }) {
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 w-[min(640px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-emerald-700">
            ลบแล้ว {result.deleted.length} {unit}
            {result.deleted.length > 0 && `: ${result.deleted.map((d) => d.number).join(', ')}`}
          </p>
          {result.kept.length > 0 && (
            <div className="text-amber-800">
              <p className="font-semibold">ไม่ได้ลบ {result.kept.length} {unit}</p>
              <ul className="mt-0.5 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4">
                {result.kept.map((k) => (
                  <li key={k.id}>
                    <span className="font-mono">{k.number}</span>: {k.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-600" title="ปิด">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Permanent, so the word ลบ is typed before it runs */
export function ConfirmDelete({
  title,
  labels,
  hint,
  confirmLabel,
  run,
  onClose,
  onDone,
}: {
  title: string;
  labels: string[];
  hint: string;
  confirmLabel: string;
  run: () => ReturnType<DeleteAction>;
  onClose: () => void;
  onDone: (r: DeleteOutcome) => void;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const r = await run();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      onDone(r.result);
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} disabled={pending} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto p-5">
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {labels.map((l, i) => (
              <li key={i} className="px-3 py-1.5 font-mono text-slate-800">
                {l}
              </li>
            ))}
          </ul>
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            <p className="font-bold">ลบถาวร กู้คืนไม่ได้</p>
            <p className="mt-1">{hint}</p>
            <p className="mt-1">ไฟล์แนบและความคิดเห็นจะถูกลบด้วย ส่วนประวัติการลบเก็บไว้ในระบบ และเลขที่เอกสารที่ลบไปจะไม่ถูกนำกลับมาใช้ซ้ำ</p>
          </div>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">พิมพ์คำว่า &quot;ลบ&quot; เพื่อยืนยัน</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-red-500 focus:outline-none" />
          </label>
          {error && (
            <p role="alert" className="font-medium text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" onClick={confirm} disabled={pending || typed.trim() !== 'ลบ'} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {pending ? 'กำลังลบ...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** ลบใบสำคัญจ่าย, but ลบ BOQ: a Latin name gets a space */
const deleteWord = (noun: string) => (/^[A-Za-z]/.test(noun) ? `ลบ ${noun}` : `ลบ${noun}`);

/** The delete button of one document's own page; back to the list once it is gone */
export function DeleteDocButton({
  action,
  id,
  label,
  noun,
  hint,
  backTo,
  unit = 'ใบ',
}: {
  action: DeleteAction;
  id: string;
  label: string;
  noun: string;
  hint: string;
  backTo: string;
  /** Counting word in the result, e.g. รายการ */
  unit?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DeleteOutcome | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setConfirming(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        <Trash2 className="h-4 w-4" /> {deleteWord(noun)}
      </button>
      {confirming && (
        <ConfirmDelete
          title={`${deleteWord(noun)} ${label}`}
          labels={[label]}
          hint={hint}
          confirmLabel={deleteWord(noun)}
          run={() => action([id])}
          onClose={() => setConfirming(false)}
          onDone={(r) => {
            setConfirming(false);
            if (r.deleted.length > 0) router.push(backTo);
            else setResult(r);
          }}
        />
      )}
      {result && <DeleteResult result={result} unit={unit} onClose={() => setResult(null)} />}
    </>
  );
}
