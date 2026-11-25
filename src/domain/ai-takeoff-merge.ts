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

/* ------------------------------------------------------------------------------------------------
 * Checking the AI against the numbers written on the drawing. A total the designer wrote in a note
 * (“พื้นที่รวมประมาณ 9,000 ตร.ม.”) is the figure to trust; the AI's row for the same work either
 * agrees with it, or the user is shown what the drawing says. Written totals the AI left out are
 * handed back so they can be added too.
 * ---------------------------------------------------------------------------------------------- */

export interface WrittenQty {
  description: string;
  kind: 'length' | 'area' | 'count';
  unit: string;
  qty: number;
  pages: number[];
  source: string;
}

/** part: a share of a total the drawing writes (one road segment of the 9,000 ตร.ม.) */
export type DrawingCheck = { status: 'match' } | { status: 'part' | 'differs'; written: WrittenQty };

/** A quantity this big that matches in number and unit is the same note, even under a garbled OCR name */
const SURE_QTY = 20;

interface Checkable {
  description: string;
  kind: 'length' | 'area' | 'count';
  unit: string;
  qty: number;
  scope?: string;
}

export function checkAgainstDrawing(rows: Checkable[], written: WrittenQty[]): { checks: (DrawingCheck | null)[]; missing: WrittenQty[] } {
  const same = (r: Checkable, w: WrittenQty) => r.kind === w.kind && unitKey(r.unit) === unitKey(w.unit);
  const used = new Set<WrittenQty>();
  const checks = rows.map((r): DrawingCheck | null => {
    const hit = written.find((w) => same(r, w) && sameQty(r.qty, w.qty) && (w.qty >= SURE_QTY || sameName(r.description, w.description)));
    if (hit) {
      used.add(hit);
      return { status: 'match' };
    }
    // A quantity for one pit or panel is meant to differ from the job's total
    if (r.scope === 'per_unit') return null;
    const near = written.filter((w) => same(r, w) && sameName(r.description, w.description)).sort((a, b) => b.pages.length - a.pages.length)[0];
    if (!near) return null;
    return { status: r.qty < near.qty ? 'part' : 'differs', written: near };
  });
  // A written total counts as covered when any row carries the same number in the same unit
  const missing = written.filter((w) => !used.has(w) && !rows.some((r) => same(r, w) && sameQty(r.qty, w.qty)));
  return { checks, missing };
}

/* ------------------------------------------------------------------------------------------------
 * Rows already in the take-off. The free ถอดแบบอัตโนมัติ may have put the written totals in first;
 * the AI then reads the same notes again. A row with the same quantity and unit as an item already
 * there is the same work, so adding it would count it twice in the BOQ.
 * ---------------------------------------------------------------------------------------------- */

export interface ExistingItem {
  description: string;
  kind: 'length' | 'area' | 'count';
  unit: string;
  qty: number;
}

/**
 * Each item in the take-off stands for one row at most: the free take-off names a note's total from
 * garbled OCR, so a big number alone is enough to pair it, but the road's 1,800 ม. is not also the
 * pipe's 1,800 ม. Rows with a similar name pair first; then the first row with the same number.
 */
export function findInTakeoff<E extends ExistingItem>(rows: Checkable[], existing: E[]): (E | null)[] {
  const out: (E | null)[] = rows.map(() => null);
  const used = new Set<E>();
  const same = (r: Checkable, e: E) => e.qty > 0 && r.kind === e.kind && unitKey(r.unit) === unitKey(e.unit) && sameQty(r.qty, e.qty);
  for (const byName of [true, false]) {
    rows.forEach((r, i) => {
      if (out[i]) return;
      const hit = existing.find((e) => !used.has(e) && same(r, e) && (byName ? sameName(r.description, e.description) : e.qty >= SURE_QTY));
      if (hit) {
        out[i] = hit;
        used.add(hit);
      }
    });
  }
  return out;
}
