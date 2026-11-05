import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/current-user';

/** Asked by the proxy, which should not open the database itself. Answers only for whoever's session cookie came with the request. */
export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ hiddenMenus: user?.hiddenMenus ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}
