'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { DocStatusBadge } from '@/components/doc-status-badge';

export interface PurchasingDocRow {
  id: string;
  docNumber: string;
  type: 'PR' | 'PO';
  project: string;
  vendor: string;
  date: Date;
  /** null for PRs, which list quantities only (prices are set on the PO) */
  amount: number | null;
  status: string;
  owner: string;
  link: string;
}

type SortKey = 'docNumber' | 'type' | 'project' | 'vendor' | 'date' | 'amount' | 'status' | 'owner';

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function compare(a: PurchasingDocRow, b: PurchasingDocRow, key: SortKey): number {
  if (key === 'date') return new Date(a.date).getTime() - new Date(b.date).getTime();
  if (key === 'amount') return (a.amount ?? -1) - (b.amount ?? -1);
  return String(a[key]).localeCompare(String(b[key]), 'th');
}

/** PR/PO list with clickable column sorting; newest first by default. */
export function PurchasingDocTable({
  docs,
  showStatus = true,
  emptyText,
}: {
  docs: PurchasingDocRow[];
  showStatus?: boolean;
  emptyText: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const sorted = useMemo(() => [...docs].sort((a, b) => compare(a, b, sort.key) * sort.dir), [docs, sort]);

  const columns: { key: SortKey; label: string; align?: 'right' | 'center' }[] = [
    { key: 'docNumber', label: 'เลขที่เอกสาร' },
    { key: 'type', label: 'ประเภท' },
    { key: 'project', label: 'โครงการ' },
    { key: 'vendor', label: 'ซัพพลายเออร์' },
    { key: 'date', label: 'วันที่' },
    { key: 'amount', label: 'มูลค่า', align: 'right' },
    ...(showStatus ? [{ key: 'status' as const, label: 'สถานะ', align: 'center' as const }] : []),
    { key: 'owner', label: 'ผู้รับผิดชอบ' },
  ];

  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'date' || key === 'amount' ? -1 : 1 },
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-xs">
        <thead className="bg-[#102d72] text-xs text-white [&_th]:border-r [&_th]:border-white/40 [&_th:last-child]:border-r-0">
          <tr>
            {columns.map((c) => {
              const Icon = sort.key !== c.key ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
              const justify = c.align === 'right' ? 'justify-end' : c.align === 'center' ? 'justify-center' : 'justify-start';
              return (
                <th key={c.key} className="px-3.5 py-2.5 font-medium">
                  <button type="button" onClick={() => toggle(c.key)} className={`w-full inline-flex items-center gap-1 ${justify}`}>
                    <span>{c.label}</span>
                    <Icon className={`w-3 h-3 ${sort.key === c.key ? 'text-white' : 'text-white/60'}`} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-12 text-center text-slate-400 text-xs">
                {emptyText}
              </td>
            </tr>
          ) : (
            sorted.map((doc) => (
              <tr key={`${doc.type}-${doc.id}`} className="hover:bg-slate-50 transition">
                <td className="px-3.5 py-2.5 font-mono font-semibold text-[#2453d4]">
                  <Link href={doc.link} className="hover:underline">
                    {doc.docNumber}
                  </Link>
                </td>
                <td className="px-3.5 py-2.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                      doc.type === 'PR' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {doc.type}
                  </span>
                </td>
                <td className="px-3.5 py-2.5 font-medium text-slate-800">{doc.project}</td>
                <td className="px-3.5 py-2.5 text-slate-600">{doc.vendor}</td>
                <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">
                  {new Date(doc.date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-3.5 py-2.5 text-right font-bold text-slate-900">
                  {doc.amount === null ? <span className="font-normal text-slate-400">-</span> : `฿${baht(doc.amount)}`}
                </td>
                {showStatus && (
                  <td className="px-3.5 py-2.5 text-center">
                    <DocStatusBadge status={doc.status} />
                  </td>
                )}
                <td className="px-3.5 py-2.5 text-slate-500">{doc.owner}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
