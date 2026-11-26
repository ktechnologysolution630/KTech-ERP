import { sameUnit } from './unit-match';

/**
 * Pricing a take-off: each item gets a material and a labour rate per unit from what the company has
 * already used, the way an estimator looks up the last job first:
 *
 * 1. a BOQ line of an earlier project with the same work and unit (both rates, as priced then),
 * 2. the last approved PO for the same thing in the same unit (material only, net of VAT),
 * 3. what is still missing is left for an AI estimate of today's market rate, marked as such.
 *
 * Matching is by name: Thai letters compared in pairs, and the sizes written in the name (หนา 10 ซม.,
 * Ø 4") must agree, so a 10 cm slab is never priced as a 15 cm one.
 */

export type PriceSource = 'boq' | 'po' | 'ai';

export interface PriceRef {
  source: 'boq' | 'po';
  description: string;
  unit: string;
  materialRate: number | null;
  laborRate: number | null;
  /** BOQ or PO number, shown to the user */
  ref: string;
  /** YYYY-MM-DD; newer wins a tie */
  date: string;
}

export interface PriceFrom {
  source: PriceSource;
  /** What the price was taken from: the BOQ/PO line, or the AI's short reason */
  label: string;
  /** How alike the names are, 0–1 (1 for AI) */
  score: number;
}

export interface PriceSuggestion {
  materialRate: number | null;
  laborRate: number | null;
  materialFrom: PriceFrom | null;
  laborFrom: PriceFrom | null;
}

/** Names at least this alike count as the same work */
export const MIN_SCORE = 0.62;

/** Short forms written both ways in BOQs */
const ABBREVIATIONS: [RegExp, string][] = [
  [/ค\.?\s?ส\.?\s?ล\.?/g, 'คอนกรีตเสริมเหล็ก'],
  [/ค\.?\s?ส\.?\s?ธ\.?/g, 'คอนกรีตล้วน'],
  [/^\s*งาน/, ''],
];

const thaiPairs = (raw: string) => {
  const s = ABBREVIATIONS.reduce((t, [re, to]) => t.replace(re, to), raw.normalize('NFC'));
  const t = s.replace(/ํา/g, 'ำ').replace(/[^ก-๛a-z]/gi, '').toLowerCase();
  const out = new Set<string>();
  for (let i = 1; i < t.length; i++) out.add(t.slice(i - 1, i + 1));
  return out;
};

/** Sizes in a name: "หนา 0.10 ม." and "หนา 10 ซม." are different strings but the same slab */
export function sizesOf(s: string): string[] {
  const out: string[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(ซม\.?|cm|มม\.?|mm|ม\.(?!\s*ต)|เมตร|m\b|นิ้ว|"|”)?/gi;
  for (const m of s.normalize('NFC').matchAll(re)) {
    let v = Number(m[1]!.replace(',', '.'));
    if (!Number.isFinite(v)) continue;
    const u = (m[2] ?? '').toLowerCase();
    if (/^(ซม|cm)/.test(u)) v /= 100;
    else if (/^(มม|mm)/.test(u)) v /= 1000;
    else if (/^(นิ้ว|"|”)/.test(u)) v *= 0.0254;
    out.push(String(Math.round(v * 10000) / 10000));
  }
  return [...new Set(out)].sort();
}

/** How alike two work names are, 0–1. Different sizes in the names make them different work. */
export function nameScore(a: string, b: string): number {
  const x = thaiPairs(a);
  const y = thaiPairs(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  // Dice alone punishes a name written out in full against a short one; containment alone matches
  // any long name holding a short word. Their mean keeps both in check.
  const dice = ((2 * both) / (x.size + y.size) + both / Math.min(x.size, y.size)) / 2;
  const sa = sizesOf(a);
  const sb = sizesOf(b);
  if (sa.length && sb.length) {
    const shared = sa.filter((v) => sb.includes(v)).length;
    if (shared === 0) return dice * 0.5;
    return Math.min(1, dice + 0.1 * shared);
  }
  return dice;
}

const unitFits = (a: string, b: string) => (!a.trim() && !b.trim()) || sameUnit(a, b);

function best(item: { description: string; unit: string }, refs: PriceRef[], has: (r: PriceRef) => boolean) {
  let top: { ref: PriceRef; score: number } | null = null;
  for (const r of refs) {
    if (!has(r) || !unitFits(item.unit, r.unit)) continue;
    const score = nameScore(item.description, r.description);
    if (score < MIN_SCORE) continue;
    if (!top || score > top.score + 1e-9 || (Math.abs(score - top.score) < 1e-9 && r.date > top.ref.date)) top = { ref: r, score };
  }
  return top;
}

const labelOf = (r: PriceRef) => `${r.source === 'boq' ? 'BOQ' : 'PO'} ${r.ref}: ${r.description}`.slice(0, 300);
const positive = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;

/** Rates for one item from the company's own BOQs and purchases; null where nothing fits */
export function suggestFromHistory(item: { description: string; unit: string }, refs: PriceRef[]): PriceSuggestion {
  const boq = refs.filter((r) => r.source === 'boq');
  const po = refs.filter((r) => r.source === 'po');
  const out: PriceSuggestion = { materialRate: null, laborRate: null, materialFrom: null, laborFrom: null };

  // A BOQ line gives both rates of the same job; take them together when it has both
  const both = best(item, boq, (r) => positive(r.materialRate) || positive(r.laborRate));
  if (both) {
    const from = { source: 'boq' as const, label: labelOf(both.ref), score: both.score };
    if (positive(both.ref.materialRate)) [out.materialRate, out.materialFrom] = [both.ref.materialRate, from];
    if (positive(both.ref.laborRate)) [out.laborRate, out.laborFrom] = [both.ref.laborRate, from];
  }
  if (out.laborRate === null) {
    const l = best(item, boq, (r) => positive(r.laborRate));
    if (l) [out.laborRate, out.laborFrom] = [l.ref.laborRate, { source: 'boq', label: labelOf(l.ref), score: l.score }];
  }
  if (out.materialRate === null) {
    const m = best(item, [...boq, ...po], (r) => positive(r.materialRate));
    if (m) [out.materialRate, out.materialFrom] = [m.ref.materialRate, { source: m.ref.source, label: labelOf(m.ref), score: m.score }];
  }
  return out;
}

/** Work that is labour only or material only, so an empty rate there is right, not missing */
export function needsRates(description: string): { material: boolean; labor: boolean } {
  const labourOnly = /^(ค่าแรง|ค่าติดตั้ง|ค่าขนย้าย|ค่ารื้อ|รื้อถอน|รื้อ)/.test(description.trim());
  return { material: !labourOnly, labor: true };
}

/**
 * The same work read twice in different units: a drawing note gives a road's length and its area
 * ("ยาว 1,800 ม. … พื้นที่ 9,000 ตร.ม."), and both come in as items. Priced both, the road would be
 * paid for twice. For each such pair the item to keep is the one the company has priced before (or
 * the area/volume over a length), and the other points at it.
 */
export function findSameWork(
  items: { key: string; description: string; unit: string }[],
  hasHistory: (key: string) => boolean,
): Map<string, string> {
  const rank = (u: string) => (sameUnit(u, 'ลบ.ม.') ? 3 : sameUnit(u, 'ตร.ม.') ? 2 : sameUnit(u, 'ม.') ? 1 : 0);
  const out = new Map<string, string>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (out.has(a.key) || out.has(b.key) || sameUnit(a.unit, b.unit)) continue;
      // Only measures of one thing: lengths, areas and volumes, never a count against a length
      if (!rank(a.unit) || !rank(b.unit)) continue;
      if (nameScore(a.description, b.description) < 0.9) continue;
      const keepA = hasHistory(a.key) !== hasHistory(b.key) ? hasHistory(a.key) : rank(a.unit) > rank(b.unit);
      if (keepA) out.set(b.key, a.key);
      else out.set(a.key, b.key);
    }
  }
  return out;
}
