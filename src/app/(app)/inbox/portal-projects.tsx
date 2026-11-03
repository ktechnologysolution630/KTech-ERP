import Link from 'next/link';
import { ArrowRight, Building2, FolderKanban, MapPin, UserRound } from 'lucide-react';
import { formatMoneyDisplay } from '@/domain/money';
import { PROJECT_COVER_PRESETS, PROJECT_STATUS_LABELS, type ProjectStatus } from '@/domain/project';
import type { PortalProject } from '@/server/services/portal';

const STATUS_BADGE: Record<ProjectStatus, string> = {
  PLANNING: 'bg-sky-500',
  IN_PROGRESS: 'bg-emerald-500',
  ON_HOLD: 'bg-amber-500',
  COMPLETED: 'bg-slate-500',
  CANCELLED: 'bg-rose-500',
};

// First letter of up to two words; skips separators like "/" and Thai leading vowels (เ แ โ ใ ไ)
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => [...w].find((c) => /\p{L}/u.test(c) && !'เแโใไ'.includes(c)) ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] text-slate-400">
        {icon}
        {label}
      </div>
      <div className="text-xs font-medium text-slate-800 truncate mt-0.5" title={value}>
        {value}
      </div>
    </div>
  );
}

export function PortalProjects({ projects, scope }: { projects: PortalProject[]; scope: 'MINE' | 'ALL_OPEN' }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <FolderKanban className="w-4 h-4 text-[#2453d4]" />
            {scope === 'MINE' ? 'โครงการของฉัน' : 'โครงการที่กำลังดำเนินการ'}
          </h2>
          <p className="text-[11px] text-slate-400">
            {scope === 'MINE' ? 'โครงการที่คุณเป็นสมาชิกหรือเป็นผู้จัดการ' : 'คุณยังไม่ได้อยู่ในทีมโครงการใด จึงแสดงทุกโครงการที่ยังเปิดอยู่'}
          </p>
        </div>
        <span className="text-xs text-slate-500">{projects.length} โครงการ</span>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
          ยังไม่มีโครงการที่คุณได้รับมอบหมาย
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => (
            <article key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden hover:shadow-md transition flex flex-col">
              <Link href={`/projects/${p.id}`} className="relative block h-32 group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.coverImageUrl || PROJECT_COVER_PRESETS[0]} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/20 to-transparent" />
                <span className={`absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-white ${STATUS_BADGE[p.status]}`}>
                  {PROJECT_STATUS_LABELS[p.status]}
                </span>
                <span className="absolute right-3 top-3 rounded-md bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] font-bold text-white">{p.code}</span>
                <span className="absolute left-3 right-3 bottom-2 text-white font-bold text-sm truncate group-hover:underline">{p.name}</span>
              </Link>

              <div className="grid grid-cols-3 gap-3 px-4 py-3 border-b border-slate-100">
                <Info icon={<Building2 className="w-3 h-3" />} label="ลูกค้า" value={p.clientName || '-'} />
                <Info icon={<UserRound className="w-3 h-3" />} label="PM" value={p.pmName ?? '-'} />
                <Info icon={<MapPin className="w-3 h-3" />} label="สถานที่" value={p.location || '-'} />
              </div>

              <div className="grid grid-cols-3 gap-3 px-4 py-3 border-b border-slate-100 items-end">
                <div>
                  <div className="text-[10px] text-slate-400">งบประมาณ</div>
                  <div className="text-sm font-bold text-slate-900 font-mono">{p.budget === null ? '—' : formatMoneyDisplay(p.budget, 0)}</div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>ความคืบหน้า</span>
                    <span className="font-semibold text-slate-700">{p.progress}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#2453d4] to-emerald-500" style={{ width: `${Math.min(100, p.progress)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">งานทั้งหมด</div>
                  <div className="text-sm font-bold text-slate-900">
                    {p.tasksDone} <span className="text-[11px] font-normal text-slate-400">/ {p.tasksTotal} งาน</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between px-4 py-3 mt-auto">
                <div className="flex items-center">
                  {p.team.length === 0 ? (
                    <span className="text-[11px] text-slate-400">ยังไม่มีทีมงาน</span>
                  ) : (
                    <>
                      {p.team.slice(0, 5).map((m, i) => (
                        <span
                          key={m.id}
                          title={m.name}
                          className={`w-7 h-7 rounded-full bg-blue-100 text-[#2453d4] text-[10px] font-bold flex items-center justify-center ring-2 ring-white ${i > 0 ? '-ml-2' : ''}`}
                        >
                          {initials(m.name)}
                        </span>
                      ))}
                      {p.team.length > 5 && <span className="ml-1.5 text-[11px] text-slate-500">+{p.team.length - 5}</span>}
                    </>
                  )}
                </div>
                <Link href={`/projects/${p.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#2453d4] hover:underline">
                  รายละเอียด <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
