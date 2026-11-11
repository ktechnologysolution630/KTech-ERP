import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { VIEW_ONLY_COOKIE } from '@/domain/view-only-device';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const request = vi.hoisted(() => ({ userAgent: '', cookies: {} as Record<string, string>, user: { id: 'u1', name: 'ผู้ใช้' } as unknown }));
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': request.userAgent }),
  cookies: async () => ({ get: (name: string) => (name in request.cookies ? { name, value: request.cookies[name] } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock('@/db/client', () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock('@/server/auth/session', () => ({
  SESSION_COOKIE_NAME: 'ktec_session',
  verifySessionToken: async () => 'u1',
  loadSessionUserById: async () => request.user,
}));

import { requireDecider, requireUser, requireWriter } from '@/server/auth/current-user';
import { proxy } from '@/proxy';

describe('writing from an iPhone or iPad', () => {
  beforeEach(() => {
    request.userAgent = WINDOWS;
    request.cookies = { ktec_session: 'token' };
  });

  test('a computer writes as before', async () => {
    await expect(requireWriter()).resolves.toMatchObject({ id: 'u1' });
  });

  test('an Android tablet may look and approve, but not write', async () => {
    request.userAgent = ANDROID_TABLET;
    await expect(requireWriter()).rejects.toMatchObject({ to: '/view-only' });
    await expect(requireDecider()).resolves.toMatchObject({ id: 'u1' });
    await expect(requireUser()).resolves.toMatchObject({ id: 'u1' });
  });

  test('an iPhone is sent to the page that says it may only look, and still reads', async () => {
    request.userAgent = IPHONE;
    await expect(requireWriter()).rejects.toMatchObject({ to: '/view-only' });
    await expect(requireUser()).resolves.toMatchObject({ id: 'u1' });
  });

  test('an iPad that calls itself a Mac is stopped by the mark its browser left', async () => {
    request.userAgent = MAC;
    await expect(requireWriter()).resolves.toMatchObject({ id: 'u1' });
    request.cookies[VIEW_ONLY_COOKIE] = '1';
    await expect(requireWriter()).rejects.toMatchObject({ to: '/view-only' });
  });

  test('nobody signed in goes to the login page first, whatever the device', async () => {
    request.userAgent = IPHONE;
    request.cookies = {};
    await expect(requireWriter()).rejects.toMatchObject({ to: expect.stringMatching(/^\/login/) });
  });
});

describe('the proxy on an iPhone or iPad', () => {
  const send = (path: string, init: { method?: string; userAgent?: string; cookie?: string } = {}) =>
    proxy(
      new NextRequest(`http://localhost${path}`, {
        method: init.method ?? 'GET',
        headers: { 'user-agent': init.userAgent ?? IPHONE, cookie: `ktec_session=token${init.cookie ? `; ${init.cookie}` : ''}` },
      }),
    );

  test('an upload is refused', async () => {
    const res = await send('/api/upload', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'VIEW_ONLY_DEVICE' });
    const fromIpad = await send('/api/upload', { method: 'POST', userAgent: MAC, cookie: `${VIEW_ONLY_COOKIE}=1` });
    expect(fromIpad.status).toBe(403);
  });

  test('a stored file is still opened', async () => {
    const res = await send('/api/upload?id=x');
    expect(res.status).toBe(200);
  });

  test('a page made for writing is not opened', async () => {
    for (const path of ['/view-only-check/new', '/po/8f1c/edit']) {
      const res = await send(path);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost/view-only');
    }
  });

  test('the vehicle menu opens and its forms work on an iPhone', async () => {
    for (const path of ['/vehicles', '/vehicles/new', '/vehicles/8f1c']) expect((await send(path)).status).toBe(200);
  });

  test('the page that explains it is always reachable', async () => {
    const res = await send('/view-only');
    expect(res.status).toBe(200);
  });

  test('a computer uploads and opens the same pages', async () => {
    expect((await send('/api/upload', { method: 'POST', userAgent: WINDOWS })).status).toBe(200);
    expect((await send('/view-only-check/new', { userAgent: WINDOWS })).status).toBe(200);
  });
});
