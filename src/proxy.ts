import { NextResponse, type NextRequest } from 'next/server';
import { isMenuSection, menuSectionForPath, type MenuSection } from '@/domain/menu';
import { loginUrlFor, RETURN_PATH_HEADER } from '@/lib/return-path';
import { SESSION_COOKIE_NAME } from '@/server/auth/session';

const MENU_CHECK_TIMEOUT_MS = 3000;

/**
 * The menus hidden from this user. Asked of the app itself, because the proxy must not open the database: in
 * development that would mean a second copy of PGlite on the same files. Over loopback first, which stays off the
 * public network; through the site's own address if the server is not listening there.
 */
async function hiddenMenusFor(req: NextRequest): Promise<MenuSection[]> {
  const origins = [process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : null, req.nextUrl.origin].filter((o): o is string => o !== null);
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/api/session/hidden-menus`, {
        headers: { cookie: req.headers.get('cookie') ?? '' },
        signal: AbortSignal.timeout(MENU_CHECK_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const { hiddenMenus } = (await res.json()) as { hiddenMenus: unknown[] };
      return hiddenMenus.filter(isMenuSection);
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

  // Checked here because every request passes through: a layout does not run again when moving between pages
  const section = menuSectionForPath(pathname);
  if (section && (await hiddenMenusFor(req)).includes(section)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'บัญชีนี้ไม่ได้เปิดใช้เมนูนี้', code: 'MENU_HIDDEN' }, { status: 403 });
    }
    // 303 so a blocked form post arrives as an ordinary page view
    return NextResponse.redirect(new URL(`/no-access?menu=${section}`, req.url), 303);
  }

  const headers = new Headers(req.headers);
  headers.delete(RETURN_PATH_HEADER);
  if (returnPath) headers.set(RETURN_PATH_HEADER, returnPath);
  return NextResponse.next({ request: { headers } });
}
