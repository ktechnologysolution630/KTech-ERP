'use client';

import React, { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Search, X } from 'lucide-react';
import {
  APPROVAL_TYPE_LABELS,
  filterApprovals,
  groupApprovalsByProject,
  keepsApprovalNote,
  NO_PROJECT_KEY,
  takesDecisionNote,
  type ApprovalItem,
} from '@/domain/approvals';
import { formatThaiDate } from '@/domain/thai';
import { decideApprovalAction } from './actions';

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const groupKey = (projectId: string | null) => projectId ?? NO_PROJECT_KEY;
const fieldClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-[#2453d4] focus:outline-hidden';

function DecisionDialog({ item, approve, onClose }: { item: ApprovalItem; approve: boolean; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const askNote = approve ? keepsApprovalNote(item.type) : takesDecisionNote(item.type);
  const reasonRequired = !approve && takesDecisionNote(item.type);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await decideApprovalAction({ type: item.type, id: item.id, approve, note });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={approve ? 'อนุมัติเอกสาร' : 'ไม่อนุมัติเอกสาร'}
      onMouseDown={(e) => e.target === e.currentTarget && !isPending && onClose()}
    >
      <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-xs shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-sm font-bold text-slate-900">{approve ? 'อนุมัติเอกสาร' : 'ไม่อนุมัติเอกสาร'}</h3>
          <button type="button" onClick={onClose} disabled={isPending} className="text-slate-400 hover:text-slate-600" title="ปิด">
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="space-y-1 text-slate-600">
          <div>
            <dt className="inline text-slate-500">เอกสาร: </dt>
            <dd className="inline font-semibold text-slate-900">{item.number}</dd> · {APPROVAL_TYPE_LABELS[item.type]}
          </div>
          <div>
            <dt className="inline text-slate-500">รายการ: </dt>
            <dd className="inline">{item.title}</dd>
          </div>
          {item.amount !== null && (
            <div>
              <dt className="inline text-slate-500">จำนวนเงิน: </dt>
              <dd className="inline font-mono font-semibold text-slate-900">{baht(item.amount)}</dd> บาท
            </div>
          )}
        </dl>
        {askNote && (
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">
              {approve ? (item.type === 'PV' ? 'หมายเหตุ (ต้องระบุ หากยอดจ่ายเกินวงเงิน PO)' : 'หมายเหตุ (ถ้ามี)') : 'เหตุผลที่ไม่อนุมัติ'}
              {reasonRequired && <span className="text-red-500"> *</span>}
            </span>
            <textarea rows={3} maxLength={1000} value={note} autoFocus={reasonRequired} onChange={(e) => setNote(e.target.value)} className={`${fieldClass} w-full`} />
          </label>
        )}
        {error && (
          <p role="alert" className="font-medium text-red-600">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <Link href={item.href} className="font-semibold text-[#2453d4] hover:underline">
            เปิดดูเอกสาร
          </Link>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={isPending || (reasonRequired && !note.trim())}
              onClick={submit}
              className={`rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-50 ${approve ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {isPending ? 'กำลังบันทึก...' : approve ? 'ยืนยันอนุมัติ' : 'ยืนยันไม่อนุมัติ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Documents waiting on the user: first one row per project, then that project's documents with their decision buttons. */
export function ApprovalsClient({ items, projectKey }: { items: ApprovalItem[]; projectKey: string | null }) {
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [deciding, setDeciding] = useState<{ item: ApprovalItem; approve: boolean } | null>(null);

  const filtered = useMemo(() => filterApprovals(items, { query, from, to }), [items, query, from, to]);
  const groups = useMemo(() => groupApprovalsByProject(filtered), [filtered]);
  const inProject = projectKey ? filtered.filter((i) => groupKey(i.projectId) === projectKey) : [];
  const projectName = projectKey ? items.find((i) => groupKey(i.projectId) === projectKey)?.projectName : undefined;
  const filtering = Boolean(query.trim() || from || to);

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative">
        <span className="sr-only">ค้นหา</span>
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาเอกสาร..." className={`${fieldClass} w-48 pl-8`} />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-slate-600">
        วันที่ตั้งแต่
        <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-slate-600">
        ถึงวันที่
        <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
      </label>
      <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">รออนุมัติ {filtered.length}</span>
    </div>
  );
  const empty = (
    <p className="py-14 text-center text-xs text-slate-500">{filtering ? 'ไม่พบเอกสารที่ตรงกับตัวกรอง' : 'ไม่มีเอกสารรออนุมัติ'}</p>
  );

  return (
    <div className="space-y-4 font-sans text-slate-800">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">K Tec Approve</h1>
        <p className="mt-0.5 text-xs text-slate-500">เอกสารทุกประเภทที่รอการพิจารณาของคุณ แยกตามโครงการ</p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        {projectKey ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-xs text-slate-500">เอกสารของโครงการ</p>
                <h2 className="text-base font-bold text-slate-900">{projectName ?? 'ไม่มีเอกสารรออนุมัติในโครงการนี้แล้ว'}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {filters}
                <Link href="/approvals" prefetch={false} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-3.5 w-3.5" /> กลับไปเลือกโครงการ
                </Link>
              </div>
            </div>
            {inProject.length === 0 ? (
              empty
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-xs">
                  <thead className="bg-[#102d72] text-white">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">รายการ</th>
                      <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
                      <th className="px-3 py-2.5 text-left font-medium">ประเภท</th>
                      <th className="px-3 py-2.5 text-right font-medium">จำนวนเงิน (บาท)</th>
                      <th className="px-3 py-2.5 text-left font-medium">ผู้ส่ง</th>
                      <th className="px-3 py-2.5 text-left font-medium">สถานะ</th>
                      <th className="px-4 py-2.5 text-right font-medium">ดำเนินการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inProject.map((i) => (
                      <tr key={`${i.type}-${i.id}`}>
                        <td className="max-w-sm px-4 py-3">
                          <Link href={i.href} className="font-semibold text-[#2453d4] hover:underline">
                            {i.number}
                          </Link>
                          <div className="truncate text-slate-600" title={i.title}>
                            {i.title}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatThaiDate(i.date)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">{APPROVAL_TYPE_LABELS[i.type]}</td>
                        <td className="px-3 py-3 text-right font-mono">{i.amount === null ? '-' : baht(i.amount)}</td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                              {i.requesterName.slice(0, 2)}
                            </span>
                            {i.requesterName}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-medium text-amber-700">รอพิจารณา</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button type="button" onClick={() => setDeciding({ item: i, approve: true })} className="rounded-md bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700">
                            อนุมัติ
                          </button>
                          <button type="button" onClick={() => setDeciding({ item: i, approve: false })} className="ml-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-600 hover:bg-red-50">
                            ไม่อนุมัติ
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap justify-end p-4">{filters}</div>
            {groups.length === 0 ? (
              empty
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="bg-[#102d72] text-white">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">โครงการ</th>
                      <th className="px-3 py-2.5 text-center font-medium">เอกสารรออนุมัติ</th>
                      <th className="px-3 py-2.5 text-left font-medium">ประเภทเอกสาร</th>
                      <th className="px-4 py-2.5 text-right font-medium">เปิด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groups.map((g) => (
                      <tr key={groupKey(g.projectId)}>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900">{g.projectName}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-center">
                          <span className="font-bold text-[#102d72]">{g.items.length}</span> รายการ
                        </td>
                        <td className="px-3 py-3 text-slate-600">{g.typeLabels.join(', ')}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <Link href={`/approvals?project=${groupKey(g.projectId)}`} prefetch={false} className="font-semibold text-[#2453d4] hover:underline">
                            ดูเอกสาร
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {deciding && <DecisionDialog item={deciding.item} approve={deciding.approve} onClose={() => setDeciding(null)} />}
    </div>
  );
}
