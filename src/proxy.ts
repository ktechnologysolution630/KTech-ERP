import { NextResponse, type NextRequest } from 'next/server';
import { loginUrlFor, RETURN_PATH_HEADER } from '@/lib/return-path';
import { SESSION_COOKIE_NAME } from '@/server/auth/session';

export function proxy(req: NextRequest) {
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

  const headers = new Headers(req.headers);
  headers.delete(RETURN_PATH_HEADER);
  if (returnPath) headers.set(RETURN_PATH_HEADER, returnPath);
  return NextResponse.next({ request: { headers } });
}
