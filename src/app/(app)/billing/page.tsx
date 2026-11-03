import React from 'react';
import { notFound } from 'next/navigation';
import { Database, FolderKanban, HardDrive, Users } from 'lucide-react';
import { getDb } from '@/db/client';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from '@/domain/project';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { getSystemUsage } from '@/server/services/usage';

const size = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024))} KB`;

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-2">{value}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>
    </div>
  );
}

export default async function SystemUsagePage() {
  const actor = await requireUser();
  if (!can(actor, 'settings.manage')) notFound();
  const usage = await getSystemUsage(await getDb(), actor);
  const totalProjects = Object.values(usage.projects).reduce((a, n) => a + (n ?? 0), 0);
  const openProjects = (usage.projects.PLANNING ?? 0) + (usage.projects.IN_PROGRESS ?? 0) + (usage.projects.ON_HOLD ?? 0);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">SYSTEM USAGE</div>
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">การใช้งานระบบ</h1>
        <p className="text-xs text-slate-500 mt-0.5">ข้อมูลที่เก็บอยู่ในระบบนี้ และปริมาณเอกสารที่สร้างในเดือนนี้</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={<Users className="w-4 h-4" />} label="ผู้ใช้งาน" value={String(usage.users.active)} hint={`ปิดการใช้งานแล้ว ${usage.users.inactive} คน`} />
        <Stat icon={<FolderKanban className="w-4 h-4" />} label="โครงการที่เปิดอยู่" value={String(openProjects)} hint={`ทั้งหมด ${totalProjects} โครงการ`} />
        <Stat icon={<HardDrive className="w-4 h-4" />} label="ไฟล์แนบ" value={size(usage.storage.bytes)} hint={`${usage.storage.files.toLocaleString('th-TH')} ไฟล์`} />
        <Stat
          icon={<Database className="w-4 h-4" />}
          label="ฐานข้อมูล / ที่เก็บไฟล์"
          value={usage.database === 'POSTGRES' ? 'PostgreSQL' : 'PGlite (ทดสอบ)'}
          hint={usage.fileStorage === 'BLOB' ? 'ไฟล์เก็บบน Blob storage' : 'ไฟล์เก็บบนดิสก์ของเซิร์ฟเวอร์ (.uploads)'}
        />
      </div>

      {usage.fileStorage === 'LOCAL' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          ไฟล์แนบถูกเก็บบนดิสก์ของเซิร์ฟเวอร์ — หากโฮสต์ (เช่น Render) ไม่มี Persistent Disk ไฟล์จะหายเมื่อ deploy ใหม่
          แนะนำให้ต่อ Disk ที่โฟลเดอร์ .uploads หรือกำหนด BLOB_READ_WRITE_TOKEN
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 font-semibold text-xs text-slate-800">โครงการตามสถานะ</div>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {PROJECT_STATUSES.map((s) => (
                <tr key={s}>
                  <td className="py-2.5 px-5 text-slate-600">{PROJECT_STATUS_LABELS[s]}</td>
                  <td className="py-2.5 px-5 text-right font-mono font-semibold text-slate-800">{usage.projects[s] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 font-semibold text-xs text-slate-800">เอกสารที่สร้างเดือนนี้</div>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {usage.thisMonth.map((r) => (
                <tr key={r.label}>
                  <td className="py-2.5 px-5 text-slate-600">{r.label}</td>
                  <td className="py-2.5 px-5 text-right font-mono font-semibold text-slate-800">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
