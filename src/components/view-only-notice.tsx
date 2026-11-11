'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Eye } from 'lucide-react';
import { isMobileDevice, VIEW_ONLY_COOKIE, VIEW_ONLY_MESSAGE } from '@/domain/view-only-device';

const YEAR_SECONDS = 60 * 60 * 24 * 365;
// What the device is never changes while the page is open
const subscribe = () => () => {};
const onThisDevice = () =>
  isMobileDevice({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, hasFinePointer: window.matchMedia?.('(any-pointer: fine)').matches ?? true });
const onTheServer = () => false;

/**
 * Tells a phone or tablet user, on every page, that they may look and approve only. It also tells
 * the server: a tablet may call itself a computer, so only the browser can know, and says so in a cookie.
 */
export function ViewOnlyNotice() {
  const viewOnly = useSyncExternalStore(subscribe, onThisDevice, onTheServer);

  useEffect(() => {
    const marked = document.cookie.split('; ').includes(`${VIEW_ONLY_COOKIE}=1`);
    if (viewOnly && !marked) document.cookie = `${VIEW_ONLY_COOKIE}=1; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
    // A computer that once pretended to be a tablet (browser dev tools) is let back in
    if (!viewOnly && marked) document.cookie = `${VIEW_ONLY_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }, [viewOnly]);

  if (!viewOnly) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 md:px-6 print:hidden">
      <Eye className="h-4 w-4 shrink-0" />
      <span>{VIEW_ONLY_MESSAGE}</span>
    </div>
  );
}
