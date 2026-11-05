import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { isMenuKey, MENU_LABELS } from '@/domain/menu';

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ menu?: string }> }) {
  const { menu } = await searchParams;
  const label = isMenuKey(menu) ? MENU_LABELS[menu] : null;
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs">
        <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
        <h1 className="text-lg font-bold text-slate-900">บัญชีนี้ไม่ได้เปิดใช้เมนู{label ? ` ${label}` : 'นี้'}</h1>
        <p className="text-sm text-slate-600">หากต้องใช้งาน กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดเมนูนี้ในหน้าผู้ใช้งาน</p>
        <Link href="/inbox" prefetch={false} className="inline-block rounded-lg bg-[#2453d4] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          กลับไปพอร์ทัลของฉัน
        </Link>
      </div>
    </div>
  );
}
