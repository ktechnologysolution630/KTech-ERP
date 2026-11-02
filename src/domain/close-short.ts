import { allocate, D, round2, sum, type Decimal } from './money';
import { type InstallmentStatus } from '@/db/schema/po';

export interface InstallmentForRescale {
  id: string;
  amount: Decimal;
  status: InstallmentStatus;
}

export interface RescaledInstallmentUpdate {
  id: string;
  amount: Decimal;
  status: 'PENDING' | 'CANCELLED';
}

export function rescaleInstallments(
  newGross: Decimal,
  installments: InstallmentForRescale[],
): {
  updates: RescaledInstallmentUpdate[];
  refundDue: Decimal;
} {
  const kept = installments.filter(
    (i) => i.status === 'REQUESTED' || i.status === 'PAID',
  );
  const pending = installments.filter((i) => i.status === 'PENDING');

  const keptTotal = sum(kept.map((i) => round2(i.amount)));
  const remaining = round2(round2(newGross).minus(keptTotal));

  if (remaining.lte(0)) {
    const updates: RescaledInstallmentUpdate[] = pending.map((p) => ({
      id: p.id,
      amount: D(0),
      status: 'CANCELLED',
    }));
    const refundDue = remaining.lt(0) ? remaining.negated() : D(0);
    return { updates, refundDue };
  }

  if (pending.length === 0) {
    return { updates: [], refundDue: D(0) };
  }

  const weights = pending.map((p) =>
    p.amount.gt(0) ? p.amount : D(1),
  );
  const scaledAmounts = allocate(remaining, weights);

  const updates: RescaledInstallmentUpdate[] = pending.map((p, idx) => {
    const amt = scaledAmounts[idx] ?? D(0);
    return {
      id: p.id,
      amount: amt,
      status: amt.gt(0) ? 'PENDING' : 'CANCELLED',
    };
  });

  return { updates, refundDue: D(0) };
}
