import { requireUser } from '@/server/auth/current-user';

export const metadata = { title: 'คู่มือการใช้งาน' };

/**
 * The pipeline user guide. It is a self-contained page in public/guide (built from the user manual by
 * scripts/build-pipeline-guide.mjs) shown in a frame, so its scroll animations run on their own and never touch the app's styles.
 * Everyone signed in may read it.
 */
export default async function GuidePage() {
  await requireUser();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">คู่มือการใช้งาน</h1>
          <p className="mt-1 text-xs text-slate-600">เลือกสายงาน เลื่อนดูทีละขั้น แล้วแตะการ์ดเพื่อดูวิธีทำ</p>
        </div>
        <a
          href="/guide/index.html"
          target="_blank"
          rel="noopener"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          เปิดเต็มจอ ↗
        </a>
      </div>
      <iframe
        src="/guide/index.html"
        title="คู่มือการใช้งาน K Tec ERP"
        className="block w-full rounded-xl border border-slate-200 bg-black"
        style={{ height: 'calc(100dvh - 160px)', minHeight: 520 }}
      />
    </div>
  );
}
