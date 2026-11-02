'use client';

import { useState, useTransition } from 'react';
import { formatThaiDate } from '@/domain/thai';

export function CommentBox({
  comments,
  onAddComment,
}: {
  comments: {
    id: string;
    body: string;
    userName: string;
    createdAt: Date;
  }[];
  onAddComment: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">ความคิดเห็น</h3>
      <div className="space-y-2 mb-3">
        {comments.length === 0 ? (
          <p className="text-xs text-slate-500">ยังไม่มีความคิดเห็น</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-slate-50 p-2.5 text-xs">
              <div className="flex justify-between text-slate-500 mb-1">
                <span className="font-medium text-slate-800">{c.userName}</span>
                <span>{formatThaiDate(c.createdAt)}</span>
              </div>
              <p className="text-slate-700 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          startTransition(async () => {
            await onAddComment(body);
            setBody('');
          });
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="พิมพ์ข้อความ..."
          className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          ส่ง
        </button>
      </form>
    </div>
  );
}
