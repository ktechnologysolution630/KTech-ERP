import type { PDFPageProxy } from 'pdfjs-dist';
import type { Point } from '@/domain/boq-takeoff';
import type { PageVectors, VectorPath, VectorText } from '@/domain/vector-takeoff';

/**
 * Reads the vector drawing of one PDF page (lines, curves, rectangles, fills and text) the way it is
 * painted, in page units at zoom 1 with y down — the take-off's coordinate space. Runs in the browser
 * on pdf.js's operator list, so the file never leaves the computer.
 */

type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** A page with more paths than this is read only up to here (keeps the browser responsive) */
export const MAX_PATHS_PER_PAGE = 60_000;
const CURVE_STEPS = 8;

interface State {
  ctm: Matrix;
  strokeColor: string;
  fillColor: string;
  lineWidth: number;
}

export async function extractPageVectors(page: PDFPageProxy, pageNo: number, OPS: Record<string, number>): Promise<PageVectors> {
  const viewport = page.getViewport({ scale: 1 });
  const base = viewport.transform as Matrix;
  const ops = await page.getOperatorList();
  const paths: VectorPath[] = [];
  let truncated = false;

  let state: State = { ctm: base, strokeColor: '#000000', fillColor: '#000000', lineWidth: 1 };
  const stack: State[] = [];
  let current: { points: Point[]; closed: boolean }[] = [];

  const paint = (stroke: boolean, fill: boolean, close: boolean) => {
    if (close && current.length) current[current.length - 1]!.closed = true;
    const subpaths = current.filter((s) => s.points.length >= 2 || (fill && s.points.length >= 3));
    current = [];
    if (!subpaths.length || (!stroke && !fill)) return;
    if (paths.length >= MAX_PATHS_PER_PAGE) {
      truncated = true;
      return;
    }
    const det = Math.abs(state.ctm[0] * state.ctm[3] - state.ctm[1] * state.ctm[2]);
    paths.push({
      subpaths,
      stroke,
      fill,
      strokeColor: state.strokeColor,
      fillColor: state.fillColor,
      // A zero width is “thinnest the device can draw”
      lineWidth: Math.max(state.lineWidth, 0.1) * Math.sqrt(det),
    });
  };

  const construct = (subOps: number[], args: number[]) => {
    const m = state.ctm;
    let cur: { points: Point[]; closed: boolean } | null = current[current.length - 1] ?? null;
    let x = 0,
      y = 0;
    const lineTo = (nx: number, ny: number) => {
      if (!cur || cur.closed) {
        cur = { points: [apply(m, x, y)], closed: false };
        current.push(cur);
      }
      cur.points.push(apply(m, nx, ny));
      x = nx;
      y = ny;
    };
    const curve = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      const x0 = x,
        y0 = y;
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS,
          u = 1 - t;
        lineTo(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
      }
    };
    for (let i = 0, j = 0; i < subOps.length; i++) {
      switch (subOps[i]) {
        case OPS.rectangle: {
          const [rx, ry, w, h] = [args[j++]!, args[j++]!, args[j++]!, args[j++]!];
          cur = { points: [apply(m, rx, ry), apply(m, rx + w, ry), apply(m, rx + w, ry + h), apply(m, rx, ry + h)], closed: true };
          current.push(cur);
          x = rx;
          y = ry;
          break;
        }
        case OPS.moveTo:
          x = args[j++]!;
          y = args[j++]!;
          cur = { points: [apply(m, x, y)], closed: false };
          current.push(cur);
          break;
        case OPS.lineTo:
          lineTo(args[j++]!, args[j++]!);
          break;
        case OPS.curveTo:
          curve(args[j]!, args[j + 1]!, args[j + 2]!, args[j + 3]!, args[j + 4]!, args[j + 5]!);
          j += 6;
          break;
        case OPS.curveTo2:
          curve(x, y, args[j]!, args[j + 1]!, args[j + 2]!, args[j + 3]!);
          j += 4;
          break;
        case OPS.curveTo3:
          curve(args[j]!, args[j + 1]!, args[j + 2]!, args[j + 3]!, args[j + 2]!, args[j + 3]!);
          j += 4;
          break;
        case OPS.closePath:
          if (cur) cur.closed = true;
          break;
      }
    }
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const a = ops.argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push({ ...state });
        break;
      case OPS.restore:
        state = stack.pop() ?? state;
        break;
      case OPS.transform:
        state.ctm = multiply(state.ctm, a as Matrix);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ...state });
        if (Array.isArray(a[0]) && a[0].length === 6) state.ctm = multiply(state.ctm, a[0] as Matrix);
        break;
      case OPS.paintFormXObjectEnd:
        state = stack.pop() ?? state;
        break;
      case OPS.setLineWidth:
        state.lineWidth = Number(a[0]) || 0;
        break;
      case OPS.setStrokeRGBColor:
        state.strokeColor = typeof a[0] === 'string' ? (a[0] as string) : hex(Number(a[0]), Number(a[1]), Number(a[2]));
        break;
      case OPS.setFillRGBColor:
        state.fillColor = typeof a[0] === 'string' ? (a[0] as string) : hex(Number(a[0]), Number(a[1]), Number(a[2]));
        break;
      case OPS.constructPath:
        construct(a[0] as number[], a[1] as number[]);
        break;
      case OPS.stroke:
        paint(true, false, false);
        break;
      case OPS.closeStroke:
        paint(true, false, true);
        break;
      case OPS.fill:
      case OPS.eoFill:
        paint(false, true, true);
        break;
      case OPS.fillStroke:
      case OPS.eoFillStroke:
        paint(true, true, false);
        break;
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        paint(true, true, true);
        break;
      case OPS.endPath:
        current = [];
        break;
    }
  }

  const texts: VectorText[] = [];
  const content = await page.getTextContent();
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const t = item.transform as Matrix;
    // Middle of the text along its baseline, lifted by half its height
    const len = Math.hypot(t[0], t[1]) || 1;
    const dx = (t[0] / len) * (item.width / 2),
      dy = (t[1] / len) * (item.width / 2);
    texts.push({ str: item.str, at: apply(base, t[4] + dx, t[5] + dy + item.height / 3) });
  }

  return { page: pageNo, width: viewport.width, height: viewport.height, paths, texts, truncated };
}
