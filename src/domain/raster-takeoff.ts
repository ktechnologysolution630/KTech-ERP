import type { Point } from './boq-takeoff';
import { SYMBOL_MAX, type VectorPath, type VectorText } from './vector-takeoff';

/**
 * Automatic take-off from a scanned drawing, without AI: the page image is turned into black and
 * white, the text is wiped out, every stroke is thinned to a one-pixel centre line and traced into
 * polylines, and each polyline keeps how thick its stroke was. The result is the same kind of
 * lines that a CAD PDF holds (see vector-takeoff), so the same grouping and naming work on it.
 *
 * Everything here works on plain pixel arrays so it can be tested without a browser.
 */

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, 0 = black */
  data: Uint8Array;
}

/** A word that OCR found, in image pixels */
export interface OcrWord {
  text: string;
  /** 0–100 */
  conf?: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RasterOptions {
  /** Image pixels per page unit (pt): the zoom the page was rendered at */
  scale: number;
  /** Words to read as text and to wipe out before tracing lines */
  words?: OcrWord[];
  /** Words OCR is less sure of than this are wiped from the image but not read as text */
  minTextConfidence?: number;
}

/** Lines shorter than this on paper (mm) are text, hatching or dust, not work */
const MIN_LINE_MM = 3;
/** Pen widths used on drawings; a scanned stroke is snapped to the nearest so lines of one pen group together */
const PEN_MM = [0.18, 0.25, 0.35, 0.5, 0.7, 1.0, 1.4, 2.0, 3.0, 5.0];
/** Wider than this is a filled area (a solid wall or a hatch), still traced along its middle */
const MAX_PEN_MM = 5;
const MM_PER_PT = 25.4 / 72;
/** How far a traced line may stray from its pixels when simplified, in pixels */
const SIMPLIFY_PX = 1;

export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < data.length; i += 4, j++) data[j] = (rgba[i]! * 77 + rgba[i + 1]! * 151 + rgba[i + 2]! * 28) >> 8;
  return { width, height, data };
}

/** Otsu's threshold: the grey level that best splits ink from paper */
export function otsuThreshold(img: GrayImage): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < img.data.length; i++) hist[img.data[i]!]!++;
  const total = img.data.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t]!;
  let sumB = 0,
    wB = 0,
    best = 0,
    bestT = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  // A page that is nearly all paper can put the split in the paper's own grain
  return Math.min(bestT, 200);
}

/** 1 = ink. Pixels at the image edge are always paper so the neighbourhood checks need no bounds. */
export function binarize(img: GrayImage, threshold = otsuThreshold(img)): Uint8Array {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (data[y * w + x]! <= threshold) out[y * w + x] = 1;
  return out;
}

export function wipeBoxes(bin: Uint8Array, w: number, h: number, words: OcrWord[], pad = 2) {
  for (const b of words) {
    const x0 = Math.max(1, Math.floor(b.x0) - pad),
      x1 = Math.min(w - 2, Math.ceil(b.x1) + pad);
    const y0 = Math.max(1, Math.floor(b.y0) - pad),
      y1 = Math.min(h - 2, Math.ceil(b.y1) + pad);
    for (let y = y0; y <= y1; y++) bin.fill(0, y * w + x0, y * w + x1 + 1);
  }
}

/** Distance from each ink pixel to the nearest paper, ×3 (3-4 chamfer) */
export function distanceToPaper(bin: Uint8Array, w: number, h: number): Uint16Array {
  const d = new Uint16Array(w * h);
  const BIG = 65000;
  for (let i = 0; i < d.length; i++) d[i] = bin[i] ? BIG : 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, d[i - 1]! + 3, d[i - w]! + 3, d[i - w - 1]! + 4, d[i - w + 1]! + 4);
    }
  for (let y = h - 2; y >= 1; y--)
    for (let x = w - 2; x >= 1; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, d[i + 1]! + 3, d[i + w]! + 3, d[i + w + 1]! + 4, d[i + w - 1]! + 4);
    }
  return d;
}

/** Zhang–Suen thinning, in place: every stroke becomes a one-pixel line along its middle */
export function thin(bin: Uint8Array, w: number) {
  let active: number[] = [];
  for (let i = 0; i < bin.length; i++) if (bin[i]) active.push(i);
  const remove: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      remove.length = 0;
      for (const i of active) {
        if (!bin[i]) continue;
        const p2 = bin[i - w]!,
          p3 = bin[i - w + 1]!,
          p4 = bin[i + 1]!,
          p5 = bin[i + w + 1]!,
          p6 = bin[i + w]!,
          p7 = bin[i + w - 1]!,
          p8 = bin[i - 1]!,
          p9 = bin[i - w - 1]!;
        const n = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (n < 2 || n > 6) continue;
        const a =
          (+(!p2 && p3) as number) +
          (+(!p3 && p4) as number) +
          (+(!p4 && p5) as number) +
          (+(!p5 && p6) as number) +
          (+(!p6 && p7) as number) +
          (+(!p7 && p8) as number) +
          (+(!p8 && p9) as number) +
          (+(!p9 && p2) as number);
        if (a !== 1) continue;
        if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
        remove.push(i);
      }
      if (remove.length) changed = true;
      for (const i of remove) bin[i] = 0;
    }
    active = active.filter((i) => bin[i]);
  }
  // Staircase corners leave pixels that only thicken the line; dropping them keeps tracing simple
  for (const i of active) {
    if (!bin[i]) continue;
    const n = bin[i - w]!,
      e = bin[i + 1]!,
      s = bin[i + w]!,
      wv = bin[i - 1]!;
    if ((n && e && !bin[i + w - 1]) || (e && s && !bin[i - w - 1]) || (s && wv && !bin[i - w + 1]) || (wv && n && !bin[i + w + 1])) {
      const total = bin[i - w]! + bin[i - w + 1]! + bin[i + 1]! + bin[i + w + 1]! + bin[i + w]! + bin[i + w - 1]! + bin[i - 1]! + bin[i - w - 1]!;
      if (total === 2) bin[i] = 0;
    }
  }
}

export interface TracedLine {
  /** Image pixels */
  points: Point[];
  closed: boolean;
  /** Average stroke thickness, image pixels */
  thickness: number;
  /** Image pixels */
  length: number;
  /** Pixel index where the piece starts and ends (a crossing or a loose end) */
  from: number;
  to: number;
}

/** Follows the one-pixel lines from end to end, breaking at every crossing */
export function traceSkeleton(skel: Uint8Array, dist: Uint16Array, w: number, h: number): { lines: TracedLine[]; nodeOf: (i: number) => number } {
  const offs = [-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1];
  const deg = new Uint8Array(w * h);
  const pixels: number[] = [];
  for (let i = 0; i < skel.length; i++) {
    if (!skel[i]) continue;
    pixels.push(i);
    let n = 0;
    for (const o of offs) n += skel[i + o]!;
    deg[i] = n;
  }
  const seen = new Uint8Array(w * h);
  const lines: TracedLine[] = [];
  const isNode = (i: number) => deg[i] !== 2;

  const walk = (start: number, first: number): TracedLine => {
    const path = [start];
    let prev = start,
      cur = first;
    for (;;) {
      path.push(cur);
      if (isNode(cur) || cur === start) break;
      seen[cur] = 1;
      let next = -1;
      for (const o of offs) {
        const j = cur + o;
        if (skel[j] && j !== prev && (!seen[j] || j === start) && !(isNode(j) && j === prev)) {
          // Prefer the straight-on neighbour (edge) over a diagonal one
          if (next === -1 || Math.abs(o) === 1 || Math.abs(o) === w) next = j;
          if (Math.abs(o) === 1 || Math.abs(o) === w) break;
        }
      }
      if (next === -1) break;
      prev = cur;
      cur = next;
    }
    let length = 0;
    const points: Point[] = path.map((i) => [i % w, Math.floor(i / w)]);
    for (let k = 1; k < points.length; k++) length += Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]);
    // Crossings swell the stroke, so the middle of the piece says best how thick the pen was
    const inner = path.length > 4 ? path.slice(1, -1) : path;
    const widths = inner.map((i) => (dist[i]! / 3) * 2 - 1).sort((a, b) => a - b);
    const thickness = Math.max(1, widths[widths.length >> 1]!);
    const closed = path.length > 3 && path[path.length - 1] === path[0];
    return { points, closed, thickness, length, from: path[0]!, to: path[path.length - 1]! };
  };

  // Lines that start or end at an end or a crossing
  const edgeDone = new Set<string>();
  for (const i of pixels) {
    if (!isNode(i)) continue;
    for (const o of offs) {
      const j = i + o;
      if (!skel[j] || seen[j]) continue;
      if (isNode(j)) {
        // Two crossings side by side: one short piece
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (edgeDone.has(key)) continue;
        edgeDone.add(key);
        continue;
      }
      lines.push(walk(i, j));
    }
  }
  // What is left are closed loops with no crossing
  for (const i of pixels) {
    if (seen[i] || isNode(i)) continue;
    seen[i] = 1;
    let next = -1;
    for (const o of offs) if (skel[i + o] && !seen[i + o]) next = i + o;
    if (next === -1) continue;
    lines.push(walk(i, next));
  }
  // A crossing is often a few pixels; they all stand for one point
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let r = i;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const i of pixels) {
    if (!isNode(i) || deg[i] === 1) continue;
    if (!parent.has(i)) parent.set(i, i);
    for (const o of offs) {
      const j = i + o;
      if (skel[j] && isNode(j) && deg[j] !== 1 && parent.has(j)) {
        const a = find(i),
          b = find(j);
        if (a !== b) parent.set(a, b);
      }
    }
  }
  return { lines, nodeOf: (i) => (parent.has(i) ? find(i) : i) };
}

/** Douglas–Peucker */
export function simplify(points: Point[], tol: number): Point[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a]!,
      [bx, by] = points[b]!;
    const dx = bx - ax,
      dy = by - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1,
      worstD = tol;
    for (let k = a + 1; k < b; k++) {
      const [px, py] = points[k]!;
      const d = len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

const boxSize = (pts: Point[]) => {
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};

export const snapPen = (mm: number) => PEN_MM.reduce((best, p) => (Math.abs(p - mm) < Math.abs(best - mm) ? p : best), PEN_MM[0]!);

/**
 * The scanned page as vector lines and text, in page units (pt, y down) like a CAD PDF read by
 * lib/pdf-vectors. Every line is black; its width is the scanned stroke snapped to a pen width.
 */
export function rasterToVectors(img: GrayImage, opts: RasterOptions): { paths: VectorPath[]; texts: VectorText[] } {
  const { width: w, height: h } = img;
  const s = opts.scale;
  const words = (opts.words ?? []).filter((b) => b.text.trim() && b.y1 - b.y0 < 60 * s && b.x1 - b.x0 < 400 * s);
  const bin = binarize(img);
  wipeBoxes(bin, w, h, words);
  const dist = distanceToPaper(bin, w, h);
  thin(bin, w);
  const minLen = (MIN_LINE_MM / MM_PER_PT) * s;
  const { lines, nodeOf } = traceSkeleton(bin, dist, w, h);
  const paths: VectorPath[] = [];
  const emit = (pixels: Point[], closed: boolean, mm: number) => {
    const pts = simplify(pixels, SIMPLIFY_PX).map(([x, y]): Point => [x / s, y / s]);
    // Small and bent is a letter that OCR missed, or a symbol too rough to tell apart from others
    if (pts.length > 5 && boxSize(pts) <= SYMBOL_MAX) return;
    paths.push({
      subpaths: [{ points: closed ? pts.slice(0, -1) : pts, closed }],
      stroke: true,
      fill: false,
      strokeColor: '#000000',
      fillColor: '#000000',
      lineWidth: mm / MM_PER_PT,
    });
  };
  // Pieces of one pen that meet at a crossing are one line again (a road edge cut by its hatching)
  const byPen = new Map<number, TracedLine[]>();
  for (const line of lines) {
    const mm = Math.min(MAX_PEN_MM, snapPen((line.thickness / s) * MM_PER_PT));
    if (line.closed) {
      if (line.length >= minLen) emit(line.points, true, mm);
      continue;
    }
    const list = byPen.get(mm);
    if (list) list.push(line);
    else byPen.set(mm, [line]);
  }
  const pxPoint = (i: number): Point => [i % w, Math.floor(i / w)];
  for (const [mm, pieces] of byPen) {
    const at = new Map<number, number[]>();
    pieces.forEach((p, k) => {
      for (const n of [nodeOf(p.from), nodeOf(p.to)]) {
        const l = at.get(n);
        if (l) l.push(k);
        else at.set(n, [k]);
      }
    });
    const used = new Uint8Array(pieces.length);
    const follow = (startNode: number, k0: number) => {
      let node = startNode,
        k = k0,
        length = 0;
      const out: Point[] = [pxPoint(node)];
      for (;;) {
        used[k] = 1;
        const p = pieces[k]!;
        const forward = nodeOf(p.from) === node;
        const pts = forward ? p.points : [...p.points].reverse();
        out.push(...pts.slice(1, -1));
        node = forward ? nodeOf(p.to) : nodeOf(p.from);
        out.push(pxPoint(node));
        length += p.length;
        const next = at.get(node)!.filter((j) => !used[j]);
        // Only a plain joint of two pieces carries on; at a T or a cross the line stops
        if (at.get(node)!.length !== 2 || next.length !== 1) break;
        k = next[0]!;
      }
      if (length >= minLen) emit(out, out.length > 3 && node === startNode, mm);
    };
    for (const [node, ks] of at) if (ks.length !== 2) for (const k of ks) if (!used[k]) follow(node, k);
    for (const [node, ks] of at) for (const k of ks) if (!used[k]) follow(node, k);
  }
  const texts: VectorText[] = words.filter((b) => (b.conf ?? 100) >= (opts.minTextConfidence ?? 0)).map((b) => ({ str: b.text.trim(), at: [(b.x0 + b.x1) / 2 / s, (b.y0 + b.y1) / 2 / s] }));
  return { paths, texts };
}
