'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SiteResult } from '@/app/(app)/projects/[id]/site-actions';

/**
 * Loads a panel's data through a server action on mount and whenever `reload` is called;
 * optional polling (chat). Stale responses from an earlier call are ignored.
 */
export function useSiteLoader<T>(load: () => Promise<SiteResult<T>>, deps: unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const r = await loadRef.current();
    if (mine !== seq.current) return;
    if (r.ok) {
      setData(r.value);
      setError(null);
    } else {
      setError(r.error);
    }
  }, []);

  useEffect(() => {
    void reload();
    if (!pollMs) return;
    const t = setInterval(() => {
      // Skip polling while the tab is hidden
      if (document.visibilityState === 'visible') void reload();
    }, pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, pollMs, ...deps]);

  return { data, error, reload, setData };
}

export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Uploads one file to the project (or another entity) through /api/upload. */
export async function uploadFile(form: {
  entityType: string;
  entityId: string;
  file: File;
  kind?: 'FILE' | 'PHOTO';
  folder?: string;
}): Promise<string | null> {
  const body = new FormData();
  body.set('file', form.file);
  body.set('entityType', form.entityType);
  body.set('entityId', form.entityId);
  if (form.kind) body.set('kind', form.kind);
  if (form.folder) body.set('folder', form.folder);
  const res = await fetch('/api/upload', { method: 'POST', body });
  if (res.ok) return null;
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return json?.error ?? 'อัปโหลดไม่สำเร็จ';
}
