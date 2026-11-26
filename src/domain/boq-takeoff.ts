import { z } from 'zod';
import { D, round2 } from './money';

/**
 * Quantity take-off on a CAD drawing printed to PDF.
 *
 * Points are kept in PDF page units at zoom 1 (1 unit = 1 pt = 1/72 inch on paper), so they stay put
 * whatever zoom the drawing is viewed at. A page's scale turns those units into metres.
 */

export type TakeoffKind = 'length' | 'area' | 'count' | 'volume';

export const TAKEOFF_KINDS: { kind: TakeoffKind; label: string; unit: string }[] = [
  { kind: 'length', label: 'วัดระยะ', unit: 'ม.' },
  { kind: 'area', label: 'วัดพื้นที่', unit: 'ตร.ม.' },
  { kind: 'count', label: 'นับจำนวน', unit: 'จุด' },
  // Measured as an outline on the plan; the item's factor is the depth (slab thickness, excavation depth)
  { kind: 'volume', label: 'วัดปริมาตร', unit: 'ลบ.ม.' },
];

/** The zoomed quarters of a sheet sent to the AI take-off along with the whole sheet */
export const TILE_NAMES = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;
export type TileName = (typeof TILE_NAMES)[number];

/** Kinds measured by drawing a closed outline on the plan */
export const isOutlineKind = (kind: TakeoffKind) => kind === 'area' || kind === 'volume';

export const kindLabel = (kind: TakeoffKind) => TAKEOFF_KINDS.find((k) => k.kind === kind)!.label;
export const defaultUnitOf = (kind: TakeoffKind) => TAKEOFF_KINDS.find((k) => k.kind === kind)!.unit;

export type Point = [number, number];

export interface PageScale {
  /** Metres in the real building for one PDF unit on the page */
  metersPerUnit: number;
  /** What the user set, shown back to them, e.g. "1:100" or "วัดเทียบ 5.00 ม." */
  label: string;
}

export interface TakeoffItem {
  id: string;
  /** BOQ category heading the item goes under, e.g. งานสถาปัตยกรรม */
  category: string;
  description: string;
  kind: TakeoffKind;
  unit: string;
  /**
   * Multiplies what was measured: wall height turns a wall length into wall area, a layer thickness
   * turns an area into volume, bars per point turn a count into pieces
   */
  factor: number;
  /** Allowance for waste, in percent */
  wastePercent: number;
  materialRate: number | '';
  laborRate: number | '';
  color: string;
  note: string;
  /**
   * A quantity read straight off the drawing (by the AI take-off or typed in), in the item's base
   * measure before factor and waste. Measurements on the drawing are added on top of it.
   */
  fixedQty?: number;
  /**
   * An item worked out from another item's measurements, the way Archicad gives one wall its area,
   * both plaster faces and its volume: the wall is measured once and each line takes it with its own
   * factor. One level only; the source is never itself derived.
   */
  sourceItemId?: string;
  /** Area measurements: take the outline's perimeter instead of its area (slab edge formwork, skirting) */
  basis?: 'perimeter';
  /**
   * Taken off after the factor, in the item's own unit: the openings in a wall, given as an area once
   * rather than outlined one by one
   */
  deductQty?: number;
}

export interface Measurement {
  id: string;
  itemId: string;
  /** 1-based page number */
  page: number;
  /** For length: the polyline. For area: the outline. For count: each counted spot. */
  points: Point[];
  /** Area only: an opening (door, window, void) taken off the item's area */
  deduct?: boolean;
}

export interface TakeoffData {
  version: 1;
  /** Keyed by page number */
  scales: Record<string, PageScale>;
  items: TakeoffItem[];
  measurements: Measurement[];
}

export const emptyTakeoffData = (): TakeoffData => ({ version: 1, scales: {}, items: [], measurements: [] });

/** One PDF unit on paper, in metres (1/72 inch) */
export const PAPER_METERS_PER_UNIT = 0.0254 / 72;

/** Scale for a drawing printed at its true paper scale, e.g. 1:100 */
export const scaleFromRatio = (ratio: number): PageScale => ({
  metersPerUnit: PAPER_METERS_PER_UNIT * ratio,
  label: `1:${ratio}`,
});

/** Scale from a line on the drawing whose real length is known */
export function scaleFromCalibration(a: Point, b: Point, realMeters: number): PageScale | null {
  const units = distance(a, b);
  if (!(units > 0) || !(realMeters > 0)) return null;
  return { metersPerUnit: realMeters / units, label: `วัดเทียบ ${realMeters.toLocaleString('th-TH', { maximumFractionDigits: 3 })} ม.` };
}

export const COMMON_RATIOS = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000];

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/** Shoelace formula; the outline closes itself */
export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

/**
 * What one measurement adds to its item, in metres, square metres or points, before the item's
 * factor and waste. A deducted opening counts negative. Null when its page has no scale yet.
 */
export function measuredValue(m: Measurement, kind: TakeoffKind, scale: PageScale | undefined): number | null {
  if (kind === 'count') return m.points.length;
  if (!scale) return null;
  if (kind === 'length') return polylineLength(m.points) * scale.metersPerUnit;
  // area and volume: the outline's area; a volume item's factor holds the depth
  const area = polygonArea(m.points) * scale.metersPerUnit ** 2;
  return m.deduct ? -area : area;
}

export interface ItemQuantity {
  /** Sum of what was measured, before factor and waste */
  measured: number;
  /** measured × factor × (1 + waste%), rounded to 3 places as stored in the BOQ */
  qty: number;
  measurementCount: number;
  /** Measurements on pages that still have no scale, so they are not counted yet */
  unscaled: number;
}

/** Perimeter of an outline in metres; an opening's outline is not part of the edge */
export function measuredPerimeter(m: Measurement, scale: PageScale | undefined): number | null {
  if (m.deduct) return 0;
  if (!scale) return null;
  const closed = m.points.length >= 3 ? [...m.points, m.points[0]!] : m.points;
  return polylineLength(closed) * scale.metersPerUnit;
}

export function itemQuantity(item: TakeoffItem, data: TakeoffData): ItemQuantity {
  let measured = D(0);
  let measurementCount = 0;
  let unscaled = 0;
  const source = item.sourceItemId ? data.items.find((i) => i.id === item.sourceItemId && !i.sourceItemId) : undefined;
  const perimeter = item.basis === 'perimeter';
  // An outline's perimeter cannot be had from a typed-in area, so a perimeter line leaves it out
  for (const from of source ? [source, item] : [item]) {
    if (from.fixedQty && !(perimeter && isOutlineKind(from.kind))) measured = measured.plus(from.fixedQty);
    for (const m of data.measurements) {
      if (m.itemId !== from.id) continue;
      measurementCount++;
      const scale = data.scales[String(m.page)];
      const v = perimeter && isOutlineKind(from.kind) ? measuredPerimeter(m, scale) : measuredValue(m, from.kind, scale);
      if (v === null) unscaled++;
      else measured = measured.plus(v);
    }
  }
  const qty = measured
    .times(item.factor)
    .minus(item.deductQty ?? 0)
    .times(D(100).plus(item.wastePercent).div(100))
    .toDecimalPlaces(3);
  return { measured: measured.toNumber(), qty: Decimal3(qty.toNumber()), measurementCount, unscaled };
}

// -0 shows as "-0.000"; a negative total (more openings than wall) is shown as it is so it gets noticed
const Decimal3 = (n: number) => (Object.is(n, -0) ? 0 : n);

/** Items in the order of their categories' first appearance, the way they will be written to the BOQ */
export function groupByCategory(items: TakeoffItem[]): { category: string; items: TakeoffItem[] }[] {
  const groups: { category: string; items: TakeoffItem[] }[] = [];
  for (const item of items) {
    const name = item.category.trim() || 'ไม่ระบุหมวด';
    let g = groups.find((x) => x.category === name);
    if (!g) groups.push((g = { category: name, items: [] }));
    g.items.push(item);
  }
  return groups;
}

/** A row ready for the project's BOQ sheet (same shape the BOQ editor saves) */
export interface TakeoffBoqLine {
  isCategory: boolean;
  isBold: boolean;
  no: string;
  description: string;
  qty: number | '';
  unit: string;
  materialRate: number | '';
  laborRate: number | '';
  note: string;
}

/**
 * The take-off as BOQ rows: a heading per category, then its items numbered 1.1, 1.2 …
 * Numbering starts after `firstCategoryNo - 1` so rows added under an existing BOQ continue its count.
 */
export function toBoqLines(data: TakeoffData, opts: { firstCategoryNo?: number; note?: string } = {}): TakeoffBoqLine[] {
  const start = opts.firstCategoryNo ?? 1;
  const rows: TakeoffBoqLine[] = [];
  groupByCategory(data.items).forEach((g, gi) => {
    const catNo = String(start + gi);
    rows.push({ isCategory: true, isBold: true, no: catNo, description: g.category, qty: '', unit: '', materialRate: '', laborRate: '', note: '' });
    g.items.forEach((item, ii) => {
      const { qty } = itemQuantity(item, data);
      const note = [item.note.trim(), opts.note ?? ''].filter(Boolean).join(' · ');
      rows.push({
        isCategory: false,
        isBold: false,
        no: `${catNo}.${ii + 1}`,
        description: item.description,
        qty: Math.max(0, qty),
        unit: item.unit,
        materialRate: item.materialRate === '' ? '' : round2(D(item.materialRate)).toNumber(),
        laborRate: item.laborRate === '' ? '' : round2(D(item.laborRate)).toNumber(),
        note: note.slice(0, 500),
      });
    });
  });
  return rows;
}

/** Amount of one item: qty × (material + labour) */
export function itemAmount(item: TakeoffItem, qty: number): number {
  const rate = D(item.materialRate === '' ? 0 : item.materialRate).plus(item.laborRate === '' ? 0 : item.laborRate);
  return round2(D(Math.max(0, qty)).times(rate)).toNumber();
}

export const ITEM_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'];

const MAX_AMOUNT = 1_000_000_000;
const finite = z.number().finite();
const pointSchema = z.tuple([finite.min(-1e6).max(1e6), finite.min(-1e6).max(1e6)]);

export const takeoffDataSchema = z.object({
  version: z.literal(1),
  scales: z.record(
    z.string().regex(/^\d{1,5}$/),
    z.object({ metersPerUnit: finite.positive().max(1e4), label: z.string().max(100) }),
  ),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        category: z.string().trim().max(200),
        description: z.string().trim().min(1, 'กรุณาใส่ชื่อรายการ').max(1000),
        kind: z.enum(['length', 'area', 'count', 'volume']),
        unit: z.string().trim().max(50),
        factor: finite.min(0).max(1e6),
        wastePercent: finite.min(0).max(1000),
        materialRate: z.union([finite.min(0).max(MAX_AMOUNT), z.literal('')]),
        laborRate: z.union([finite.min(0).max(MAX_AMOUNT), z.literal('')]),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        note: z.string().max(500),
        fixedQty: finite.min(-1e9).max(1e9).optional(),
        sourceItemId: z.string().min(1).max(64).optional(),
        basis: z.literal('perimeter').optional(),
        deductQty: finite.min(0).max(1e9).optional(),
      }),
    )
    .max(1000, 'รายการถอดแบบเกิน 1,000 รายการ'),
  measurements: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        itemId: z.string().min(1).max(64),
        page: z.number().int().min(1).max(99999),
        points: z.array(pointSchema).min(1).max(5000),
        deduct: z.boolean().optional(),
      }),
    )
    .max(20000, 'จำนวนการวัดเกิน 20,000 ครั้ง'),
}) satisfies z.ZodType<TakeoffData>;
