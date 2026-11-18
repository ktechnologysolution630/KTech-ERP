'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { RotateCcw, Save } from 'lucide-react';
import { FORM_GROUP_LABEL, type FormGroup, type FormHeader, type FormKind, type FormText, type OptionalField } from '@/domain/form-templates';
import { resetFormTextAction, saveFormHeaderAction, saveFormTextAction } from './actions';

const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400';
const labelCls = 'block text-xs font-medium text-slate-700 mb-1';
const GROUPS: FormGroup[] = ['INTERNAL', 'EXTERNAL'];
const GROUP_HINT: Record<FormGroup, string> = {
  INTERNAL: 'ใช้ภายในบริษัท',
  EXTERNAL: 'ส่งให้ผู้ขายหรือลูกค้า',
};

interface FormDefView {
  kind: FormKind;
  group: FormGroup;
  label: string;
  defaults: FormText;
  optionalFields: OptionalField[];
}

type Notice = { ok: boolean; message: string } | null;

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p role="status" className={`text-xs font-medium ${notice.ok ? 'text-emerald-700' : 'text-red-600'}`}>
      {notice.message}
    </p>
  );
}

/** The English name, phone and e-mail every form prints under the Thai letterhead */
function HeaderCard({ header, company }: { header: FormHeader; company: { name: string; address: string; taxId: string } }) {
  const [draft, setDraft] = useState(header);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof FormHeader) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const save = () =>
    startTransition(async () => {
      const r = await saveFormHeaderAction(draft);
      if (r.ok) {
        setDraft(r.header);
        setNotice({ ok: true, message: 'บันทึกหัวกระดาษแล้ว' });
      } else setNotice({ ok: false, message: r.error });
    });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4" aria-labelledby="letterhead-heading">
      <div>
        <h2 id="letterhead-heading" className="text-sm font-bold text-slate-900">
          หัวกระดาษ (ใช้กับทุกฟอร์ม)
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          ชื่อบริษัทภาษาไทย ที่อยู่ และเลขประจำตัวผู้เสียภาษี แก้ได้ที่{' '}
          <Link href="/settings" className="font-medium text-blue-700 underline">
            ตั้งค่าบริษัท
          </Link>{' '}
          · ตอนนี้: {company.name} · {company.taxId}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label htmlFor="companyNameEn" className={labelCls}>
            ชื่อบริษัทภาษาอังกฤษ
          </label>
          <input id="companyNameEn" value={draft.companyNameEn} onChange={set('companyNameEn')} className={input} />
        </div>
        <div>
          <label htmlFor="companyPhone" className={labelCls}>
            เบอร์โทร <span className="font-normal text-slate-400">(ไม่ใส่ก็ได้)</span>
          </label>
          <input id="companyPhone" value={draft.phone} onChange={set('phone')} placeholder="เช่น 02-123-4567" className={input} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="companyEmail" className={labelCls}>
            อีเมล <span className="font-normal text-slate-400">(ไม่ใส่ก็ได้)</span>
          </label>
          <input id="companyEmail" type="email" value={draft.email} onChange={set('email')} placeholder="เช่น purchasing@company.co.th" className={input} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <NoticeLine notice={notice} />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {pending ? 'กำลังบันทึก...' : 'บันทึกหัวกระดาษ'}
        </button>
      </div>
    </section>
  );
}

/** How the edited words sit on the paper: the title, the signature boxes and the note under them */
function Preview({ text }: { text: FormText }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-[11px] font-medium text-slate-500">ตัวอย่างบนกระดาษ</p>
      <div className="rounded border border-slate-200 bg-white px-4 py-4">
        <div className="text-center">
          <p className="text-lg font-bold text-[#0e4677]">{text.titleTh}</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{text.titleEn}</p>
        </div>
        <div className="my-3 h-10 rounded bg-slate-50" aria-hidden />
        <div className={`grid gap-2 ${text.signatureLabels.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {text.signatureLabels.map((label, i) => (
            <div key={i} className="overflow-hidden rounded border border-[#9db0c4] text-center">
              <p className="bg-[#eaf2fa] px-1 py-1 text-[11px] font-bold text-[#0e4677]">{label}</p>
              <div className="mx-auto mb-1 mt-6 w-3/4 border-b border-dotted border-slate-400" />
              <p className="pb-1 text-[10px] text-slate-400">วันที่ ..../..../....</p>
            </div>
          ))}
        </div>
        {text.footerNote && <p className="mt-2 whitespace-pre-line text-[11px] text-slate-600">{text.footerNote}</p>}
      </div>
    </div>
  );
}

/** The words of one form, filled with what it prints now; a field cleared goes back to the default */
function FormEditor({
  def,
  text,
  isEdited,
  onSaved,
}: {
  def: FormDefView;
  text: FormText;
  /** Saved with words of its own */
  isEdited: boolean;
  onSaved: (kind: FormKind, text: FormText, edited: boolean) => void;
}) {
  const [draft, setDraft] = useState(text);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();
  const d = def.defaults;
  const isDefault =
    draft.titleTh === d.titleTh &&
    draft.titleEn === d.titleEn &&
    draft.footerNote === d.footerNote &&
    draft.hiddenFields.length === 0 &&
    draft.signatureLabels.every((l, i) => l === d.signatureLabels[i]);

  // What the paper would print if saved now: a blank field shows its default
  const shown: FormText = {
    titleTh: draft.titleTh.trim() || d.titleTh,
    titleEn: draft.titleEn.trim() || d.titleEn,
    signatureLabels: d.signatureLabels.map((l, i) => draft.signatureLabels[i]?.trim() || l),
    footerNote: draft.footerNote.trim(),
    hiddenFields: draft.hiddenFields,
  };
  const togglePrinted = (key: string) =>
    setDraft({ ...draft, hiddenFields: draft.hiddenFields.includes(key) ? draft.hiddenFields.filter((k) => k !== key) : [...draft.hiddenFields, key] });

  const save = () =>
    startTransition(async () => {
      const r = await saveFormTextAction(def.kind, draft);
      if (r.ok) {
        setDraft(r.text);
        onSaved(def.kind, r.text, true);
        setNotice({ ok: true, message: `บันทึก ${def.label} แล้ว เอกสารที่เปิดหรือพิมพ์ต่อจากนี้ใช้ข้อความใหม่` });
      } else setNotice({ ok: false, message: r.error });
    });

  const reset = () => {
    if (!window.confirm(`คืนค่าเดิมของ${def.label}? ข้อความที่แก้ไว้จะหายไป`)) return;
    startTransition(async () => {
      const r = await resetFormTextAction(def.kind);
      if (r.ok) {
        setDraft(r.text);
        onSaved(def.kind, r.text, false);
        setNotice({ ok: true, message: 'คืนค่าเดิมแล้ว' });
      } else setNotice({ ok: false, message: r.error });
    });
  };

  const hint = (dv: string) => <p className="mt-1 text-[11px] text-slate-400">ค่าเดิม: {dv || '(ว่าง)'} · เว้นว่างเพื่อใช้ค่าเดิม</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-900">{def.label}</h2>
        <p className="text-xs text-slate-500">{FORM_GROUP_LABEL[def.group]} · {GROUP_HINT[def.group]}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="titleTh" className={labelCls}>
            ชื่อเอกสาร (ไทย)
          </label>
          <input id="titleTh" value={draft.titleTh} onChange={(e) => setDraft({ ...draft, titleTh: e.target.value })} placeholder={d.titleTh} maxLength={80} className={input} />
          {hint(d.titleTh)}
        </div>
        <div>
          <label htmlFor="titleEn" className={labelCls}>
            ชื่อเอกสาร (อังกฤษ)
          </label>
          <input id="titleEn" value={draft.titleEn} onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })} placeholder={d.titleEn} maxLength={80} className={input} />
          {hint(d.titleEn)}
        </div>
      </div>

      <fieldset>
        <legend className={labelCls}>ชื่อช่องลงนาม ({d.signatureLabels.length} ช่อง เรียงจากซ้ายไปขวา)</legend>
        <div className={`grid grid-cols-1 gap-3 ${d.signatureLabels.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
          {d.signatureLabels.map((dv, i) => (
            <div key={i}>
              <label htmlFor={`sig-${i}`} className="mb-0.5 block text-[11px] text-slate-500">
                ช่องที่ {i + 1}
              </label>
              <input
                id={`sig-${i}`}
                value={draft.signatureLabels[i] ?? ''}
                onChange={(e) => setDraft({ ...draft, signatureLabels: d.signatureLabels.map((_, j) => (j === i ? e.target.value : draft.signatureLabels[j] ?? '')) })}
                placeholder={dv}
                maxLength={60}
                className={input}
              />
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">ค่าเดิม: {d.signatureLabels.join(' · ')} · ลายเซ็นในระบบยังลงในช่องเดิมตามลำดับ</p>
      </fieldset>

      <div>
        <label htmlFor="footerNote" className={labelCls}>
          หมายเหตุท้ายฟอร์ม <span className="font-normal text-slate-400">(พิมพ์ใต้ช่องลงนาม ไม่ใส่ก็ได้)</span>
        </label>
        <textarea
          id="footerNote"
          value={draft.footerNote}
          onChange={(e) => setDraft({ ...draft, footerNote: e.target.value })}
          rows={3}
          maxLength={1000}
          placeholder="เช่น กรุณาระบุเลขที่ใบสั่งซื้อในใบแจ้งหนี้ทุกครั้ง"
          className={input}
        />
      </div>

      {def.optionalFields.length > 0 && (
        <fieldset>
          <legend className={labelCls}>ช่องที่พิมพ์ในฟอร์ม</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {def.optionalFields.map((f) => (
              <label key={f.key} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={!draft.hiddenFields.includes(f.key)} onChange={() => togglePrinted(f.key)} className="h-4 w-4" />
                {f.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">เอาเครื่องหมายถูกออกเพื่อไม่พิมพ์ช่องนั้นใน PDF ข้อมูลยังกรอกและเก็บไว้ในระบบตามเดิม</p>
        </fieldset>
      )}

      <Preview text={shown} />

      <div className="flex flex-wrap items-center justify-end gap-3">
        <NoticeLine notice={notice} />
        <button
          type="button"
          onClick={reset}
          disabled={pending || (!isEdited && isDefault)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" /> คืนค่าเดิม
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {pending ? 'กำลังบันทึก...' : 'บันทึกแบบฟอร์มนี้'}
        </button>
      </div>
    </div>
  );
}

export function FormsClient({
  defs,
  texts: initialTexts,
  edited: initialEdited,
  header,
  company,
  initialKind,
}: {
  defs: FormDefView[];
  texts: Record<FormKind, FormText>;
  /** Forms the owner has changed from the defaults */
  edited: string[];
  header: FormHeader;
  company: { name: string; address: string; taxId: string };
  initialKind: FormKind;
}) {
  const [texts, setTexts] = useState(initialTexts);
  const [edited, setEdited] = useState(() => new Set(initialEdited));
  const [kind, setKind] = useState<FormKind>(initialKind);
  const def = defs.find((d) => d.kind === kind)!;

  const onSaved = (k: FormKind, text: FormText, isEdited: boolean) => {
    setTexts((t) => ({ ...t, [k]: text }));
    setEdited((s) => {
      const next = new Set(s);
      if (isEdited) next.add(k);
      else next.delete(k);
      return next;
    });
  };

  const choose = (k: FormKind) => {
    setKind(k);
    // Keeps the chosen form on reload and in a shared link
    window.history.replaceState(null, '', `/settings/forms?form=${k}`);
  };

  return (
    <div className="space-y-6">
      <HeaderCard header={header} company={company} />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]" aria-label="แบบฟอร์มแต่ละเอกสาร">
        <nav className="rounded-xl border border-slate-200 bg-white p-3 space-y-4 self-start" aria-label="เลือกแบบฟอร์ม">
          {GROUPS.map((g) => (
            <div key={g}>
              <p className="px-2 text-xs font-bold text-slate-900">{FORM_GROUP_LABEL[g]}</p>
              <p className="px-2 pb-1 text-[11px] text-slate-500">{GROUP_HINT[g]}</p>
              <ul className="space-y-0.5">
                {defs
                  .filter((d) => d.group === g)
                  .map((d) => {
                    const on = d.kind === kind;
                    return (
                      <li key={d.kind}>
                        <button
                          type="button"
                          onClick={() => choose(d.kind)}
                          aria-current={on ? 'true' : undefined}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                            on ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>{d.label}</span>
                          {edited.has(d.kind) && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">แก้ไขแล้ว</span>}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
          <p className="border-t border-slate-100 px-2 pt-2 text-[11px] text-slate-400">
            หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) เป็นแบบฟอร์มของกรมสรรพากร จึงไม่เปิดให้แก้
          </p>
        </nav>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          {/* The key gives each form a fresh editor, filled with what it prints now */}
          <FormEditor key={kind} def={def} text={texts[kind]} isEdited={edited.has(kind)} onSaved={onSaved} />
        </div>
      </section>
    </div>
  );
}
