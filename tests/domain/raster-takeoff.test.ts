import { describe, expect, it } from 'vitest';
import { otsuThreshold, rasterToVectors, simplify, snapPen, type GrayImage } from '@/domain/raster-takeoff';
import { groupVectors, scaleFromText } from '@/domain/vector-takeoff';

/** A white page with black bars drawn on it */
function page(w: number, h: number, bars: [number, number, number, number][]): GrayImage {
  const data = new Uint8Array(w * h).fill(250);
  for (const [x0, y0, x1, y1] of bars) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * w + x] = 10;
  return { width: w, height: h, data };
}

const lengthOf = (pts: [number, number][]) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);

describe('raster take-off', () => {
  it('helpers', () => {
    expect(snapPen(0.33)).toBe(0.35);
    expect(snapPen(0.9)).toBe(1);
    expect(simplify([[0, 0], [1, 0.2], [2, 0], [3, 0]], 1)).toEqual([[0, 0], [3, 0]]);
    const img = page(50, 50, [[10, 10, 40, 20]]);
    const t = otsuThreshold(img);
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThan(250);
  });

  it('traces a thick line cut by thin hatching as one line, and keeps the hatching apart', () => {
    // scale 2 px per pt; thick bar 6 px (≈1.06 mm) along y=100, thin 2 px hatching across it every 20 px
    const bars: [number, number, number, number][] = [[50, 97, 650, 103]];
    for (let x = 80; x < 640; x += 20) bars.push([x, 60, x + 2, 140]);
    const { paths } = rasterToVectors(page(700, 200, bars), { scale: 2 });
    const thick = paths.filter((p) => p.lineWidth * (25.4 / 72) >= 0.7);
    // One line from end to end (300 pt long), not 29 pieces
    expect(thick).toHaveLength(1);
    expect(lengthOf(thick[0]!.subpaths[0]!.points)).toBeGreaterThan(290);
    const thin = paths.filter((p) => p.lineWidth * (25.4 / 72) < 0.5);
    expect(thin.length).toBeGreaterThanOrEqual(25);

    const groups = groupVectors([{ page: 1, width: 350, height: 100, paths, texts: [], truncated: false, scanned: true }]);
    expect(groups.filter((g) => g.type === 'line').length).toBeGreaterThanOrEqual(2);
  });

  it('wipes OCR words and reads them as text', () => {
    // a "word" made of short strokes, and a long wall
    const img = page(400, 200, [[20, 150, 380, 156], [30, 30, 34, 60], [40, 30, 44, 60], [50, 30, 54, 60], [30, 30, 54, 34]]);
    const without = rasterToVectors(img, { scale: 2 });
    const withWords = rasterToVectors(img, { scale: 2, words: [{ text: '1:100', conf: 90, x0: 28, y0: 28, x1: 56, y1: 62 }, { text: 'ซ', conf: 10, x0: 300, y0: 10, x1: 310, y1: 20 }] });
    expect(withWords.paths.length).toBeLessThan(without.paths.length);
    expect(withWords.paths).toHaveLength(1);
    expect(withWords.texts.map((t) => t.str)).toEqual(['1:100', 'ซ']);
    expect(rasterToVectors(img, { scale: 2, words: [{ text: 'ซ', conf: 10, x0: 300, y0: 10, x1: 310, y1: 20 }], minTextConfidence: 40 }).texts).toEqual([]);
    expect(scaleFromText(withWords.texts)).toBe(100);
  });
});
