import { distance, polygonArea, type Measurement, type PageScale, type Point, type TakeoffKind } from './boq-takeoff';

/**
 * Automatic take-off without AI: a CAD drawing printed to PDF still holds its lines, shapes and text
 * as vectors. They are read in the browser (see lib/pdf-vectors) and grouped here the way CAD layers
 * usually show on paper, so the user can name a group (“red 0.5 mm lines = brick wall”) and get every
 * line, shape or symbol of it on every page as measurements in one click.
 *
 * All coordinates are PDF page units at zoom 1 (y down), the same space as take-off measurements.
 */

export interface VectorPath {
  /** Each subpath as points; curves already flattened */
  subpaths: { points: Point[]; closed: boolean }[];
  stroke: boolean;
  fill: boolean;
  /** #rrggbb */
  strokeColor: string;
  fillColor: string;
  /** Line width in page units */
  lineWidth: number;
}

export interface VectorText {
  str: string;
  /** Roughly the middle of the text */
  at: Point;
}

export interface PageVectors {
  page: number;
  width: number;
  height: number;
  paths: VectorPath[];
  texts: VectorText[];
  /** Paths left out because the page had too many to read */
  truncated: boolean;
  /** Read from a scanned image (domain/raster-takeoff), so lines are all black and less exact */
  scanned?: boolean;
}

export type AutoGroupType = 'line' | 'shape' | 'symbol' | 'tag';

export interface AutoGroup {
  key: string;
  type: AutoGroupType;
  kind: TakeoffKind;
  /** What the group is, for people: “เส้นสีแดง หนา 0.50 มม.” */
  label: string;
  color: string;
  /** Per page: polylines (line), outlines (shape) or spots (symbol, tag) */
  pages: Map<number, Point[][]>;
  /** How many lines, shapes or symbols, over all pages */
  count: number;
}

/** A symbol on paper is at most this big (36 pt = 12.7 mm) */
export const SYMBOL_MAX = 36;
/** Shorter than this (0.5 pt ≈ 0.18 mm) is drawing noise, not a line */
const MIN_SEGMENT = 0.5;
/** Endpoints this close (in page units) are the same point when joining lines */
const JOIN_EPS = 0.05;

const r1 = (n: number) => Math.round(n * 10) / 10;
const ptToMm = (pt: number) => (pt * 25.4) / 72;

export function pathBounds(path: VectorPath) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of path.subpaths)
    for (const [x, y] of s.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

const COLOR_NAMES: [string, [number, number, number]][] = [
  ['ดำ', [0, 0, 0]],
  ['เทา', [128, 128, 128]],
  ['แดง', [220, 30, 30]],
  ['เขียว', [30, 160, 60]],
  ['น้ำเงิน', [30, 60, 220]],
  ['ฟ้า', [40, 180, 230]],
  ['เหลือง', [230, 200, 20]],
  ['ส้ม', [240, 130, 20]],
  ['ม่วง', [150, 50, 200]],
  ['ชมพู', [240, 80, 180]],
  ['น้ำตาล', [140, 80, 30]],
];

/** Nearest everyday colour name, so a group reads “สีแดง” and not “#e3261f” */
export function colorName(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 'ไม่ทราบสี';
  const [r, g, b] = [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
  if (r > 235 && g > 235 && b > 235) return 'ขาว';
  let best = COLOR_NAMES[0]!;
  let bestD = Infinity;
  for (const c of COLOR_NAMES) {
    const d = (c[1][0] - r) ** 2 + (c[1][1] - g) ** 2 + (c[1][2] - b) ** 2;
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best[0];
}

/** Joins segments that share endpoints into polylines; the same segment drawn twice counts once */
export function chainSegments(segments: [Point, Point][]): Point[][] {
  const key = (p: Point) => `${Math.round(p[0] / JOIN_EPS)},${Math.round(p[1] / JOIN_EPS)}`;
  const seen = new Set<string>();
  const segs: [Point, Point][] = [];
  for (const [a, b] of segments) {
    if (distance(a, b) < MIN_SEGMENT) continue;
    const ka = key(a),
      kb = key(b);
    const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (seen.has(id)) continue;
    seen.add(id);
    segs.push([a, b]);
  }
  const at = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const k of [key(a), key(b)]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const next = (p: Point): [Point, number] | null => {
    for (const i of at.get(key(p)) ?? []) {
      if (used[i]) continue;
      const [a, b] = segs[i]!;
      return [key(a) === key(p) ? b : a, i];
    }
    return null;
  };
  const lines: Point[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line: Point[] = [segs[i]![0], segs[i]![1]];
    for (let n = next(line[line.length - 1]!); n; n = next(line[line.length - 1]!)) {
      used[n[1]] = 1;
      line.push(n[0]);
    }
    for (let n = next(line[0]!); n; n = next(line[0]!)) {
      used[n[1]] = 1;
      line.unshift(n[0]);
    }
    lines.push(line);
  }
  return lines;
}

/** Short text that names a thing on the drawing: D1, W2, SW-1, C1A, FL01 … (not dimensions or notes) */
export const isTag = (s: string) => /^[A-Z]{1,3}[-.]?\d{1,3}[A-Z]?$/.test(s.trim());

/** The scale written on the sheet most often, e.g. “SCALE 1:100” → 100 */
export function scaleFromText(texts: VectorText[]): number | null {
  const counts = new Map<number, number>();
  const joined = texts.map((t) => t.str).join(' ');
  for (const m of joined.matchAll(/1\s*[:/]\s*(\d{2,5})(?!\d)/g)) {
    const n = Number(m[1]);
    if (n >= 10 && n <= 10000) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [n, c] of counts) if (best === null || c > counts.get(best)!) best = n;
  return best;
}

function add(groups: Map<string, AutoGroup>, g: Omit<AutoGroup, 'pages' | 'count'>, page: number, items: Point[][]) {
  if (items.length === 0) return;
  let group = groups.get(g.key);
  if (!group) groups.set(g.key, (group = { ...g, pages: new Map(), count: 0 }));
  const list = group.pages.get(page);
  if (list) list.push(...items);
  else group.pages.set(page, [...items]);
  group.count += items.length;
}

/** Everything on the pages, grouped. Groups with nothing worth measuring are left out. */
export function groupVectors(pages: PageVectors[]): AutoGroup[] {
  const groups = new Map<string, AutoGroup>();
  for (const pg of pages) {
    const lineSegs = new Map<string, { color: string; width: number; segs: [Point, Point][] }>();
    // The sheet border and title block frame are as big as the page; they are not work
    const sheetSize = Math.min(pg.width, pg.height) * 0.6;
    for (const path of pg.paths) {
      const b = pathBounds(path);
      if (!Number.isFinite(b.w)) continue;
      const small = Math.max(b.w, b.h) <= SYMBOL_MAX && Math.max(b.w, b.h) >= 1;
      const curved = path.subpaths.some((s) => s.points.length > 5);
      const closed = path.subpaths.some((s) => s.closed);
      if (small && (closed || curved)) {
        // A symbol: same size and look = same symbol
        const color = path.stroke ? path.strokeColor : path.fillColor;
        const sig = `${r1(b.w)}x${r1(b.h)}|${path.subpaths.length}|${path.subpaths.reduce((n, s) => n + s.points.length, 0)}|${color}|${path.fill ? 'f' : 's'}`;
        add(
          groups,
          { key: `symbol:${sig}`, type: 'symbol', kind: 'count', label: `สัญลักษณ์${path.fill ? 'ทึบ' : ''} ขนาด ${ptToMm(b.w).toFixed(1)}×${ptToMm(b.h).toFixed(1)} มม. สี${colorName(color)}`, color },
          pg.page,
          [[[(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]]],
        );
        continue;
      }
      if (path.fill) {
        const outlines = path.subpaths.filter((s) => s.closed || s.points.length >= 3).map((s) => s.points).filter((pts) => polygonArea(pts) > 4);
        const big = outlines.filter((pts) => {
          const xs = pts.map((p) => p[0]),
            ys = pts.map((p) => p[1]);
          return Math.max(...xs) - Math.min(...xs) < pg.width * 0.95 || Math.max(...ys) - Math.min(...ys) < pg.height * 0.95;
        });
        add(groups, { key: `shape:${path.fillColor}`, type: 'shape', kind: 'area', label: `พื้นที่ระบายสี${colorName(path.fillColor)}`, color: path.fillColor }, pg.page, big);
      }
      if (path.stroke) {
        if (Math.max(b.w, b.h) > sheetSize && path.subpaths.length === 1 && path.subpaths[0]!.closed) continue;
        const width = Math.round(ptToMm(path.lineWidth) * 100) / 100;
        const k = `${path.strokeColor}|${width}`;
        let entry = lineSegs.get(k);
        if (!entry) lineSegs.set(k, (entry = { color: path.strokeColor, width, segs: [] }));
        for (const s of path.subpaths) {
          for (let i = 1; i < s.points.length; i++) entry.segs.push([s.points[i - 1]!, s.points[i]!]);
          if (s.closed && s.points.length > 2) entry.segs.push([s.points[s.points.length - 1]!, s.points[0]!]);
        }
      }
    }
    for (const [k, e] of lineSegs) {
      add(
        groups,
        { key: `line:${k}`, type: 'line', kind: 'length', label: `เส้นสี${colorName(e.color)} หนา ${e.width.toFixed(2)} มม.`, color: e.color },
        pg.page,
        chainSegments(e.segs),
      );
    }
    for (const t of pg.texts) {
      const s = t.str.trim();
      if (!isTag(s)) continue;
      add(groups, { key: `tag:${s}`, type: 'tag', kind: 'count', label: `ป้าย “${s}”`, color: '#0f172a' }, pg.page, [[t.at]]);
    }
  }
  return [...groups.values()];
}

/** Length (m) or area (m²) of a group on the pages that have a scale; count for symbols and tags */
export function groupQuantity(g: AutoGroup, scales: Record<string, PageScale>): { qty: number; unscaledPages: number[] } {
  let qty = 0;
  const unscaledPages: number[] = [];
  for (const [page, items] of g.pages) {
    if (g.kind === 'count') {
      qty += items.length;
      continue;
    }
    const s = scales[String(page)];
    if (!s) {
      unscaledPages.push(page);
      continue;
    }
    for (const pts of items) {
      if (g.kind === 'length') for (let i = 1; i < pts.length; i++) qty += distance(pts[i - 1]!, pts[i]!) * s.metersPerUnit;
      else qty += polygonArea(pts) * s.metersPerUnit ** 2;
    }
  }
  return { qty, unscaledPages };
}

/** Most points one measurement may hold (same limit as a saved take-off) */
const MAX_POINTS = 5000;

/** The group as take-off measurements of one item: polylines, outlines, or one count per page */
export function groupToMeasurements(g: AutoGroup, itemId: string, newId: () => string): Measurement[] {
  const out: Measurement[] = [];
  const round = (p: Point): Point => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
  for (const [page, items] of g.pages) {
    if (g.kind === 'count') {
      const spots = items.map((i) => round(i[0]!));
      for (let i = 0; i < spots.length; i += MAX_POINTS) out.push({ id: newId(), itemId, page, points: spots.slice(i, i + MAX_POINTS) });
      continue;
    }
    for (const pts of items) {
      // A very long polyline is split; for lines the split point is repeated so no length is lost
      for (let i = 0; i < pts.length; i += MAX_POINTS - 1) {
        const part = pts.slice(i, i + MAX_POINTS).map(round);
        if (part.length >= (g.kind === 'length' ? 2 : 3)) out.push({ id: newId(), itemId, page, points: part });
        if (g.kind === 'area') break;
      }
    }
  }
  return out;
}

/** How many measurements a group becomes, to check against the take-off's limit before adding */
export function measurementCountOf(g: AutoGroup): number {
  let n = 0;
  for (const items of g.pages.values()) {
    if (g.kind === 'count') n += Math.ceil(items.length / MAX_POINTS);
    else n += items.reduce((s, pts) => s + (g.kind === 'area' ? 1 : Math.max(1, Math.ceil((pts.length - 1) / (MAX_POINTS - 1)))), 0);
  }
  return n;
}

// ───────────────────────────── Name suggestions ─────────────────────────────

export interface NameSuggestion {
  description: string;
  unit: string;
  /** Why the name was suggested, shown under it */
  reason: string;
  /** Symbols that are the legend's sample, not work on the drawing: left out of the count */
  legend?: { page: number; at: Point }[];
}

/** Usual Thai drawing tags: letter prefix → BOQ wording and unit */
const TAG_PREFIXES: [RegExp, string, string][] = [
  [/^SD/, 'ประตูบานเลื่อน', 'ชุด'],
  [/^SW/, 'หน้าต่างบานเลื่อน', 'ชุด'],
  [/^DW/, 'ประตูหน้าต่าง', 'ชุด'],
  [/^D/, 'ประตู', 'ชุด'],
  [/^W/, 'หน้าต่าง', 'ชุด'],
  [/^GB/, 'คานคอดิน', 'ต้น'],
  [/^RB/, 'คานหลังคา', 'ต้น'],
  [/^B/, 'คาน', 'ต้น'],
  [/^C/, 'เสา', 'ต้น'],
  [/^F/, 'ฐานราก', 'ฐาน'],
  [/^P/, 'เสาเข็ม', 'ต้น'],
  [/^ST/, 'บันได', 'ชุด'],
  [/^S/, 'พื้น', 'แผ่น'],
];

/** Text that names something: has letters, is not a dimension, tag, scale or sheet code */
const isName = (s: string) => {
  const t = s.trim();
  return t.length >= 3 && t.length <= 60 && /[A-Za-zก-๙]/.test(t) && !isTag(t) && !/^\d|1\s*:\s*\d/.test(t) && !/^(SCALE|มาตราส่วน|A[0-4])$/i.test(t);
};

/**
 * Names the system can guess without asking: tags by their prefix (D1 → ประตู D1), symbols by the
 * text written next to them (usually the legend or a label), and the thickest long lines as walls.
 */
export function suggestNames(groups: AutoGroup[], pages: PageVectors[]): Map<string, NameSuggestion> {
  const out = new Map<string, NameSuggestion>();
  const textsByPage = new Map(pages.map((p) => [p.page, p.texts.filter((t) => isName(t.str))]));

  for (const g of groups) {
    if (g.type === 'tag') {
      const tag = g.label.replace(/^ป้าย “|”$/g, '');
      const hit = TAG_PREFIXES.find(([re]) => re.test(tag));
      if (hit) out.set(g.key, { description: `${hit[1]} ${tag}`, unit: hit[2], reason: `ป้าย ${tag} บนแบบ` });
    } else if (g.type === 'symbol') {
      // Text just to the right of (or under) an instance of the symbol, most often seen
      const votes = new Map<string, { page: number; at: Point }[]>();
      for (const [page, items] of g.pages) {
        const texts = textsByPage.get(page) ?? [];
        for (const [at] of items) {
          for (const t of texts) {
            const dx = t.at[0] - at![0],
              dy = Math.abs(t.at[1] - at![1]);
            if (dx > 0 && dx < 120 && dy < 10) {
              const k = t.str.trim();
              votes.set(k, [...(votes.get(k) ?? []), { page, at: at! }]);
            }
          }
        }
      }
      let best: [string, { page: number; at: Point }[]] | null = null;
      for (const v of votes) if (!best || v[1].length > best[1].length) best = v;
      if (best) {
        // Named at only a few of its places: those are the legend's samples. Named at most: labels on each.
        const legend = best[1].length * 2 < g.count ? best[1] : undefined;
        out.set(g.key, { description: best[0], unit: 'จุด', reason: legend ? 'ชื่อจากตารางสัญลักษณ์บนแบบ (ไม่นับตัวอย่างในตาราง)' : 'ข้อความข้างสัญลักษณ์บนแบบ', legend });
      }
    }
  }

  // Walls: the thickest line group that is also long (not a short heavy mark). On scans every line
  // is black and widths are rough, so the guess is left to the user there.
  const scanned = new Set(pages.filter((p) => p.scanned).map((p) => p.page));
  const lines = groups.filter((g) => g.type === 'line' && [...g.pages.keys()].some((n) => !scanned.has(n)));
  const width = (g: AutoGroup) => Number(/หนา ([\d.]+)/.exec(g.label)?.[1] ?? 0);
  const lengthUnits = (g: AutoGroup) => {
    let n = 0;
    for (const items of g.pages.values()) for (const pts of items) for (let i = 1; i < pts.length; i++) n += distance(pts[i - 1]!, pts[i]!);
    return n;
  };
  const longest = Math.max(0, ...lines.map(lengthUnits));
  const walls = lines.filter((g) => lengthUnits(g) >= longest * 0.2).sort((a, b) => width(b) - width(a))[0];
  if (walls && lines.length > 1) out.set(walls.key, { description: 'ผนัง', unit: 'ม.', reason: 'เส้นหนาที่สุดในแบบ มักเป็นเส้นผนัง' });
  return out;
}

/** The group without its legend samples, so the count is only the work on the drawing */
export function withoutLegend(g: AutoGroup, sug: NameSuggestion | undefined): AutoGroup {
  if (!sug?.legend?.length) return g;
  const drop = new Set(sug.legend.map((l) => `${l.page}|${l.at[0]}|${l.at[1]}`));
  const pages = new Map<number, Point[][]>();
  let count = 0;
  for (const [page, items] of g.pages) {
    const kept = items.filter(([at]) => !drop.has(`${page}|${at![0]}|${at![1]}`));
    if (kept.length) pages.set(page, kept);
    count += kept.length;
  }
  return { ...g, pages, count };
}
