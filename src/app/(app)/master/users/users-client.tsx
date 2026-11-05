'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Pencil, Plus, X } from 'lucide-react';
import type { Role } from '@/db/schema';
import { expandHiddenMenus, MENU_TREE, type MenuKey } from '@/domain/menu';
import { hiddenMenusForRole, ROLE_PRESETS } from '@/domain/role-presets';
import type { UserRowDto } from '@/server/services/master';
import { resetUserPasswordAction, saveUserAction } from '../actions';

const ROLE_LABELS: Record<Role, string> = {
  FOREMAN: 'โฟร์แมน',
  ENGINEER: 'วิศวกร',
  PM: 'ผู้จัดการโครงการ (PM)',
  PURCHASING: 'จัดซื้อ',
  PURCHASING_HEAD: 'หัวหน้าจัดซื้อ',
  FINANCE: 'การเงิน/บัญชี',
  OWNER: 'เจ้าของ',
  ADMIN: 'ผู้ดูแลระบบ',
};
// Record<Role, …> above guarantees every role is listed
const ROLES = Object.keys(ROLE_LABELS) as Role[];
const SITE_ROLES: Role[] = ['FOREMAN', 'ENGINEER', 'PM'];
const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none';

type Dialog = { kind: 'edit'; user: UserRowDto | null } | { kind: 'password'; user: UserRowDto };

export function UsersClient({
  users,
  projects,
  me,
  minPasswordLength,
}: {
  users: UserRowDto[];
  projects: { id: string; label: string }[];
  me: string;
  minPasswordLength: number;
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const projectLabel = new Map(projects.map((p) => [p.id, p.label]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">จัดการผู้ใช้งานและบทบาท</h1>
        <button
          type="button"
          onClick={() => setDialog({ kind: 'edit', user: null })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> สร้างผู้ใช้งาน
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">ชื่อ</th>
              <th className="px-4 py-3 text-left">อีเมล</th>
              <th className="px-4 py-3 text-left">บทบาท</th>
              <th className="px-4 py-3 text-left">โครงการที่สังกัด</th>
              <th className="px-4 py-3 text-left">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'opacity-60'}>
                <td className="px-4 py-3 font-medium">
                  {u.name}
                  {u.id === me && <span className="ml-1.5 text-[10px] text-blue-600">(คุณ)</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-xs">{u.roles.map((r) => ROLE_LABELS[r]).join(', ')}</td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {u.projectIds.length === 0 ? '-' : u.projectIds.map((id) => projectLabel.get(id) ?? id).join(', ')}
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className={`px-2 py-0.5 rounded-full font-semibold ${u.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {u.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                  <button type="button" onClick={() => setDialog({ kind: 'edit', user: u })} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 text-xs hover:bg-slate-50">
                    <Pencil className="w-3 h-3" /> แก้ไข
                  </button>
                  <button type="button" onClick={() => setDialog({ kind: 'password', user: u })} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 text-xs hover:bg-slate-50">
                    <KeyRound className="w-3 h-3" /> ตั้งรหัสผ่าน
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog?.kind === 'edit' && (
        <UserDialog user={dialog.user} projects={projects} minPasswordLength={minPasswordLength} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'password' && <PasswordDialog user={dialog.user} minPasswordLength={minPasswordLength} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-700" title="ปิด">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Sections first, with their sub-menus under them; a section's box turns everything in it on or off together. */
function MenuPicker({ hidden, onChange }: { hidden: MenuKey[]; onChange: (next: MenuKey[]) => void }) {
  const without = (keys: readonly MenuKey[]) => hidden.filter((k) => !keys.includes(k));
  const plain = MENU_TREE.filter((node) => !('children' in node));
  const sections = MENU_TREE.flatMap((node) => ('children' in node ? [node] : []));

  return (
    <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {plain.map((node) => (
          <label key={node.key} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <input type="checkbox" checked={!hidden.includes(node.key)} onChange={(e) => onChange(e.target.checked ? without([node.key]) : [...hidden, node.key])} className="rounded" />
            {node.label}
          </label>
        ))}
      </div>
      {sections.map((section) => {
        const keys: MenuKey[] = section.children.map((c) => c.key);
        const shown = keys.filter((k) => !hidden.includes(k)).length;
        return (
          <div key={section.key} className="border-t border-slate-100 pt-2">
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={shown > 0}
                ref={(box) => {
                  if (box) box.indeterminate = shown > 0 && shown < keys.length;
                }}
                onChange={() => onChange(shown === keys.length ? [...without(keys), ...keys] : without(keys))}
                className="rounded"
              />
              {section.label}
            </label>
            <div className="mt-1.5 grid grid-cols-1 gap-1.5 pl-5 sm:grid-cols-2">
              {section.children.map((child) => (
                <label key={child.key} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                  <input type="checkbox" checked={!hidden.includes(child.key)} onChange={(e) => onChange(e.target.checked ? without([child.key]) : [...hidden, child.key])} className="rounded" />
                  {child.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UserDialog({
  user,
  projects,
  minPasswordLength,
  onClose,
}: {
  user: UserRowDto | null;
  projects: { id: string; label: string }[];
  minPasswordLength: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<Role[]>(user?.roles ?? []);
  const [projectIds, setProjectIds] = useState<string[]>(user?.projectIds ?? []);
  const [active, setActive] = useState(user?.active ?? true);
  const [hiddenMenus, setHiddenMenus] = useState<MenuKey[]>(() => expandHiddenMenus(user?.hiddenMenus ?? []));
  const toggle =<T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const needsProjects = roles.some((r) => SITE_ROLES.includes(r));
  const matchesPreset = (role: Role) => {
    const preset = hiddenMenusForRole(role);
    return roles.length === 1 && roles[0] === role && preset.length === hiddenMenus.length && preset.every((k) => hiddenMenus.includes(k));
  };
  const activePreset = ROLE_PRESETS.find((p) => matchesPreset(p.role));

  return (
    <Shell title={user ? `แก้ไขผู้ใช้งาน ${user.name}` : 'สร้างผู้ใช้งานใหม่'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = await saveUserAction({ id: user?.id, name, email, password: password || undefined, roles, projectIds, active, hiddenMenus });
            if (!r.ok) {
              setError(r.error);
              return;
            }
            router.refresh();
            onClose();
          });
        }}
        className="p-5 space-y-4 text-sm"
      >
        <fieldset disabled={isPending} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-700 mb-1">ชื่อ-นามสกุล *</span>
              <input required value={name} onChange={(e) => setName(e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-700 mb-1">อีเมล (ใช้เข้าสู่ระบบ) *</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            </label>
            {!user && (
              <label className="block sm:col-span-2">
                <span className="block text-xs font-medium text-slate-700 mb-1">รหัสผ่านเริ่มต้น *</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={minPasswordLength}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={`อย่างน้อย ${minPasswordLength} ตัว มีทั้งตัวอักษรและตัวเลข`}
                  className={field}
                />
              </label>
            )}
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <span className="block text-xs font-medium text-slate-700">ตั้งค่าตามตำแหน่ง</span>
            <p className="mt-0.5 text-[11px] text-slate-500">เลือกแล้วระบบจะติ๊กบทบาทและเมนูที่แนะนำให้ ปรับต่อเองได้ และมีผลเมื่อกดบันทึก</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ROLE_PRESETS.map((p) => (
                <button
                  key={p.role}
                  type="button"
                  aria-pressed={activePreset?.role === p.role}
                  onClick={() => {
                    setRoles([p.role]);
                    setHiddenMenus(hiddenMenusForRole(p.role));
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    activePreset?.role === p.role ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {ROLE_LABELS[p.role]}
                </button>
              ))}
            </div>
            {activePreset && <p className="mt-2 text-xs text-slate-600">{activePreset.summary}</p>}
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-700 mb-1">บทบาท (เลือกได้หลายบทบาท) *</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ROLES.map((r) => (
                <label key={r} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                  <input type="checkbox" checked={roles.includes(r)} onChange={() => setRoles((p) => toggle(p, r))} className="rounded" />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-700 mb-1">
              โครงการที่สังกัด {needsProjects ? '(โฟร์แมน/วิศวกร/PM เห็นเฉพาะโครงการที่เลือก)' : ''}
            </span>
            <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {projects.length === 0 && <span className="text-xs text-slate-400">ยังไม่มีโครงการ</span>}
              {projects.map((p) => (
                <label key={p.id} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                  <input type="checkbox" checked={projectIds.includes(p.id)} onChange={() => setProjectIds((prev) => toggle(prev, p.id))} className="rounded" />
                  {p.label}
                </label>
              ))}
            </div>
            {needsProjects && projectIds.length === 0 && projects.length > 0 && !roles.some((r) => !SITE_ROLES.includes(r)) && (
              <p className="mt-1 text-xs text-amber-700">ยังไม่ได้เลือกโครงการ ผู้ใช้นี้จะยังไม่เห็นโครงการใดเลย</p>
            )}
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-700 mb-1">เมนูที่ใช้งานได้ (ติ๊กออกเพื่อซ่อนเมนูและบล็อกหน้าของเมนูนั้นสำหรับผู้ใช้นี้)</span>
            <MenuPicker hidden={hiddenMenus} onChange={setHiddenMenus} />
          </div>
          {user && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded" />
              เปิดใช้งานบัญชีนี้ (ปิดแล้วจะเข้าสู่ระบบไม่ได้)
            </label>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-red-600 font-medium">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            ยกเลิก
          </button>
          <button type="submit" disabled={isPending} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-60">
            {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Shell>
  );
}

function PasswordDialog({ user, minPasswordLength, onClose }: { user: UserRowDto; minPasswordLength: number; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');

  return (
    <Shell title={`ตั้งรหัสผ่านใหม่ให้ ${user.name}`} onClose={onClose}>
      {done ? (
        <div className="p-5 space-y-4 text-sm">
          <p className="text-emerald-700 font-medium">ตั้งรหัสผ่านใหม่แล้ว แจ้งผู้ใช้ให้เข้าสู่ระบบด้วยรหัสใหม่</p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-blue-600 text-white">
              ปิด
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== confirmText) {
              setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
              return;
            }
            setError(null);
            startTransition(async () => {
              const r = await resetUserPasswordAction(user.id, password);
              if (!r.ok) setError(r.error);
              else setDone(true);
            });
          }}
          className="p-5 space-y-4 text-sm"
        >
          <fieldset disabled={isPending} className="space-y-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-700 mb-1">รหัสผ่านใหม่</span>
              <input type="password" required autoComplete="new-password" minLength={minPasswordLength} value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-700 mb-1">ยืนยันรหัสผ่านใหม่</span>
              <input type="password" required autoComplete="new-password" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={field} />
            </label>
            <p className="text-xs text-slate-500">อย่างน้อย {minPasswordLength} ตัว มีทั้งตัวอักษรและตัวเลข</p>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-red-600 font-medium">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
              ยกเลิก
            </button>
            <button type="submit" disabled={isPending} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-60">
              {isPending ? 'กำลังบันทึก...' : 'ตั้งรหัสผ่าน'}
            </button>
          </div>
        </form>
      )}
    </Shell>
  );
}
