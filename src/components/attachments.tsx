'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { type EntityType } from '@/db/schema';
import { resizeImage } from '@/lib/image-resize';

export function AttachmentsBox({
  entityType,
  entityId,
  items,
}: {
  entityType: EntityType;
  entityId: string;
  items: {
    id: string;
    url: string;
    name: string;
    size: number;
    uploaderName: string;
  }[];
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const processed = await resizeImage(file);
      const fd = new FormData();
      fd.set('entityType', entityType);
      fd.set('entityId', entityId);
      fd.set('file', processed);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'อัปโหลดไม่สำเร็จ');
      } else {
        router.refresh();
      }
    } catch {
      setError('อัปโหลดไม่สำเร็จ');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">ไฟล์แนบ</h3>
        <label className="cursor-pointer rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">
          {uploading ? 'กำลังอัปโหลด...' : '+ แนบไฟล์/รูป'}
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={handleFileChange}
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">ยังไม่มีไฟล์แนบ</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {items.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2">
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline truncate"
              >
                {f.name}
              </a>
              <span className="text-slate-400 whitespace-nowrap">
                {Math.round(f.size / 1024)} KB · {f.uploaderName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
