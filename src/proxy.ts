import { NextResponse, type NextRequest } from 'next/server';
import { blockedMenuFor, isMenuKey, menuKeysForPath, type MenuKey } from '@/domain/menu';
import { isEditingPath, isViewOnlyRequest, VIEW_ONLY_COOKIE, VIEW_ONLY_MESSAGE, VIEW_ONLY_PATH } from '@/domain/view-only-device';
import { loginUrlFor, RETURN_PATH_HEADER } from '@/lib/return-path';
import { SESSION_COOKIE_NAME } from '@/server/auth/session';

const MENU_CHECK_TIMEOUT_MS = 3000;

/**
 * The menus hidden from this user. Asked of the app itself, because the proxy must not open the database: in
 * development that would mean a second copy of PGlite on the same files. Over loopback first, which stays off the
 * public network; through the site's own address if the server is not listening there.
 */
async function hiddenMenusFor(req: NextRequest): Promise<MenuKey[]> {
  const origins = [process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : null, req.nextUrl.origin].filter((o): o is string => o !== null);
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/api/session/hidden-menus`, {
        headers: { cookie: req.headers.get('cookie') ?? '' },
        signal: AbortSignal.timeout(MENU_CHECK_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const { hiddenMenus } = (await res.json()) as { hiddenMenus: unknown[] };
      return hiddenMenus.filter(isMenuKey);
    } catch {
      // Tried again below, or given up on
    }
  }
  // Roles still guard every page and action, so a failed check should not take the whole system down
  console.error('Could not check the menus hidden from this user; letting the request through');
  return [];
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const page = req.nextUrl.clone();
  page.searchParams.delete('_rsc');
  const returnPath = req.method === 'GET' ? `${page.pathname}${page.search}` : null;

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL(loginUrlFor(returnPath), req.url));
  }

  // An iPhone or iPad may only look. Uploads are refused here; a page made for writing is not opened at all.
  // Server actions are judged where they run (requireWriter), because the ones that only read must stay open.
  if (isViewOnlyRequest(req.headers.get('user-agent'), req.cookies.get(VIEW_ONLY_COOKIE)?.value)) {
    const reading = req.method === 'GET' || req.method === 'HEAD';
    if (!reading && pathname.startsWith('/api/')) {
      return NextResponse.json({ error: VIEW_ONLY_MESSAGE, code: 'VIEW_ONLY_DEVICE' }, { status: 403 });
    }
    if (reading && isEditingPath(pathname)) {
      return NextResponse.redirect(new URL(VIEW_ONLY_PATH, req.url));
    }
  }

  // Checked here because every request passes through: a layout does not run again when moving between pages
  const tab = req.nextUrl.searchParams.get('tab');
  const blocked = menuKeysForPath(pathname, tab).length > 0 ? blockedMenuFor(await hiddenMenusFor(req), pathname, tab) : null;
  if (blocked) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'บัญชีนี้ไม่ได้เปิดใช้เมนูนี้', code: 'MENU_HIDDEN' }, { status: 403 });
    }
    // 303 so a blocked form post arrives as an ordinary page view
    return NextResponse.redirect(new URL(`/no-access?menu=${blocked}`, req.url), 303);
  }

  const headers = new Headers(req.headers);
  headers.delete(RETURN_PATH_HEADER);
  if (returnPath) headers.set(RETURN_PATH_HEADER, returnPath);
  return NextResponse.next({ request: { headers } });
}
