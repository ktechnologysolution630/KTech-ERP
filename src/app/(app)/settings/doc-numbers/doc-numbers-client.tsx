'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DocNumberStatus } from '@/server/services/doc-numbers';
import { renumberDocumentAction, setNextDocNumberAction, type DocNumberResult } from './actions';
import { SearchSelect } from '@/components/search-select';

const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

function Message({ result }: { result: DocNumberResult | null }) {
  if (!result) return null;
  if (!result.ok) return <p className="text-xs font-medium text-red-600">{result.error}</p>;
  return (
    <p className="text-xs font-medium text-emerald-700">
      {result.message}
      {result.href && (
        <>
          {' · '}
          <Link href={result.href} className="underline">
            เปิดเอกสาร
          </Link>
        </>
      )}
    </p>
  );
}

/** One kind of document: what this month has used, and the next number to set */
function NextNumberRow({ status, projectId }: { status: DocNumberStatus; projectId: string | null }) {
  const [next, setNext] = useState('');
  const [result, setResult] = useState<DocNumberResult | null>(null);
  const [pending, startTransition] = useTransition();
  const needsProject = status.perProject && !projectId;

  const save = () =>
    startTransition(async () => {
      setResult(await setNextDocNumberAction({ key: status.key, next, projectId }));
      setNext('');
    });

  return (
    <tr className="align-top">
      <td className="px-3 py-2.5 font-medium text-slate-800">{status.label}</td>
      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{needsProject ? '-' : status.lastNumber ?? 'ยังไม่ได้เริ่มนับ'}</td>
      <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-900">{needsProject ? 'เลือกโครงการก่อน' : status.nextNumber}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            step={1}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder={status.nextSeq ? String(status.nextSeq) : 'เลขลำดับ'}
            disabled={needsProject || pending}
            aria-label={`ตั้งเลขถัดไปของ${status.label}`}
            className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
          />
          <button
            type="button"
            onClick={save}
            disabled={needsProject || pending || !next}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {pending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
        <div className="mt-1">
          <Message result={result} />
        </div>
      </td>
    </tr>
  );
}

export function DocNumbersClient({
  statuses,
  types,
  projects,
  projectId,
}: {
  statuses: DocNumberStatus[];
  types: { key: string; label: string }[];
  projects: { id: string; code: string; name: string }[];
  projectId: string | null;
}) {
  const router = useRouter();
  const [key, setKey] = useState(types[0]?.key ?? 'PO');
  const [currentNumber, setCurrentNumber] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<DocNumberResult | null>(null);
  const [pending, startTransition] = useTransition();

  const renumber = () =>
    startTransition(async () => {
      const r = await renumberDocumentAction({ key, currentNumber, newNumber, reason });
      setResult(r);
      if (r.ok) {
        setCurrentNumber('');
        setNewNumber('');
        setReason('');
      }
    });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">เลขที่เอกสาร</h1>
        <p className="mt-1 text-xs text-slate-500">
          ตั้งเลขถัดไปของเอกสารแต่ละประเภท และแก้เลขของเอกสารที่ออกไปแล้ว ระบบไม่ออกเลขซ้ำกับเอกสารที่มีอยู่ ถ้าเลขถัดไปมีเอกสารใช้แล้วจะข้ามไปเลขต่อไปเอง
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">ตั้งเลขถัดไป (เดือนนี้)</h2>
            <p className="text-xs text-slate-500">เลขยังเริ่มนับ 1 ใหม่ทุกเดือนเหมือนเดิม ค่าที่ตั้งใช้กับเดือนปัจจุบัน</p>
          </div>
          <label className="text-xs text-slate-600">
            โครงการ (สำหรับเลข PR ซึ่งนับแยกแต่ละโครงการ)
            <SearchSelect
              value={projectId ?? ''}
              onChange={(e) => router.push(e.target.value ? `/settings/doc-numbers?project=${e.target.value}` : '/settings/doc-numbers')}
              className="mt-1 block w-72 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">-- เลือกโครงการ --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.name}
                </option>
              ))}
            </SearchSelect>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">เอกสาร</th>
                <th className="px-3 py-2 text-left">ระบบนับถึง (เดือนนี้)</th>
                <th className="px-3 py-2 text-left">ใบถัดไปจะได้</th>
                <th className="px-3 py-2 text-left">ตั้งเลขถัดไป</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {statuses.map((s) => (
                <NextNumberRow key={`${s.key}-${projectId ?? ''}`} status={s} projectId={projectId} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">แก้เลขเอกสารที่ออกไปแล้ว</h2>
          <p className="text-xs text-slate-500">
            เอกสารที่พิมพ์หรือส่งให้ผู้ขายหรือลูกค้าไปแล้วยังเป็นเลขเดิม การเปลี่ยนเลขจะบันทึกไว้ในประวัติของเอกสารพร้อมเหตุผล
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-xs font-medium text-slate-700">
            ประเภทเอกสาร
            <select value={key} onChange={(e) => setKey(e.target.value)} className={`mt-1 ${input}`}>
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-700">
            เลขที่เดิม
            <input value={currentNumber} onChange={(e) => setCurrentNumber(e.target.value)} placeholder="เช่น PO-6911-0003" className={`mt-1 font-mono ${input}`} />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            เลขที่ใหม่
            <input value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder="เช่น PO-6911-0100" className={`mt-1 font-mono ${input}`} />
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-700">
          เหตุผล *
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="เช่น ให้ตรงกับเลขในระบบเดิม" className={`mt-1 ${input}`} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={renumber}
            disabled={pending || !currentNumber.trim() || !newNumber.trim() || !reason.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
          >
            {pending ? 'กำลังเปลี่ยน...' : 'เปลี่ยนเลข'}
          </button>
          <Message result={result} />
        </div>
      </section>
    </div>
  );
}
