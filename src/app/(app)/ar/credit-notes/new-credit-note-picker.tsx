'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

/** A credit note is issued from its invoice, so pick the invoice first */
export function NewCreditNotePicker({ invoices }: { invoices: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1c43ab]">
        <Plus className="h-4 w-4" /> สร้างเอกสาร
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs">
      <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="ใบแจ้งหนี้ที่จะลดหนี้" className="max-w-xs rounded border border-slate-300 px-2 py-1.5">
        <option value="">{invoices.length === 0 ? 'ยังไม่มีใบแจ้งหนี้ที่วางบิลแล้ว' : 'เลือกใบแจ้งหนี้ที่จะลดหนี้'}</option>
        {invoices.map((i) => (
          <option key={i.id} value={i.id}>
            {i.label}
          </option>
        ))}
      </select>
      <button type="button" disabled={!pick} onClick={() => router.push(`/ar/invoices/${pick}`)} className="rounded bg-[#2453d4] px-3 py-1.5 font-semibold text-white disabled:opacity-40">
        ไปออกใบลดหนี้
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded border border-slate-300 px-3 py-1.5 text-slate-600">
        ยกเลิก
      </button>
    </div>
  );
}
