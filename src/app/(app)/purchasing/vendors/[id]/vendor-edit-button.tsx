'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { VendorProfileDialog } from '@/components/vendor-profile-dialog';
import type { VendorProfileValues } from '@/components/vendor-profile-values';

/** Opens the full supplier profile form for this vendor */
export function VendorEditButton({
  vendorId,
  initial,
  attachments,
}: {
  vendorId: string;
  initial: VendorProfileValues;
  attachments: { id: string; url: string; name: string; size: number; uploaderName: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#2453d4] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1c43ab]"
      >
        <Pencil className="h-4 w-4" />
        แก้ไขข้อมูล
      </button>
      {open && <VendorProfileDialog vendorId={vendorId} initial={initial} attachments={attachments} onClose={() => setOpen(false)} />}
    </>
  );
}
