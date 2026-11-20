import Link from 'next/link';

/** Shows the message a refused button left in ?error= (see returnOnRefusal), with a way to clear it */
export function ActionErrorBanner({ message, clearHref }: { message?: string | string[]; clearHref: string }) {
  const text = Array.isArray(message) ? message[0] : message;
  if (!text) return null;
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p>{text}</p>
      <Link href={clearHref} scroll={false} className="shrink-0 text-xs text-red-700 underline">
        ปิด
      </Link>
    </div>
  );
}
