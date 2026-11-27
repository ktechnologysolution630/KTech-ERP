import { distance, type Point } from "./boq-takeoff";
import { chainSegments, type PageVectors } from "./vector-takeoff";

/**
 * Reading the lines of a drawing while measuring by hand, the way a CAD program uses a PDF placed
 * as a drawing: the cursor snaps to the drawing's endpoints, crossings, midpoints and lines, and a
 * "magic wand" click picks a whole room outline or a whole line run in one go.
 *
 * Works on the vectors read from the page (lib/pdf-vectors, or lib/scan-vectors for a scan). All
 * coordinates are page units at zoom 1 with y down, the take-off's coordinate space.
 */

export type SnapKind = "end" | "cross" | "mid" | "on";

export interface Snap {
  point: Point;
  kind: SnapKind;
}

export interface SnapIndex {
  width: number;
  height: number;
  /** x1, y1, x2, y2 per segment */
  segs: Float64Array;
  /** Style of each segment (colour and pen), to follow one line type with the magic wand */
  style: Uint32Array;
  count: number;
  cell: number;
  cols: number;
  rows: number;
  buckets: Map<number, number[]>;
}

/** Grid cell for finding segments near a point, in page units */
const CELL = 16;
/** Shorter than this is drawing noise */
const MIN_SEG = 0.2;
/** Above this many segments near the cursor, crossings are not worked out (stays responsive) */
const MAX_CROSS_CANDIDATES = 160;

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (
    (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) /
    255
  );
};

/**
 * The segments of a page that bound things: every stroked line, and the outline of dark filled
 * shapes (solid walls and columns). Light fills, such as a floor tint, are left out so that a room
 * stays one room.
 */
export function buildSnapIndex(v: PageVectors): SnapIndex {
  const list: number[] = [];
  const styles: number[] = [];
  const styleIds = new Map<string, number>();
  for (const path of v.paths) {
    const solid = path.fill && !path.stroke && luminance(path.fillColor) < 0.75;
    if (!path.stroke && !solid) continue;
    const key = path.stroke
      ? `${path.strokeColor}|${Math.round(path.lineWidth * 100)}`
      : `fill|${path.fillColor}`;
    let sid = styleIds.get(key);
    if (sid === undefined) styleIds.set(key, (sid = styleIds.size));
    for (const sp of path.subpaths) {
      const pts = sp.points;
      const n = pts.length;
      const last = sp.closed || (solid && !path.stroke) ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const a = pts[i]!,
          b = pts[(i + 1) % n]!;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_SEG) continue;
        list.push(a[0], a[1], b[0], b[1]);
        styles.push(sid);
      }
    }
  }
  const segs = Float64Array.from(list);
  const count = styles.length;
  const cols = Math.max(1, Math.ceil(v.width / CELL));
  const rows = Math.max(1, Math.ceil(v.height / CELL));
  const buckets = new Map<number, number[]>();
  const clampC = (x: number) =>
    Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
  const clampR = (y: number) =>
    Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
  for (let s = 0; s < count; s++) {
    const x1 = segs[s * 4]!,
      y1 = segs[s * 4 + 1]!,
      x2 = segs[s * 4 + 2]!,
      y2 = segs[s * 4 + 3]!;
    // Walk along the segment so a long diagonal line sits only in the cells it passes through
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (CELL / 2)),
    );
    let prev = -1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const key =
        clampR(y1 + (y2 - y1) * t) * cols + clampC(x1 + (x2 - x1) * t);
      if (key === prev) continue;
      prev = key;
      const b = buckets.get(key);
      if (!b) buckets.set(key, [s]);
      else if (b[b.length - 1] !== s) b.push(s);
    }
  }
  return {
    width: v.width,
    height: v.height,
    segs,
    style: Uint32Array.from(styles),
    count,
    cell: CELL,
    cols,
    rows,
    buckets,
  };
}

/** Segments that may pass within `r` of p */
function near(index: SnapIndex, p: Point, r: number): number[] {
  const { cell, cols, rows, buckets } = index;
  const c0 = Math.max(0, Math.floor((p[0] - r) / cell)),
    c1 = Math.min(cols - 1, Math.floor((p[0] + r) / cell));
  const r0 = Math.max(0, Math.floor((p[1] - r) / cell)),
    r1 = Math.min(rows - 1, Math.floor((p[1] + r) / cell));
  const out = new Set<number>();
  for (let y = r0; y <= r1; y++)
    for (let x = c0; x <= c1; x++)
      for (const s of buckets.get(y * cols + x) ?? []) out.add(s);
  return [...out];
}

function closestOnSegment(segs: Float64Array, s: number, p: Point): Point {
  const x1 = segs[s * 4]!,
    y1 = segs[s * 4 + 1]!,
    x2 = segs[s * 4 + 2]!,
    y2 = segs[s * 4 + 3]!;
  const dx = x2 - x1,
    dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2
    ? Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / len2))
    : 0;
  return [x1 + dx * t, y1 + dy * t];
}

function crossing(segs: Float64Array, a: number, b: number): Point | null {
  const x1 = segs[a * 4]!,
    y1 = segs[a * 4 + 1]!,
    x2 = segs[a * 4 + 2]!,
    y2 = segs[a * 4 + 3]!;
  const x3 = segs[b * 4]!,
    y3 = segs[b * 4 + 1]!,
    x4 = segs[b * 4 + 2]!,
    y4 = segs[b * 4 + 3]!;
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / d;
  const eps = 1e-6;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

const RANK: Record<SnapKind, number> = { end: 0, cross: 0, mid: 1, on: 2 };

/**
 * The drawing point the cursor should take: an endpoint or a crossing of two lines first, then a
 * line's midpoint, then the nearest point on a line, each only within `radius` page units.
 */
export function snapAt(
  index: SnapIndex,
  p: Point,
  radius: number,
): Snap | null {
  const { segs } = index;
  const cand = near(index, p, radius);
  let best: Snap | null = null;
  let bestD = Infinity;
  const offer = (point: Point, kind: SnapKind) => {
    const d = distance(point, p);
    if (d > radius) return;
    if (
      !best ||
      RANK[kind] < RANK[best.kind] ||
      (RANK[kind] === RANK[best.kind] && d < bestD)
    ) {
      best = { point, kind };
      bestD = d;
    }
  };
  const close: number[] = [];
  for (const s of cand) {
    const on = closestOnSegment(segs, s, p);
    if (distance(on, p) > radius) continue;
    close.push(s);
    const a: Point = [segs[s * 4]!, segs[s * 4 + 1]!],
      b: Point = [segs[s * 4 + 2]!, segs[s * 4 + 3]!];
    offer(a, "end");
    offer(b, "end");
    offer([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], "mid");
    offer(on, "on");
  }
  if (close.length <= MAX_CROSS_CANDIDATES)
    for (let i = 0; i < close.length; i++)
      for (let j = i + 1; j < close.length; j++) {
        const x = crossing(segs, close[i]!, close[j]!);
        if (x) offer(x, "cross");
      }
  return best;
}

/**
 * Magic wand for a length item: the whole run of connected lines of the same colour and pen as the
 * line clicked, within `radius` page units of p.
 */
export function lineAt(
  index: SnapIndex,
  p: Point,
  radius: number,
): Point[] | null {
  const { segs, style, count } = index;
  let hit = -1;
  let hitD = radius;
  for (const s of near(index, p, radius)) {
    const d = distance(closestOnSegment(segs, s, p), p);
    if (d <= hitD) {
      hitD = d;
      hit = s;
    }
  }
  if (hit < 0) return null;
  const same: [Point, Point][] = [];
  for (let s = 0; s < count; s++)
    if (style[s] === style[hit])
      same.push([
        [segs[s * 4]!, segs[s * 4 + 1]!],
        [segs[s * 4 + 2]!, segs[s * 4 + 3]!],
      ]);
  const a: Point = [segs[hit * 4]!, segs[hit * 4 + 1]!],
    b: Point = [segs[hit * 4 + 2]!, segs[hit * 4 + 3]!];
  const eq = (u: Point, v: Point) => distance(u, v) < 0.1;
  for (const line of chainSegments(same))
    for (let i = 0; i + 1 < line.length; i++)
      if (
        (eq(line[i]!, a) && eq(line[i + 1]!, b)) ||
        (eq(line[i]!, b) && eq(line[i + 1]!, a))
      )
        return line;
  return [a, b];
}

export interface RegionOptions {
  /** Gaps in the drawing up to about this wide (page units) are treated as closed. Default 1 */
  gap?: number;
}

/** Most cells along one side of the grid the fill works on */
const MAX_GRID = 1600;

/**
 * Magic wand for an area item: the outline of the space enclosed by the drawing's lines around p,
 * as a CAD program finds a room from its walls. Lines inside the space (furniture, text) do not cut
 * it; its outline runs along the middle of the bounding lines. Null when p is not enclosed.
 */
export function regionAt(
  index: SnapIndex,
  p: Point,
  opts: RegionOptions = {},
): Point[] | null {
  const gap = opts.gap ?? 1;
  const { width: W, height: H } = index;
  if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) return null;
  const full = Math.max(W, H);
  for (const half of [150, 400, 1000, full]) {
    const x0 = Math.max(0, p[0] - half),
      y0 = Math.max(0, p[1] - half);
    const x1 = Math.min(W, p[0] + half),
      y1 = Math.min(H, p[1] + half);
    const wholePage = x0 === 0 && y0 === 0 && x1 === W && y1 === H;
    const cell = Math.max(0.25, Math.max(x1 - x0, y1 - y0) / MAX_GRID);
    const res = fillRegion(index, p, { x0, y0, x1, y1, cell, gap });
    if (res === "open") {
      if (wholePage) return null;
      continue;
    }
    const tidy = res && tidyOutline(index, res, cell * 3 + gap);
    // Small bumps left where other lines touch the walls are smoothed out; true corners stay exact
    return (
      tidy && tidyOutline(index, simplifyClosed(tidy, Math.max(1, cell * 2)), 0)
    );
  }
  return null;
}

/**
 * Moves each corner of a traced outline onto the drawing's own corner nearby (an endpoint or a
 * crossing), so the area is exact rather than a cell or so off, then drops repeated corners and
 * corners on a straight run.
 */
function tidyOutline(
  index: SnapIndex,
  pts: Point[],
  radius: number,
): Point[] | null {
  const moved = pts.map((p) => {
    const s = snapAt(index, p, radius);
    return s && (s.kind === "end" || s.kind === "cross") ? s.point : p;
  });
  const out: Point[] = [];
  for (const p of moved)
    if (!out.length || distance(out[out.length - 1]!, p) > 1e-6) out.push(p);
  while (out.length > 1 && distance(out[0]!, out[out.length - 1]!) <= 1e-6)
    out.pop();
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length]!,
        b = out[i]!,
        c = out[(i + 1) % out.length]!;
      const cross =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cross) <= 1e-6 * Math.max(1, distance(a, c) ** 2)) {
        out.splice(i, 1);
        changed = true;
      }
    }
  }
  return out.length >= 3 ? out : null;
}

function fillRegion(
  index: SnapIndex,
  p: Point,
  w: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    cell: number;
    gap: number;
  },
): Point[] | null | "open" {
  const { x0, y0, x1, y1, cell } = w;
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell));
  const rows = Math.max(1, Math.ceil((y1 - y0) / cell));
  const N = cols * rows;
  const wall = new Uint8Array(N);
  const k = Math.max(1, Math.ceil(w.gap / 2 / cell));
  const stamp = (cx: number, cy: number) => {
    for (let dy = -k; dy <= k; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= rows) continue;
      for (let dx = -k; dx <= k; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= cols || dx * dx + dy * dy > k * k + k) continue;
        wall[y * cols + x] = 1;
      }
    }
  };
  // Draw the bounding lines that pass through the window
  const { segs } = index;
  const seen = new Uint8Array(index.count);
  const c0 = Math.max(0, Math.floor(x0 / index.cell)),
    c1 = Math.min(index.cols - 1, Math.floor(x1 / index.cell));
  const r0 = Math.max(0, Math.floor(y0 / index.cell)),
    r1 = Math.min(index.rows - 1, Math.floor(y1 / index.cell));
  for (let gy = r0; gy <= r1; gy++)
    for (let gx = c0; gx <= c1; gx++)
      for (const s of index.buckets.get(gy * index.cols + gx) ?? []) {
        if (seen[s]) continue;
        seen[s] = 1;
        const ax = (segs[s * 4]! - x0) / cell,
          ay = (segs[s * 4 + 1]! - y0) / cell;
        const bx = (segs[s * 4 + 2]! - x0) / cell,
          by = (segs[s * 4 + 3]! - y0) / cell;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
        for (let t = 0; t <= steps; t++)
          stamp(
            Math.floor(ax + ((bx - ax) * t) / steps),
            Math.floor(ay + ((by - ay) * t) / steps),
          );
      }

  // Start from the clicked cell, or the nearest free one when the click landed on a line
  let sx = Math.min(cols - 1, Math.floor((p[0] - x0) / cell)),
    sy = Math.min(rows - 1, Math.floor((p[1] - y0) / cell));
  if (wall[sy * cols + sx]) {
    let found = false;
    for (let r = 1; r <= k + 3 && !found; r++)
      for (let dy = -r; dy <= r && !found; dy++)
        for (let dx = -r; dx <= r && !found; dx++) {
          const x = sx + dx,
            y = sy + dy;
          if (x >= 0 && y >= 0 && x < cols && y < rows && !wall[y * cols + x]) {
            sx = x;
            sy = y;
            found = true;
          }
        }
    if (!found) return null;
  }

  const inside = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0,
    tail = 0;
  queue[tail++] = sy * cols + sx;
  inside[sy * cols + sx] = 1;
  let touchesEdge = false;
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % cols,
      y = (i - x) / cols;
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1)
      touchesEdge = true;
    if (x > 0 && !inside[i - 1] && !wall[i - 1]) {
      inside[i - 1] = 1;
      queue[tail++] = i - 1;
    }
    if (x < cols - 1 && !inside[i + 1] && !wall[i + 1]) {
      inside[i + 1] = 1;
      queue[tail++] = i + 1;
    }
    if (y > 0 && !inside[i - cols] && !wall[i - cols]) {
      inside[i - cols] = 1;
      queue[tail++] = i - cols;
    }
    if (y < rows - 1 && !inside[i + cols] && !wall[i + cols]) {
      inside[i + cols] = 1;
      queue[tail++] = i + cols;
    }
  }
  if (touchesEdge) return "open";
  if (tail < 4) return null;

  // Grow into the drawn lines by their drawn half width, so the outline sits on the line's middle
  let front = queue.slice(0, tail);
  for (let step = 0; step < k; step++) {
    const next: number[] = [];
    for (const i of front) {
      const x = i % cols;
      for (const j of [
        x > 0 ? i - 1 : -1,
        x < cols - 1 ? i + 1 : -1,
        i - cols,
        i + cols,
      ]) {
        if (j < 0 || j >= N || inside[j] || !wall[j]) continue;
        inside[j] = 1;
        next.push(j);
      }
    }
    front = Int32Array.from(next);
  }

  // Lines that stick into the space from its edge (furniture against a wall, a door leaf) leave
  // thin slits in the fill; closing the shape fills them so the outline follows the walls only
  close(inside, cols, rows, k + 2);

  const outline = traceOutline(inside, cols, rows);
  if (!outline) return null;
  const pts = simplifyClosed(
    outline.map(([x, y]): Point => [x0 + x * cell, y0 + y * cell]),
    cell * 1.2,
  );
  return pts.length >= 3 ? pts : null;
}

/** Square max (grow) or min (shrink) filter of radius m, as two 1D passes */
function squareFilter(
  src: Uint8Array,
  cols: number,
  rows: number,
  m: number,
  grow: boolean,
): Uint8Array {
  const want = grow ? 1 : 0;
  const pass = (from: Uint8Array, along: "x" | "y") => {
    const out = new Uint8Array(from.length);
    const len = along === "x" ? cols : rows,
      lines = along === "x" ? rows : cols;
    const at = (line: number, i: number) =>
      along === "x" ? line * cols + i : i * cols + line;
    for (let line = 0; line < lines; line++) {
      // Distance back to the last cell with the wanted value, then forward
      // Outside the grid counts as empty
      let last = grow ? -Infinity : -1;
      const back = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        if (from[at(line, i)] === want) last = i;
        back[i] = i - last;
      }
      last = grow ? Infinity : len;
      for (let i = len - 1; i >= 0; i--) {
        if (from[at(line, i)] === want) last = i;
        const d = Math.min(back[i]!, last - i);
        out[at(line, i)] = d <= m ? want : 1 - want;
      }
    }
    return out;
  };
  return pass(pass(src, "x"), "y");
}

/** Morphological closing in place: grow by m, then shrink by m */
function close(mask: Uint8Array, cols: number, rows: number, m: number) {
  mask.set(
    squareFilter(squareFilter(mask, cols, rows, m, true), cols, rows, m, false),
  );
}

/**
 * The outer edge of the filled cells, walked along cell borders (clockwise on screen) from the
 * top-left filled cell. Corners only; holes inside are ignored.
 */
function traceOutline(
  inside: Uint8Array,
  cols: number,
  rows: number,
): [number, number][] | null {
  let start = -1;
  for (let i = 0; i < inside.length; i++)
    if (inside[i]) {
      start = i;
      break;
    }
  if (start < 0) return null;
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && inside[y * cols + x] === 1;
  const DX = [1, 0, -1, 0],
    DY = [0, 1, 0, -1];
  const sx = start % cols,
    sy = (start - sx) / cols;
  let x = sx,
    y = sy,
    d = 0;
  const out: [number, number][] = [[x, y]];
  const limit = 4 * (cols + 1) * (rows + 1);
  for (let n = 0; n < limit; n++) {
    // The two cells ahead of this corner: on the right of the direction (inside) and on its left
    const rx = -DY[d]!,
      ry = DX[d]!;
    const q = (sxn: number, syn: number): [number, number] => [
      x + (sxn > 0 ? 0 : -1),
      y + (syn > 0 ? 0 : -1),
    ];
    const [arx, ary] = q(DX[d]! + rx, DY[d]! + ry);
    const [alx, aly] = q(DX[d]! - rx, DY[d]! - ry);
    let nd = d;
    if (!filled(arx, ary)) nd = (d + 1) % 4;
    else if (filled(alx, aly)) nd = (d + 3) % 4;
    if (nd !== d) {
      d = nd;
      if (x === sx && y === sy && d === 0) break;
      out.push([x, y]);
      continue;
    }
    x += DX[d]!;
    y += DY[d]!;
    if (x === sx && y === sy && d === 0) break;
  }
  // Drop repeated corners
  return out.filter(
    (c, i) => i === 0 || c[0] !== out[i - 1]![0] || c[1] !== out[i - 1]![1],
  );
}

/** Douglas–Peucker on a closed outline */
function simplifyClosed(points: Point[], tol: number): Point[] {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  // Split at the point farthest from the first, so both halves are open runs
  let far = 0,
    farD = -1;
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[0]!, points[i]!);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  keep[0] = keep[far] = 1;
  const run = (a: number, b: number) => {
    const stack: [number, number][] = [[a, b]];
    while (stack.length) {
      const [s, e] = stack.pop()!;
      const P = points[s]!,
        Q = points[e % points.length]!;
      const dx = Q[0] - P[0],
        dy = Q[1] - P[1];
      const len = Math.hypot(dx, dy);
      let worst = -1,
        worstD = tol;
      for (let k = s + 1; k < e; k++) {
        const R = points[k % points.length]!;
        const d = len
          ? Math.abs(dy * R[0] - dx * R[1] + Q[0] * P[1] - Q[1] * P[0]) / len
          : distance(R, P);
        if (d > worstD) {
          worstD = d;
          worst = k;
        }
      }
      if (worst >= 0) {
        keep[worst % points.length] = 1;
        stack.push([s, worst], [worst, e]);
      }
    }
  };
  run(0, far);
  run(far, points.length);
  // Corners that lie on a straight run are dropped as well
  return points.filter((_, i) => keep[i]);
}
