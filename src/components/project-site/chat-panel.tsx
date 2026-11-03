'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import { Send } from 'lucide-react';
import { loadChatAction, postChatAction } from '@/app/(app)/projects/[id]/site-actions';
import { useSiteLoader } from './use-site-loader';

const timeText = (d: Date | string) =>
  new Date(d).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Project chat: polls every 10 s while the page is visible. */
export function ChatPanel({ projectId, me }: { projectId: string; me: string }) {
  const { data, error, setData } = useSiteLoader(() => loadChatAction(projectId), [projectId], 10_000);
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const count = data?.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setSendError(null);
    startTransition(async () => {
      const r = await postChatAction(projectId, body);
      if (!r.ok) {
        setSendError(r.error);
        return;
      }
      setText('');
      setData(r.value);
    });
  };

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col h-[560px]">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="font-bold text-sm text-slate-900">แชทโครงการ</h3>
        <p className="text-[11px] text-slate-500">{count} ข้อความ · อัปเดตอัตโนมัติทุก 10 วินาที</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
        {!data ? (
          <p className="text-center text-xs text-slate-400 pt-10">กำลังโหลด...</p>
        ) : data.length === 0 ? (
          <p className="text-center text-xs text-slate-400 pt-10">ยังไม่มีข้อความ พิมพ์ทักทายเป็นคนแรก</p>
        ) : (
          data.map((m) => {
            const mine = m.userId === me;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-xs ${mine ? 'bg-[#2453d4] text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
                  {!mine && <div className="font-semibold text-[11px] text-[#2453d4] mb-0.5">{m.userName}</div>}
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div className={`mt-1 text-[10px] ${mine ? 'text-blue-100' : 'text-slate-400'}`}>{timeText(m.createdAt)}</div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="p-3 border-t border-slate-100 flex items-end gap-2"
      >
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={4000}
          placeholder="พิมพ์ข้อความ แล้วกด Enter (Shift+Enter ขึ้นบรรทัดใหม่)"
          className="flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:border-[#2453d4]"
        />
        <button type="submit" disabled={isPending || !text.trim()} className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg bg-[#2453d4] text-white text-xs font-semibold disabled:opacity-50">
          <Send className="w-3.5 h-3.5" /> ส่ง
        </button>
      </form>
      {sendError && (
        <p role="alert" className="px-4 pb-2 text-xs text-red-600">
          {sendError}
        </p>
      )}
    </div>
  );
}
