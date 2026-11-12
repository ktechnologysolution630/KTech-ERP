'use client';

import { useEffect } from 'react';

/** Under the 15 idle minutes after which the free hosting plan stops the server */
const EVERY_MS = 4 * 60 * 1000;

const ping = () => fetch('/api/ping', { cache: 'no-store' }).catch(() => {});

/**
 * Keeps the server awake while a page is open on screen, and wakes it the moment someone comes back
 * to the tab, so it is up before they press save.
 */
export function KeepServerAwake() {
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void ping();
    }, EVERY_MS);
    const onVisible = () => {
      if (!document.hidden) void ping();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);
  return null;
}
