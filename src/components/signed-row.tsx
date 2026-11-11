import type { Signer } from '@/domain/signature';

/**
 * The signature lines of a document. A line someone has signed in the system carries their
 * signature (or their name, if they have not made one), name and date; the rest stay blank as on
 * the printed form.
 */
export function SignedRow({ signers, className = '' }: { signers: Signer[]; className?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-6 text-center text-xs text-slate-600 ${signers.length === 2 ? 'sm:grid-cols-2 print:grid-cols-2' : 'sm:grid-cols-3 print:grid-cols-3'} ${className}`}>
      {signers.map((s) => (
        <div key={s.label} className="space-y-1">
          <div className="mx-auto flex h-14 w-48 max-w-full items-end justify-center border-b border-slate-400 pb-0.5">
            {s.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.image} alt={`ลายเซ็น ${s.name ?? ''}`} className="max-h-14 max-w-full object-contain" />
            ) : s.name ? (
              <span className="pb-1 text-sm italic text-slate-800">{s.name}</span>
            ) : null}
          </div>
          <p>({s.label})</p>
          {s.name ? (
            <>
              <p className="font-medium text-slate-800">{s.name}</p>
              <p>{s.date ? `วันที่ ${s.date}` : 'ลงนามในระบบ'}</p>
            </>
          ) : (
            <p>วันที่ ____ / ____ / ______</p>
          )}
        </div>
      ))}
    </div>
  );
}
