import { D, VAT_RATE, type Decimal, type VatMode } from './money';

/** What an item cost the last time it was bought: the newest approved PO that has it */
export interface LastPurchasePrice {
  itemId: string | null;
  description: string;
  unitName: string;
  /** Per unit, before VAT, after the line's own discount: the figure two orders can be compared on */
  unitPrice: number;
  poId: string;
  poNumber: string;
  /** YYYY-MM-DD */
  purchasedOn: string;
  vendorName: string;
}

/** A line priced above the last purchase of the same thing */
export interface PriceIncrease {
  last: LastPurchasePrice;
  /** This order's price on the same footing as `last.unitPrice` */
  unitPrice: number;
  diff: number;
  /** 20 = twenty percent dearer */
  percent: number;
}

interface PricedLine {
  itemId?: string | null;
  description: string;
  unitName: string;
  qty: Decimal.Value;
  unitPrice: Decimal.Value;
  discount?: Decimal.Value;
}

const same = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const number = (v: Decimal.Value | undefined) => {
  try {
    const d = D(v === '' || v === undefined ? 0 : v);
    return d.isFinite() ? d : D(0);
  } catch {
    return D(0);
  }
};

/**
 * Price per unit before VAT, after the line discount. An order written with VAT included and one
 * written without are brought to the same footing, so 107 including VAT is not "dearer" than 100
 * before it. Null when there is nothing to compare: no quantity, or no price yet.
 */
export function netUnitPrice(line: Pick<PricedLine, 'qty' | 'unitPrice' | 'discount'>, vatMode: VatMode): Decimal | null {
  const qty = number(line.qty);
  if (!qty.gt(0)) return null;
  const net = qty.times(number(line.unitPrice)).minus(number(line.discount)).div(qty);
  if (!net.gt(0)) return null;
  return vatMode === 'INCLUSIVE' ? net.times(100).div(100 + VAT_RATE) : net;
}

/**
 * What makes two lines "the same thing": the same catalogue item, or the same name when either side
 * was typed freely, and always in the same unit. A price per bag says nothing about a price per ton.
 */
export function priceKeys(line: Pick<PricedLine, 'itemId' | 'description' | 'unitName'>): string[] {
  const unit = same(line.unitName);
  const name = same(line.description);
  return [...(line.itemId ? [`${unit}|item:${line.itemId}`] : []), ...(name ? [`${unit}|name:${name}`] : [])];
}

/** The last purchase of the same thing. History comes newest first, so the first match is it. */
export function lastPriceFor(line: Pick<PricedLine, 'itemId' | 'description' | 'unitName'>, history: LastPurchasePrice[]): LastPurchasePrice | null {
  const keys = priceKeys(line);
  if (keys.length === 0) return null;
  return history.find((h) => priceKeys(h).some((k) => keys.includes(k))) ?? null;
}

/** The increase over the last purchase, or null when the price is the same, lower, or never bought before */
export function priceIncrease(line: PricedLine, vatMode: VatMode, history: LastPurchasePrice[]): PriceIncrease | null {
  const now = netUnitPrice(line, vatMode);
  if (!now) return null;
  const last = lastPriceFor(line, history);
  if (!last || !(last.unitPrice > 0)) return null;
  // Compared in satang: rounding VAT out of a price must not raise an alarm by itself
  const current = now.toDecimalPlaces(2);
  const before = D(last.unitPrice).toDecimalPlaces(2);
  if (!current.gt(before)) return null;
  const diff = current.minus(before);
  return { last, unitPrice: current.toNumber(), diff: diff.toNumber(), percent: diff.times(100).div(before).toDecimalPlaces(1).toNumber() };
}
