import type { TakeoffKind } from './boq-takeoff';
import { nameScore, sizesFit } from './takeoff-pricing';
import { similar } from './text-takeoff';

/**
 * The AI reads one sheet at a time, so a note that a drawing set repeats on every plan sheet
 * (“ถนนลาดยาง ยาว 1,800 ม.”) comes back once per sheet. Added up, those repeats would multiply
 * the quantity. Here the same item read on several sheets becomes one row that lists its pages.
 *
 * Only a true repeat is joined. The same material at two places (ท่อ HDPE ที่ลานจอดรถ and ท่อ HDPE
 * ริมคลอง, both 2 จุด) is two quantities, so rows are joined only when:
 * - both state a total for the whole job, or both are the same typical detail (same perUnitOf),
 *   never two counts of what one sheet shows unless both name the same place,
 * - the places they name (location) agree,
 * - the names are near-identical and every size written in them agrees (Ø 300 is not Ø 400).
 */

export interface PagedAiItem {
  page: number;
  category: string;
  description: string;
  kind: TakeoffKind;
  unit: string;
  qty: number;
  basis: string;
  confidence: 'high' | 'medium' | 'low';
  /** What the quantity covers; rows without one are read as a total for the job */
  scope?: 'project_total' | 'this_sheet' | 'per_unit';
  perUnitOf?: string;
  /** Where on the job it is (zone, segment, building), as the sheet names it; empty for the whole job */
  location?: string;
}

export interface MergedAiItem extends PagedAiItem {
  /** Every sheet this item was read on, first one first */
  pages: number[];
}

/** Rows already merged can be passed back in with their pages, so new sheets join them as they arrive */
type Input = PagedAiItem & { pages?: number[]; apart?: boolean };

const unitKey = (u: string) => u.replace(/\s+/g, '').replace(/\.$/, '').replace(/^ตารางเมตร$/, 'ตร.ม').replace(/^เมตร$/, 'ม').toLowerCase();
const sameQty = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.005, 0.005 * Math.max(a, b));
const plain = (s: string) => s.replace(/\s+/g, '').toLowerCase();
/** Names in Latin script only (“HDPE pipe”) have no Thai to compare, so they must match exactly */
const sameName = (a: string, b: string) => plain(a) === plain(b) || (similar(a, b) && sizesFit(a, b));

const sameSizes = sizesFit;

/** Strict enough for joining rows: a shared word or two is not the same work */
export const JOIN_SCORE = 0.75;
function sameWork(a: string, b: string) {
  if (plain(a) === plain(b)) return true;
  if (!sameSizes(a, b)) return false;
  return nameScore(a, b) >= JOIN_SCORE;
}

/** Zone letters, type numbers and stations (โซน A, บ่อพัก คสล. 2, STA 0+500) must be the same ones */
const marks = (s: string) => [...new Set((s.normalize('NFC').match(/[a-z0-9]+/gi) ?? []).map((m) => m.toLowerCase()))].sort().join(' ');
/**
 * Labels of places and typical units. The AI words one place a little differently on each sheet
 * (“ถนนภายในสวน STA 0+000–0+1,800”, “แนวถนนภายในสวน”), so the words need only be alike; marks written
 * on both (โซน A / โซน B, บ่อพัก คสล. 1 / 2) must be the same.
 */
export const PLACE_SCORE = 0.6;
function sameLabel(a: string, b: string) {
  if (plain(a) === plain(b)) return true;
  const ma = marks(a);
  const mb = marks(b);
  if (ma && mb && ma !== mb) return false;
  return nameScore(a.replace(/[a-z0-9]+/gi, ' '), b.replace(/[a-z0-9]+/gi, ' ')) >= PLACE_SCORE;
}

const placeOf = (r: Input) => plain(r.location ?? '');
/** Two named places must be the same place; an unnamed one is the whole job */
const samePlace = (a: Input, b: Input) => !placeOf(a) || !placeOf(b) || sameLabel(a.location!, b.location!);

/** Whether two rows can be one item read twice, by what each quantity covers */
function sameCover(a: Input, b: Input) {
  const sa = a.scope ?? 'project_total';
  const sb = b.scope ?? 'project_total';
  if (sa !== sb) return false;
  if (sa === 'per_unit') return sameLabel(a.perUnitOf ?? '', b.perUnitOf ?? '');
  // What one sheet shows is that sheet's place; another sheet with the same count is another place,
  // unless both name the same place (one segment drawn at two scales)
  if (sa === 'this_sheet') return Boolean(placeOf(a)) && placeOf(a) === placeOf(b);
  return true;
}

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
        // Rows the user split apart stay apart
        !m.apart &&
        !it.apart &&
        sameCover(m, it) &&
        samePlace(m, it) &&
        sameWork(m.description, it.description),
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

/**
 * Rows kept apart that still look like one item: the same work, kind, unit and quantity, but on one
 * sheet (read twice from the whole sheet and a zoomed part) or at places the AI named differently.
 * They are not joined, since the same material at two places is two quantities; the user is asked to
 * look. Each such row points at the first row it looks like.
 */
export const LOOK_ALIKE_SCORE = 0.6;
/** A size on one name only (ท่อ Ø 0.40 ม. / ท่อเข้าบ่อ) needs the stricter score */
const sized = (s: string) => /[Øø∅]|ขนาด|หนา|กว้าง|ยาว|\d+(?:\.\d+)?\s*(?:ม\.|ซม|มม|นิ้ว)/.test(s);
export function findLookAlikes<T extends Input & { pages?: number[] }>(rows: T[]): (T | null)[] {
  return rows.map((r, i) => {
    for (let j = 0; j < i; j++) {
      const o = rows[j]!;
      if (o.kind !== r.kind || unitKey(o.unit) !== unitKey(r.unit) || !sameQty(o.qty, r.qty)) continue;
      if ((o.scope ?? 'project_total') === 'per_unit' || (r.scope ?? 'project_total') === 'per_unit') continue;
      // Looser than joining: this only asks the user to look (“บ่อลูบน้ำ” read for บ่อสูบน้ำ on one sheet)
      if (plain(o.description) === plain(r.description) || (sizesFit(o.description, r.description) && nameScore(o.description, r.description) >= (sized(o.description) === sized(r.description) ? LOOK_ALIKE_SCORE : JOIN_SCORE))) return o;
    }
    return null;
  });
}

/* ------------------------------------------------------------------------------------------------
 * Checking the AI against the numbers written on the drawing. A total the designer wrote in a note
 * (“พื้นที่รวมประมาณ 9,000 ตร.ม.”) is the figure to trust; the AI's row for the same work either
 * agrees with it, or the user is shown what the drawing says. Written totals the AI left out are
 * handed back so they can be added too.
 * ---------------------------------------------------------------------------------------------- */

export interface WrittenQty {
  description: string;
  kind: TakeoffKind;
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
  kind: TakeoffKind;
  unit: string;
  qty: number;
  scope?: string;
}

export function checkAgainstDrawing(rows: Checkable[], written: WrittenQty[]): { checks: (DrawingCheck | null)[]; missing: WrittenQty[] } {
  const same = (r: Checkable, w: WrittenQty) => r.kind === w.kind && unitKey(r.unit) === unitKey(w.unit);
  const used = new Set<WrittenQty>();
  const checks = rows.map((r): DrawingCheck | null => {
    const hit = written.find((w) => same(r, w) && sameQty(r.qty, w.qty) && ((w.qty >= SURE_QTY && sizesFit(r.description, w.description)) || sameName(r.description, w.description)));
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
  kind: TakeoffKind;
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
      const hit = existing.find((e) => !used.has(e) && same(r, e) && (byName ? sameName(r.description, e.description) : e.qty >= SURE_QTY && sizesFit(r.description, e.description)));
      if (hit) {
        out[i] = hit;
        used.add(hit);
      }
    });
  }
  return out;
}

/** One row per sheet again, for a join the user does not agree with: each sheet keeps its own quantity */
export function splitAcrossPages<T extends Input & { key: string; pages: number[] }>(row: T): T[] {
  return row.pages.map((p, i) => ({ ...row, key: i === 0 ? row.key : `${row.key}-p${p}`, page: p, pages: [p], apart: true }));
}
