import { similar } from './text-takeoff';

/**
 * The AI reads one sheet at a time, so a note that a drawing set repeats on every plan sheet
 * (“ถนนลาดยาง ยาว 1,800 ม.”) comes back once per sheet. Added up, those repeats would multiply
 * the quantity. Here the same item read on several sheets becomes one row that lists its pages.
 */

export interface PagedAiItem {
  page: number;
  category: string;
  description: string;
  kind: 'length' | 'area' | 'count';
  unit: string;
  qty: number;
  basis: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface MergedAiItem extends PagedAiItem {
  /** Every sheet this item was read on, first one first */
  pages: number[];
}

/** Rows already merged can be passed back in with their pages, so new sheets join them as they arrive */
type Input = PagedAiItem & { pages?: number[] };

const unitKey = (u: string) => u.replace(/\s+/g, '').replace(/\.$/, '').replace(/^ตารางเมตร$/, 'ตร.ม').replace(/^เมตร$/, 'ม').toLowerCase();
const sameQty = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.005, 0.005 * Math.max(a, b));
const plain = (s: string) => s.replace(/\s+/g, '').toLowerCase();
/** Names in Latin script only (“HDPE pipe”) have no Thai to compare, so they must match exactly */
const sameName = (a: string, b: string) => plain(a) === plain(b) || similar(a, b);
const RANK = { high: 0, medium: 1, low: 2 } as const;

export function mergeAcrossPages<T extends Input>(items: T[]): (T & MergedAiItem)[] {
  const out: (T & MergedAiItem)[] = [];
  // Rows passed back in may have been edited by the user; their text is kept as it is
  const settled = new Set<MergedAiItem>();
  for (const it of items) {
    const pages = it.pages ?? [it.page];
    const twin = out.find(
      (m) =>
        m.kind === it.kind &&
        unitKey(m.unit) === unitKey(it.unit) &&
        sameQty(m.qty, it.qty) &&
        !pages.some((p) => m.pages.includes(p)) &&
        sameName(m.description, it.description),
    );
    if (!twin) {
      const row = { ...it, pages: [...pages] };
      out.push(row);
      if (it.pages) settled.add(row);
      continue;
    }
    twin.pages.push(...pages);
    // Keep the clearer reading: the more confident one, else the longer (more specific) name
    if (settled.has(twin)) continue;
    if (RANK[it.confidence] < RANK[twin.confidence] || (RANK[it.confidence] === RANK[twin.confidence] && it.description.length > twin.description.length)) {
      Object.assign(twin, { category: it.category, description: it.description, basis: it.basis, confidence: it.confidence });
    }
  }
  for (const m of out) {
    m.pages.sort((a, b) => a - b);
    m.page = m.pages[0]!;
  }
  return out;
}
