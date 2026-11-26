import type { TakeoffKind } from './boq-takeoff';

/**
 * Take-off from a CAD file saved as DXF (AutoCAD: Save As → DXF). A DXF holds the real geometry in
 * drawing units, so no scale is needed: every line, polyline, arc, hatch and block on the model
 * space is read, and grouped the way a drafter organises the drawing, by layer and by block:
 *
 * - lines, open polylines and arcs on a layer → total length (ม.)
 * - closed polylines, circles and hatches on a layer → total area (ตร.ม.) and perimeter
 * - each block inserted (door, window, light, socket, column…) → how many times (จุด)
 * - text → the quantities written in notes (domain/text-takeoff reads them)
 *
 * DWG is a closed binary format; it has to be saved as DXF first.
 */

export type DxfUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export const DXF_UNIT_METERS: Record<DxfUnit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
export const DXF_UNIT_LABEL: Record<DxfUnit, string> = { mm: 'มิลลิเมตร', cm: 'เซนติเมตร', m: 'เมตร', in: 'นิ้ว', ft: 'ฟุต' };
/** $INSUNITS codes */
const INSUNITS: Record<number, DxfUnit> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };

export interface DxfGroup {
  key: string;
  type: 'layer-length' | 'layer-area' | 'block';
  /** Layer or block name as the drafter wrote it */
  name: string;
  layer: string;
  kind: TakeoffKind;
  /** In metres / square metres / pieces */
  qty: number;
  /** Area groups: total perimeter in metres (edge formwork, skirting) */
  perimeter?: number;
  /** How many CAD objects made it up */
  objects: number;
}

export interface DxfReadResult {
  /** Units the file says it is drawn in, or null when it does not say */
  declaredUnit: DxfUnit | null;
  /** Raw sums in drawing units, before the unit is applied */
  raw: { key: string; type: DxfGroup['type']; name: string; layer: string; length: number; area: number; perimeter: number; count: number; objects: number }[];
  /** Text found in the drawing, one line per text object */
  texts: string[];
  /** Entities skipped because they sit inside a block or are not measurable */
  skipped: number;
}

type Pair = [number, string];

/** Thai letters in old DXF files come as \U+0E01 escapes or in the Windows-874 code page */
export function decodeDxf(bytes: ArrayBuffer): string {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 22));
  if (head.startsWith('AutoCAD Binary DXF')) throw new Error('BINARY_DXF');
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // AC1021 (AutoCAD 2007) and later are UTF-8; older files use the drawing's code page
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d{4})/.exec(utf8.slice(0, 5000));
  const text = ver && Number(ver[1]) < 1021 && /ANSI_874/i.test(utf8.slice(0, 20000)) ? new TextDecoder('windows-874').decode(bytes) : utf8;
  return text.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isFinite(code)) {
      // A stray blank line shifts the pairs; step one line to get back in step
      i -= 1;
      continue;
    }
    out.push([code, lines[i + 1]!]);
  }
  return out;
}

interface Entity {
  type: string;
  pairs: Pair[];
}

/** Entities of a section, each with its own group codes; POLYLINE keeps its VERTEX rows */
function sectionEntities(all: Pair[], name: string): Entity[] {
  let i = 0;
  while (i < all.length && !(all[i]![0] === 2 && all[i]![1].trim() === name && all[i - 1]?.[1].trim() === 'SECTION')) i++;
  const out: Entity[] = [];
  let cur: Entity | null = null;
  for (i++; i < all.length; i++) {
    const [code, raw] = all[i]!;
    const v = raw.trim();
    if (code === 0 && v === 'ENDSEC') break;
    if (code === 0) {
      if (cur && cur.type === 'POLYLINE' && (v === 'VERTEX' || v === 'SEQEND')) {
        cur.pairs.push([0, v]);
        if (v === 'SEQEND') cur = null;
        continue;
      }
      cur = { type: v, pairs: [] };
      out.push(cur);
      continue;
    }
    cur?.pairs.push([code, raw]);
  }
  return out;
}

const num = (s: string | undefined) => {
  const n = Number((s ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};
const first = (e: Entity, code: number) => e.pairs.find((p) => p[0] === code)?.[1];

type Pt = { x: number; y: number; bulge: number };

/** A polyline segment with a bulge is an arc: its length and the area it adds beyond the chord */
function bulgeArc(a: Pt, b: Pt): { length: number; segArea: number } {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!a.bulge || chord === 0) return { length: chord, segArea: 0 };
  const theta = 4 * Math.atan(Math.abs(a.bulge));
  const r = chord / (2 * Math.sin(theta / 2));
  const segArea = (r * r * (theta - Math.sin(theta))) / 2;
  return { length: r * theta, segArea: Math.sign(a.bulge) * segArea };
}

function polyMeasure(pts: Pt[], closed: boolean): { length: number; area: number } {
  let length = 0;
  let twice = 0;
  let arcs = 0;
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const { length: l, segArea } = bulgeArc(a, b);
    length += l;
    twice += a.x * b.y - b.x * a.y;
    arcs += segArea;
  }
  // Shoelace sign tells the winding; a bulge to the left adds area on a counter-clockwise outline
  const signed = twice / 2;
  const area = closed ? Math.abs(signed + (signed >= 0 ? arcs : -arcs)) : 0;
  return { length, area };
}

function lwPolyline(e: Entity): { pts: Pt[]; closed: boolean } {
  const pts: Pt[] = [];
  for (const [code, v] of e.pairs) {
    if (code === 10) pts.push({ x: num(v), y: 0, bulge: 0 });
    else if (code === 20 && pts.length) pts[pts.length - 1]!.y = num(v);
    else if (code === 42 && pts.length) pts[pts.length - 1]!.bulge = num(v);
  }
  return { pts, closed: (num(first(e, 70)) & 1) === 1 };
}

function oldPolyline(e: Entity): { pts: Pt[]; closed: boolean } {
  const pts: Pt[] = [];
  let inVertex = false;
  // Flags before the first VERTEX belong to the polyline itself
  let flags = 0;
  for (const [code, v] of e.pairs) {
    if (code === 0) {
      inVertex = v === 'VERTEX';
      if (inVertex) pts.push({ x: 0, y: 0, bulge: 0 });
      continue;
    }
    if (!inVertex) {
      if (code === 70) flags = num(v);
      continue;
    }
    const p = pts[pts.length - 1]!;
    if (code === 10) p.x = num(v);
    else if (code === 20) p.y = num(v);
    else if (code === 42) p.bulge = num(v);
  }
  // 3D meshes and polyface meshes are not outlines
  if (flags & (16 | 64)) return { pts: [], closed: false };
  return { pts, closed: (flags & 1) === 1 };
}

const arcSweep = (startDeg: number, endDeg: number) => {
  let d = endDeg - startDeg;
  while (d <= 0) d += 360;
  return (d * Math.PI) / 180;
};

/** Outline paths of a hatch; arcs and ellipse edges are walked in small steps */
function hatchArea(e: Entity): { area: number; perimeter: number } {
  const outlines: { area: number; length: number; box: [number, number, number, number] }[] = [];
  const p = e.pairs;
  let i = p.findIndex((x) => x[0] === 91);
  if (i < 0) return { area: 0, perimeter: 0 };
  const paths = num(p[i]![1]);
  i++;
  for (let k = 0; k < paths && i < p.length; k++) {
    while (i < p.length && p[i]![0] !== 92) i++;
    if (i >= p.length) break;
    const flags = num(p[i]![1]);
    i++;
    const pts: Pt[] = [];
    if (flags & 2) {
      // Polyline path: 72 has-bulge, 73 closed, 93 vertex count, then 10/20(/42)
      let hasBulge = false;
      let count = 0;
      for (; i < p.length; i++) {
        const [c, v] = p[i]!;
        if (c === 72) hasBulge = num(v) === 1;
        else if (c === 93) {
          count = num(v);
          i++;
          break;
        }
      }
      for (; i < p.length && pts.length <= count; i++) {
        const [c, v] = p[i]!;
        if (c === 10) {
          if (pts.length === count) break;
          pts.push({ x: num(v), y: 0, bulge: 0 });
        } else if (c === 20 && pts.length) pts[pts.length - 1]!.y = num(v);
        else if (c === 42 && hasBulge && pts.length) pts[pts.length - 1]!.bulge = num(v);
        else if (c === 97 || c === 92) break;
      }
    } else {
      // Edge path: 93 edge count, then each edge by its type (72)
      while (i < p.length && p[i]![0] !== 93) i++;
      const edges = num(p[i]?.[1]);
      i++;
      for (let ed = 0; ed < edges && i < p.length; ed++) {
        while (i < p.length && p[i]![0] !== 72) i++;
        const t = num(p[i]?.[1]);
        i++;
        const vals: Record<number, number[]> = {};
        for (; i < p.length && p[i]![0] !== 72 && p[i]![0] !== 97 && p[i]![0] !== 92; i++) (vals[p[i]![0]] ??= []).push(num(p[i]![1]));
        if (t === 1) {
          pts.push({ x: vals[10]?.[0] ?? 0, y: vals[20]?.[0] ?? 0, bulge: 0 });
        } else if (t === 2) {
          const cx = vals[10]?.[0] ?? 0;
          const cy = vals[20]?.[0] ?? 0;
          const r = vals[40]?.[0] ?? 0;
          const ccw = (vals[73]?.[0] ?? 1) === 1;
          let a0 = vals[50]?.[0] ?? 0;
          let a1 = vals[51]?.[0] ?? 0;
          if (!ccw) [a0, a1] = [-a0, -a1];
          const sweep = arcSweep(a0, a1);
          const steps = Math.max(4, Math.ceil((sweep / (2 * Math.PI)) * 48));
          for (let s = 0; s < steps; s++) {
            const ang = (a0 * Math.PI) / 180 + (sweep * s) / steps;
            pts.push({ x: cx + r * Math.cos(ang), y: cy + (ccw ? 1 : -1) * r * Math.sin(ang), bulge: 0 });
          }
        } else if (t === 3) {
          // Ellipse edge: centre, major axis end, minor/major ratio, angles
          const cx = vals[10]?.[0] ?? 0;
          const cy = vals[20]?.[0] ?? 0;
          const mx = vals[11]?.[0] ?? 0;
          const my = vals[21]?.[0] ?? 0;
          const ratio = vals[40]?.[0] ?? 1;
          const a0 = ((vals[50]?.[0] ?? 0) * Math.PI) / 180;
          const a1 = ((vals[51]?.[0] ?? 360) * Math.PI) / 180;
          const sweep = a1 > a0 ? a1 - a0 : a1 - a0 + 2 * Math.PI;
          const rot = Math.atan2(my, mx);
          const ra = Math.hypot(mx, my);
          const rb = ra * ratio;
          for (let s = 0; s < 48; s++) {
            const t2 = a0 + (sweep * s) / 48;
            const ex = ra * Math.cos(t2);
            const ey = rb * Math.sin(t2);
            pts.push({ x: cx + ex * Math.cos(rot) - ey * Math.sin(rot), y: cy + ex * Math.sin(rot) + ey * Math.cos(rot), bulge: 0 });
          }
        } else if (t === 4) {
          // Spline edge: its control points are close enough for a quantity
          const xs = vals[10] ?? [];
          const ys = vals[20] ?? [];
          xs.forEach((x, j) => pts.push({ x, y: ys[j] ?? 0, bulge: 0 }));
        }
      }
    }
    if (pts.length >= 3) {
      const m = polyMeasure(pts, true);
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      outlines.push({ area: m.area, length: m.length, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
  }
  // An outline inside another is an island: inside one outline it is a hole, inside two it is filled again
  const inside = (a: (typeof outlines)[number], b: (typeof outlines)[number]) =>
    b.area > a.area && a.box[0] >= b.box[0] && a.box[1] >= b.box[1] && a.box[2] <= b.box[2] && a.box[3] <= b.box[3];
  let area = 0;
  let perimeter = 0;
  for (const o of outlines) {
    const depth = outlines.filter((b) => b !== o && inside(o, b)).length;
    area += depth % 2 === 0 ? o.area : -o.area;
    perimeter += o.length;
  }
  return { area: Math.max(0, area), perimeter };
}

/** Layers that hold annotation, not work */
const NOTE_LAYER = /^(defpoints|0-?dim|dim|dims|dimension|text|txt|anno|note|title|border|frame|viewport|vport|grid|axis|center|centre|hatch-?txt|ข้อความ|ตัวหนังสือ|กรอบ)/i;
export const isNoteLayer = (layer: string) => NOTE_LAYER.test(layer.trim());

/** Reads the model space of a DXF into sums per layer and per block, in drawing units */
export function readDxf(text: string): DxfReadResult {
  const all = pairs(text);
  let declaredUnit: DxfUnit | null = null;
  // The header is one long list of variables; $INSUNITS is followed by its 70 code
  const hi = all.findIndex((p) => p[0] === 9 && p[1].trim() === '$INSUNITS');
  if (hi >= 0) declaredUnit = INSUNITS[num(all[hi + 1]?.[1])] ?? null;

  const groups = new Map<string, DxfReadResult['raw'][number]>();
  const add = (type: DxfGroup['type'], name: string, layer: string, v: { length?: number; area?: number; perimeter?: number; count?: number }) => {
    const key = `${type}:${type === 'block' ? name : layer}`;
    const g = groups.get(key) ?? { key, type, name, layer, length: 0, area: 0, perimeter: 0, count: 0, objects: 0 };
    g.length += v.length ?? 0;
    g.area += v.area ?? 0;
    g.perimeter += v.perimeter ?? 0;
    g.count += v.count ?? 0;
    g.objects++;
    groups.set(key, g);
  };

  const texts: string[] = [];
  let skipped = 0;
  for (const e of sectionEntities(all, 'ENTITIES')) {
    // Paper space (layouts, title blocks) is not the building
    if (num(first(e, 67)) === 1) {
      skipped++;
      continue;
    }
    const layer = (first(e, 8) ?? '0').trim() || '0';
    switch (e.type) {
      case 'LINE': {
        const l = Math.hypot(num(first(e, 11)) - num(first(e, 10)), num(first(e, 21)) - num(first(e, 20)));
        if (l > 0) add('layer-length', layer, layer, { length: l });
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const { pts, closed } = e.type === 'LWPOLYLINE' ? lwPolyline(e) : oldPolyline(e);
        if (pts.length < 2) break;
        const m = polyMeasure(pts, closed);
        if (closed && m.area > 0) add('layer-area', layer, layer, { area: m.area, perimeter: m.length });
        else add('layer-length', layer, layer, { length: m.length });
        break;
      }
      case 'ARC': {
        const r = num(first(e, 40));
        const l = r * arcSweep(num(first(e, 50)), num(first(e, 51)));
        if (l > 0) add('layer-length', layer, layer, { length: l });
        break;
      }
      case 'CIRCLE': {
        const r = num(first(e, 40));
        if (r > 0) add('layer-area', layer, layer, { area: Math.PI * r * r, perimeter: 2 * Math.PI * r });
        break;
      }
      case 'HATCH': {
        const h = hatchArea(e);
        if (h.area > 0) add('layer-area', `${layer}`, layer, { area: h.area, perimeter: h.perimeter });
        break;
      }
      case 'INSERT': {
        const name = (first(e, 2) ?? '').trim();
        // Anonymous blocks (*U12, *D3) are dimensions and dynamic copies, not things to count
        if (!name || name.startsWith('*')) {
          skipped++;
          break;
        }
        // Arrays: 70 columns × 71 rows
        const n = Math.max(1, num(first(e, 70))) * Math.max(1, num(first(e, 71)));
        add('block', name, layer, { count: n });
        break;
      }
      case 'TEXT':
      case 'MTEXT':
      case 'ATTRIB': {
        const t = e.pairs
          .filter((p) => p[0] === 1 || p[0] === 3)
          .map((p) => p[1])
          .join('')
          // MTEXT formatting codes: \P new paragraph, {\fArial|b0;…}, \H2.5x; …
          .replace(/\\P/g, '\n')
          .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
          .replace(/[{}]/g, '')
          .replace(/%%[cC]/g, 'Ø')
          .replace(/%%[dD]/g, '°')
          .replace(/%%[pP]/g, '±');
        for (const line of t.split('\n')) if (line.trim()) texts.push(line.trim());
        break;
      }
      default:
        skipped++;
    }
  }
  return { declaredUnit, raw: [...groups.values()], texts, skipped };
}

/** The sums in metres for the chosen drawing unit, biggest first within each type */
export function dxfGroups(read: DxfReadResult, unit: DxfUnit): DxfGroup[] {
  const m = DXF_UNIT_METERS[unit];
  const order = { block: 0, 'layer-area': 1, 'layer-length': 2 } as const;
  return read.raw
    .map((g): DxfGroup => {
      if (g.type === 'block') return { key: g.key, type: g.type, name: g.name, layer: g.layer, kind: 'count', qty: g.count, objects: g.objects };
      if (g.type === 'layer-area') return { key: g.key, type: g.type, name: g.name, layer: g.layer, kind: 'area', qty: g.area * m * m, perimeter: g.perimeter * m, objects: g.objects };
      return { key: g.key, type: g.type, name: g.name, layer: g.layer, kind: 'length', qty: g.length * m, objects: g.objects };
    })
    .filter((g) => g.qty > 0)
    .sort((a, b) => order[a.type] - order[b.type] || b.qty - a.qty);
}

/**
 * The unit a file without $INSUNITS is most likely drawn in: Thai building plans are drawn in mm or
 * in metres. A plan whose lines total kilometres in metres is really in millimetres.
 */
export function guessDxfUnit(read: DxfReadResult): DxfUnit {
  if (read.declaredUnit) return read.declaredUnit;
  const total = read.raw.reduce((s, g) => s + g.length + g.perimeter, 0);
  // Drawn in metres a building's lines add up to hundreds or thousands; in mm, to millions
  return total > 200_000 ? 'mm' : 'm';
}

const NAME_HINTS: [RegExp, string, TakeoffKind?][] = [
  [/wall|ผนัง|brick|block|อิฐ/i, 'ผนังก่ออิฐ'],
  [/door|ประตู|^d\d/i, 'ประตู'],
  [/window|win\b|หน้าต่าง|^w\d/i, 'หน้าต่าง'],
  [/col(umn)?\b|เสา|^c\d/i, 'เสา'],
  [/beam|คาน|^b\d/i, 'คาน'],
  [/slab|พื้น|floor/i, 'พื้น'],
  [/footing|ฐานราก|^f\d/i, 'ฐานราก'],
  [/pile|เข็ม/i, 'เสาเข็ม'],
  [/roof|หลังคา/i, 'หลังคา'],
  [/ceiling|ฝ้า/i, 'ฝ้าเพดาน'],
  [/tile|กระเบื้อง/i, 'ปูกระเบื้อง'],
  [/paint|สี/i, 'ทาสี'],
  [/light|lamp|โคม|ไฟ/i, 'ดวงโคม'],
  [/socket|outlet|recep|เต้ารับ|ปลั๊ก/i, 'เต้ารับ'],
  [/switch|สวิตช์|สวิทช์/i, 'สวิตช์'],
  [/pipe|ท่อ/i, 'ท่อ'],
  [/wc|toilet|lav|sink|สุขภัณฑ์|โถ|อ่าง/i, 'สุขภัณฑ์'],
  [/road|ถนน|pave/i, 'ผิวถนน'],
  [/curb|kerb|คันหิน/i, 'คันหิน'],
  [/fence|รั้ว/i, 'รั้ว'],
  [/tree|ต้นไม้/i, 'ต้นไม้'],
  [/grass|หญ้า|turf/i, 'ปูหญ้า'],
  [/manhole|บ่อพัก|^mh/i, 'บ่อพัก'],
];

/** A Thai BOQ name to start from, from the layer or block name; null when nothing fits */
export function suggestDxfName(g: Pick<DxfGroup, 'name' | 'layer' | 'type'>): string | null {
  for (const [re, name] of NAME_HINTS) if (re.test(g.name) || (g.type === 'block' && re.test(g.layer))) return `${name} (${g.name})`;
  return null;
}
