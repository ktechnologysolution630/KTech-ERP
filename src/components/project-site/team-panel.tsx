'use client';

import React, { useState, useTransition } from 'react';
import { Search, UserMinus, UserPlus } from 'lucide-react';
import type { Role } from '@/db/schema';
import { addMemberAction, loadTeamAction, removeMemberAction } from '@/app/(app)/projects/[id]/site-actions';
import { useSiteLoader } from './use-site-loader';

const ROLE_LABELS: Record<Role, string> = {
  FOREMAN: 'โฟร์แมน',
  ENGINEER: 'วิศวกร',
  PM: 'ผู้จัดการโครงการ',
  PURCHASING: 'จัดซื้อ',
  PURCHASING_HEAD: 'หัวหน้าจัดซื้อ',
  FINANCE: 'การเงิน',
  OWNER: 'เจ้าของ',
  ADMIN: 'ผู้ดูแลระบบ',
};

export function TeamPanel({ projectId }: { projectId: string }) {
  const { data, error, reload } = useSiteLoader(() => loadTeamAction(projectId), [projectId]);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setActionError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setActionError(r.error ?? 'ไม่สำเร็จ');
      await reload();
    });
  };

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!data) return <p className="p-8 text-center text-xs text-slate-400">กำลังโหลดทีมงาน...</p>;
  const query = q.trim().toLowerCase();
  const candidates = data.candidates.filter((c) => !query || c.name.toLowerCase().includes(query) || c.email.toLowerCase().includes(query));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
        <div>
          <h3 className="font-bold text-sm text-slate-900">ทีมงานรับผิดชอบโครงการ</h3>
          <p className="text-[11px] text-slate-500">{data.members.length} คนในทีม · สมาชิกเห็นโครงการนี้ในระบบ</p>
        </div>
        {data.members.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">ยังไม่มีสมาชิกในทีม</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.members.map((m) => (
              <div key={m.userId} className="rounded-xl border border-slate-200 p-3 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-blue-50 text-[#2453d4] flex items-center justify-center text-xs font-bold shrink-0">{m.name.slice(0, 2)}</div>
                  <div className="min-w-0 text-xs">
                    <div className="font-semibold text-slate-900 truncate">{m.name}</div>
                    <div className="text-slate-500 truncate">{m.email}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{m.roles.map((r) => ROLE_LABELS[r]).join(', ') || '-'}</div>
                    <div className="text-[11px] text-slate-400">งานที่รับผิดชอบค้างอยู่ {m.openTasks} งาน</div>
                  </div>
                </div>
                {data.canManage && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => confirm(`ถอด ${m.name} ออกจากทีม?`) && act(() => removeMemberAction(projectId, m.userId))}
                    className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                    title="ถอดออกจากทีม"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {actionError && (
          <p role="alert" className="text-xs text-red-600">
            {actionError}
          </p>
        )}
      </div>

      {data.canManage && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div>
            <h3 className="font-bold text-sm text-slate-900">เพิ่มคนเข้าทีม</h3>
            <p className="text-[11px] text-slate-500">ค้นหาผู้ใช้งานในบริษัท แล้วกดเพิ่ม</p>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อหรืออีเมล..." className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-[#2453d4]" />
          </div>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">ไม่มีผู้ใช้ที่ตรงกับเงื่อนไข หรืออยู่ในทีมแล้ว</p>
            ) : (
              candidates.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-[11px] text-slate-400 truncate">{c.email}</div>
                  </div>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => act(() => addMemberAction(projectId, c.id))}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#2453d4] text-white text-[11px] disabled:opacity-50"
                  >
                    <UserPlus className="w-3 h-3" /> เพิ่ม
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
