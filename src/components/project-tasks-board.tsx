'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  isTaskOverdue,
  type TaskPriority,
  type TaskStatus,
} from '@/domain/schedule';
import type { TaskDto } from '@/server/services/tasks';
import {
  createTaskAction,
  deleteTaskAction,
  updateTaskAction,
  type TaskActionResult,
} from '@/app/(app)/projects/[id]/task-actions';

interface ProjectTasksBoardProps {
  projectId: string;
  tasks: TaskDto[];
  canManage: boolean;
  canUpdateProgress: boolean;
  users: { id: string; name: string }[];
  today: string;
}

interface TaskForm {
  parentId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  value: number;
  assigneeId: string | null;
}

const EMPTY_FORM: TaskForm = {
  parentId: null,
  title: '',
  description: '',
  status: 'TODO',
  priority: 'MEDIUM',
  startDate: null,
  dueDate: null,
  progress: 0,
  value: 0,
  assigneeId: null,
};

const PRIORITY_BADGE: Record<TaskPriority, string> = {
  LOW: 'bg-slate-100 text-slate-600',
  MEDIUM: 'bg-amber-50 text-amber-700',
  HIGH: 'bg-red-50 text-red-700',
};

const inputClass =
  'w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#2453d4]';

export function ProjectTasksBoard({
  projectId,
  tasks,
  canManage,
  canUpdateProgress,
  users,
  today,
}: ProjectTasksBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ taskId: string | null; form: TaskForm } | null>(null);

  const topLevel = tasks.filter((t) => t.parentId === null);

  const submit = (action: () => Promise<TaskActionResult>, onOk?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onOk?.();
      router.refresh();
    });
  };

  const openCreate = () => setDialog({ taskId: null, form: { ...EMPTY_FORM } });
  const openEdit = (t: TaskDto) =>
    setDialog({
      taskId: t.id,
      form: {
        parentId: t.parentId,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        startDate: t.startDate,
        dueDate: t.dueDate,
        progress: t.progress,
        value: t.value,
        assigneeId: t.assigneeId,
      },
    });

  const setField = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) =>
    setDialog((d) => (d ? { ...d, form: { ...d.form, [key]: value } } : d));

  const saveDialog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialog) return;
    const { taskId, form } = dialog;
    if (taskId) {
      // Parent is fixed after creation; everything else is editable
      const { parentId: _parent, ...rest } = form;
      submit(() => updateTaskAction(projectId, taskId, rest), () => setDialog(null));
    } else {
      submit(() => createTaskAction(projectId, form), () => setDialog(null));
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs animate-glass-card">
      <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-slate-900">Task Board</h3>
          <p className="text-xs text-slate-500">{tasks.length} งาน · เปลี่ยนสถานะและความคืบหน้าได้จากการ์ด</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2453d4] text-white text-xs font-medium hover:bg-blue-700 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            เพิ่มงาน
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2">
          {error}
        </p>
      )}

      <div className="p-4 overflow-x-auto">
        <div className="grid grid-flow-col auto-cols-[minmax(220px,1fr)] gap-3 min-w-max">
          {TASK_STATUSES.map((status) => {
            const column = tasks.filter((t) => t.status === status);
            return (
              <section key={status} className="bg-slate-50 rounded-xl border border-slate-200 p-2.5 space-y-2">
                <header className="flex items-center justify-between px-1 text-xs font-semibold text-slate-700">
                  <span>{TASK_STATUS_LABELS[status]}</span>
                  <span className="text-slate-400">{column.length}</span>
                </header>
                {column.length === 0 && (
                  <p className="py-6 text-center text-[11px] text-slate-400">ยังไม่มีงาน</p>
                )}
                {column.map((t) => {
                  const overdue = isTaskOverdue(t, today);
                  return (
                    <article key={t.id} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-mono text-[10px] text-slate-400">{t.wbs}</span>
                          <h4 className="font-semibold text-slate-800 leading-snug break-words">
                            {t.title}
                            {t.hasChildren && <span className="ml-1 text-[10px] text-slate-400">(งานหลัก)</span>}
                          </h4>
                        </div>
                        {canManage && (
                          <div className="flex shrink-0 gap-0.5">
                            <button
                              type="button"
                              onClick={() => openEdit(t)}
                              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                              title="แก้ไขงาน"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                const msg = t.hasChildren
                                  ? `ลบ "${t.title}" และงานย่อยทั้งหมด?`
                                  : `ลบ "${t.title}"?`;
                                if (confirm(msg)) submit(() => deleteTaskAction(projectId, t.id));
                              }}
                              className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                              title="ลบงาน"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded font-semibold ${PRIORITY_BADGE[t.priority]}`}>
                          {TASK_PRIORITY_LABELS[t.priority]}
                        </span>
                        {t.dueDate && (
                          <span className={overdue ? 'text-red-600 font-semibold' : 'text-slate-500'}>
                            {overdue ? 'เกินกำหนด ' : 'กำหนด '}
                            {t.dueDate}
                          </span>
                        )}
                        {t.value > 0 && (
                          <span className="font-mono text-slate-600">฿{t.value.toLocaleString('th-TH')}</span>
                        )}
                      </div>

                      {t.assigneeName && <div className="text-[10px] text-slate-500">ผู้รับผิดชอบ: {t.assigneeName}</div>}

                      <div className="space-y-1">
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-[#2453d4]" style={{ width: `${t.progress}%` }} />
                        </div>
                        {canUpdateProgress ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label="สถานะงาน"
                              value={t.status}
                              disabled={isPending}
                              onChange={(e) =>
                                submit(() =>
                                  updateTaskAction(projectId, t.id, { status: e.target.value as TaskStatus }),
                                )
                              }
                              className="flex-1 min-w-0 px-1.5 py-1 border border-slate-200 rounded text-[11px]"
                            >
                              {TASK_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {TASK_STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                            <input
                              aria-label="ความคืบหน้า (%)"
                              type="number"
                              min={0}
                              max={100}
                              step={5}
                              defaultValue={t.progress}
                              key={`${t.id}-${t.progress}`}
                              disabled={isPending}
                              onBlur={(e) => {
                                const next = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                                if (next !== t.progress) {
                                  submit(() => updateTaskAction(projectId, t.id, { progress: next }));
                                }
                              }}
                              className="w-14 px-1.5 py-1 border border-slate-200 rounded text-[11px] font-mono text-right"
                            />
                            <span className="text-[10px] text-slate-400">%</span>
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500 font-mono">{t.progress}%</div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">{dialog.taskId ? 'แก้ไขงาน' : 'เพิ่มงานใหม่'}</h3>
              <button type="button" onClick={() => setDialog(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={saveDialog} className="space-y-3 text-xs">
              <fieldset disabled={isPending} className="space-y-3">
                <div>
                  <label htmlFor="tk-title" className="block font-medium text-slate-700 mb-1">
                    ชื่องาน <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="tk-title"
                    required
                    value={dialog.form.title}
                    onChange={(e) => setField('title', e.target.value)}
                    className={inputClass}
                  />
                </div>

                {!dialog.taskId && (
                  <div>
                    <label htmlFor="tk-parent" className="block font-medium text-slate-700 mb-1">อยู่ภายใต้งานหลัก</label>
                    <select
                      id="tk-parent"
                      value={dialog.form.parentId ?? ''}
                      onChange={(e) => setField('parentId', e.target.value || null)}
                      className={inputClass}
                    >
                      <option value="">— เป็นงานหลัก —</option>
                      {topLevel.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.wbs} {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label htmlFor="tk-desc" className="block font-medium text-slate-700 mb-1">รายละเอียด</label>
                  <textarea
                    id="tk-desc"
                    rows={2}
                    value={dialog.form.description}
                    onChange={(e) => setField('description', e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="tk-start" className="block font-medium text-slate-700 mb-1">วันเริ่มงาน</label>
                    <input
                      id="tk-start"
                      type="date"
                      value={dialog.form.startDate ?? ''}
                      onChange={(e) => setField('startDate', e.target.value || null)}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div>
                    <label htmlFor="tk-due" className="block font-medium text-slate-700 mb-1">กำหนดเสร็จ</label>
                    <input
                      id="tk-due"
                      type="date"
                      min={dialog.form.startDate ?? undefined}
                      value={dialog.form.dueDate ?? ''}
                      onChange={(e) => setField('dueDate', e.target.value || null)}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="tk-status" className="block font-medium text-slate-700 mb-1">สถานะ</label>
                    <select
                      id="tk-status"
                      value={dialog.form.status}
                      onChange={(e) => setField('status', e.target.value as TaskStatus)}
                      className={inputClass}
                    >
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="tk-priority" className="block font-medium text-slate-700 mb-1">ความสำคัญ</label>
                    <select
                      id="tk-priority"
                      value={dialog.form.priority}
                      onChange={(e) => setField('priority', e.target.value as TaskPriority)}
                      className={inputClass}
                    >
                      {TASK_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {TASK_PRIORITY_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="tk-progress" className="block font-medium text-slate-700 mb-1">คืบหน้า (%)</label>
                    <input
                      id="tk-progress"
                      type="number"
                      min={0}
                      max={100}
                      value={dialog.form.progress}
                      onChange={(e) =>
                        setField('progress', Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))
                      }
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="tk-value" className="block font-medium text-slate-700 mb-1">มูลค่างาน (บาท)</label>
                    <input
                      id="tk-value"
                      type="number"
                      min={0}
                      step="0.01"
                      value={dialog.form.value}
                      onChange={(e) => setField('value', e.target.value === '' ? 0 : Number(e.target.value))}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div>
                    <label htmlFor="tk-assignee" className="block font-medium text-slate-700 mb-1">ผู้รับผิดชอบ</label>
                    <select
                      id="tk-assignee"
                      value={dialog.form.assigneeId ?? ''}
                      onChange={(e) => setField('assigneeId', e.target.value || null)}
                      className={inputClass}
                    >
                      <option value="">— ไม่ระบุ —</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </fieldset>

              {error && (
                <p role="alert" className="text-red-600 font-medium">
                  {error}
                </p>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDialog(null)}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-1.5 bg-[#2453d4] hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-60"
                >
                  {isPending ? 'กำลังบันทึก...' : 'บันทึกงาน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
