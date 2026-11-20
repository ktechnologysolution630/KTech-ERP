import { D, Decimal, round2 } from './money';

/**
 * ต้นทุนเฉลี่ยเคลื่อนที่ (Moving Average): goods received at a new cost are averaged with what is on
 * hand, across every store, as Express does. When nothing (or less than nothing) is on hand, the
 * new cost is the average.
 */
export function movingAverage(onHand: Decimal.Value, avgCost: Decimal.Value, qtyIn: Decimal.Value, costIn: Decimal.Value): Decimal {
  const q0 = D(onHand);
  const q1 = D(qtyIn);
  if (q0.lte(0) || q0.plus(q1).lte(0)) return round2(D(costIn));
  return round2(q0.times(avgCost).plus(q1.times(costIn)).div(q0.plus(q1)));
}

export interface CardMovement {
  id: string;
  date: string;
  number: string;
  reference: string;
  type: 'RECEIVE' | 'ISSUE' | 'TRANSFER' | 'ADJUST' | 'RETURN';
  /** Positive, except ADJUST which carries its sign */
  quantity: number;
  unitCost: number;
  projectId: string | null;
  targetProjectId: string | null;
  notes: string;
}

export interface CardRow {
  id: string;
  date: string;
  number: string;
  reference: string;
  type: CardMovement['type'];
  notes: string;
  qtyIn: number;
  qtyOut: number;
  unitCost: number;
  valueIn: number;
  valueOut: number;
  balanceQty: number;
  balanceValue: number;
  avgCost: number;
}

/** 'ALL' = every store together (transfers between stores cancel out) */
export type CardLocation = string | null | 'ALL';

/** How a movement changes the quantity at the location the card is for */
export function signedQtyAt(m: CardMovement, at: CardLocation): Decimal {
  const q = D(m.quantity);
  switch (m.type) {
    case 'RECEIVE':
    case 'RETURN':
      return at === 'ALL' || m.projectId === at ? q : D(0);
    case 'ISSUE':
      return at === 'ALL' || m.projectId === at ? q.neg() : D(0);
    case 'ADJUST':
      return at === 'ALL' || m.projectId === at ? q : D(0);
    case 'TRANSFER': {
      if (at === 'ALL') return D(0);
      if (m.projectId === at) return q.neg();
      if (m.targetProjectId === at) return q;
      return D(0);
    }
  }
}

/**
 * สมุดคุมสต็อก (Stock Card): each movement in order with quantity and value in, out and on hand.
 * Value goes in at the cost the movement carried and out at the running average, so the balance value
 * divided by the balance quantity is the moving average cost.
 */
export function buildStockCard(movements: CardMovement[], at: CardLocation, from: string): { opening: { qty: number; value: number }; rows: CardRow[]; closing: { qty: number; value: number; avgCost: number } } {
  let qty = D(0);
  let value = D(0);
  let opening = { qty: 0, value: 0 };
  let openingTaken = false;
  const rows: CardRow[] = [];
  for (const m of movements) {
    if (!openingTaken && m.date >= from) {
      opening = { qty: qty.toNumber(), value: round2(value).toNumber() };
      openingTaken = true;
    }
    const delta = signedQtyAt(m, at);
    if (delta.isZero()) continue;
    const avg = qty.gt(0) ? value.div(qty) : D(m.unitCost);
    let valueIn = D(0);
    let valueOut = D(0);
    if (delta.gt(0)) {
      valueIn = round2(delta.times(D(m.unitCost)));
      value = value.plus(valueIn);
    } else {
      valueOut = round2(delta.abs().times(avg));
      value = value.minus(valueOut);
    }
    qty = qty.plus(delta);
    if (qty.isZero()) value = D(0);
    if (m.date < from) continue;
    rows.push({
      id: m.id,
      date: m.date,
      number: m.number,
      reference: m.reference,
      type: m.type,
      notes: m.notes,
      qtyIn: delta.gt(0) ? delta.toNumber() : 0,
      qtyOut: delta.lt(0) ? delta.abs().toNumber() : 0,
      unitCost: delta.gt(0) ? round2(valueIn.div(delta)).toNumber() : round2(avg).toNumber(),
      valueIn: valueIn.toNumber(),
      valueOut: valueOut.toNumber(),
      balanceQty: qty.toNumber(),
      balanceValue: round2(value).toNumber(),
      avgCost: qty.gt(0) ? round2(value.div(qty)).toNumber() : 0,
    });
  }
  if (!openingTaken) opening = { qty: qty.toNumber(), value: round2(value).toNumber() };
  return { opening, rows, closing: { qty: qty.toNumber(), value: round2(value).toNumber(), avgCost: qty.gt(0) ? round2(value.div(qty)).toNumber() : 0 } };
}
