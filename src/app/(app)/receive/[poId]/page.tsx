import { getDb } from '@/db/client';
import { bangkokDateString } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { getPoOrNotFound } from '@/app/(app)/po/get-po-or-not-found';
import { MobileReceiveForm } from '@/components/mobile-receive-form';

export default async function ReceivePoPage({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  const { poId } = await params;
  const actor = await requireUser();
  const db = await getDb();
  const po = await getPoOrNotFound(db, actor, poId);
  const remainingLines = po.lines
    .filter((l) => l.remainingQty.gt(0))
    .map((l) => ({
      id: l.id,
      description: l.description,
      unitName: l.unitName,
      orderedQty: Number(l.qty),
      receivedQty: l.receivedQty.toNumber(),
      remainingQty: l.remainingQty.toNumber(),
    }));

  return (
    <MobileReceiveForm
      poId={po.id}
      poNumber={po.number}
      vendorName={po.vendorName}
      projectLabel={`${po.projectCode} - ${po.projectName}`}
      defaultDate={bangkokDateString()}
      lines={remainingLines}
    />
  );
}
