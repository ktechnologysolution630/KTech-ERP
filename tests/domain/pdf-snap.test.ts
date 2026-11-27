import { describe, expect, it } from "vitest";
import { polygonArea, polylineLength, type Point } from "@/domain/boq-takeoff";
import { buildSnapIndex, lineAt, regionAt, snapAt } from "@/domain/pdf-snap";
import type { PageVectors, VectorPath } from "@/domain/vector-takeoff";

const line = (
  pts: Point[],
  opts: Partial<VectorPath> = {},
  closed = false,
): VectorPath => ({
  subpaths: [{ points: pts, closed }],
  stroke: true,
  fill: false,
  strokeColor: "#000000",
  fillColor: "#000000",
  lineWidth: 0.5,
  ...opts,
});
const page = (paths: VectorPath[]): PageVectors => ({
  page: 1,
  width: 600,
  height: 400,
  paths,
  texts: [],
  truncated: false,
});

// A plan: two rooms side by side (100..300 and 300..500 by 100..300), a table line inside the left
// room, and a red pipe run of three segments
const plan = page([
  line(
    [
      [100, 100],
      [500, 100],
      [500, 300],
      [100, 300],
    ],
    {},
    true,
  ),
  line([
    [300, 100],
    [300, 300],
  ]),
  line([
    [150, 200],
    [200, 200],
  ]),
  line(
    [
      [50, 350],
      [150, 350],
    ],
    { strokeColor: "#ff0000" },
  ),
  line(
    [
      [150, 350],
      [150, 380],
    ],
    { strokeColor: "#ff0000" },
  ),
  line(
    [
      [150, 380],
      [260, 380],
    ],
    { strokeColor: "#ff0000" },
  ),
]);
const index = buildSnapIndex(plan);

describe("snapping to the drawing", () => {
  it("takes a corner of the drawing first", () => {
    expect(snapAt(index, [103, 98], 6)).toEqual({
      point: [100, 100],
      kind: "end",
    });
  });

  it("finds where two lines cross", () => {
    const s = snapAt(index, [302, 102], 6)!;
    expect(s.kind).toBe("end");
    expect(s.point[0]).toBeCloseTo(300);
    expect(s.point[1]).toBeCloseTo(100);
  });

  it("takes a midpoint before a plain point on the line", () => {
    expect(snapAt(index, [175, 203], 6)).toEqual({
      point: [175, 200],
      kind: "mid",
    });
  });

  it("falls back to the nearest point on a line", () => {
    expect(snapAt(index, [400, 297], 6)).toEqual({
      point: [400, 300],
      kind: "on",
    });
  });

  it("gives nothing away from the lines", () => {
    expect(snapAt(index, [250, 250], 6)).toBeNull();
  });
});

describe("magic wand", () => {
  it("picks the room clicked, with lines inside it ignored", () => {
    const room = regionAt(index, [250, 150])!;
    expect(room).not.toBeNull();
    expect(Math.abs(polygonArea(room))).toBeCloseTo(200 * 200, 6);
    expect(room).toHaveLength(4);
  });

  it("picks the other room on the other side of the wall", () => {
    const room = regionAt(index, [400, 200])!;
    const xs = room.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(300, 0);
    expect(Math.max(...xs)).toBeCloseTo(500, 0);
  });

  it("gives nothing outside every outline", () => {
    expect(regionAt(index, [550, 50])).toBeNull();
  });

  it("closes a gap narrower than the gap setting", () => {
    const gappy = buildSnapIndex(
      page([
        line([
          [100, 100],
          [300, 100],
          [300, 300],
        ]),
        line([
          [300, 300],
          [100, 300],
          [100, 103],
        ]),
      ]),
    );
    expect(regionAt(gappy, [200, 200])).toBeNull();
    expect(regionAt(gappy, [200, 200], { gap: 4 })).not.toBeNull();
  });

  it("follows a whole line run of the same pen", () => {
    const run = lineAt(index, [100, 351], 5)!;
    expect(polylineLength(run)).toBeCloseTo(100 + 30 + 110);
  });

  it("does not run into lines of another pen", () => {
    const run = lineAt(index, [175, 201], 5)!;
    expect(polylineLength(run)).toBeCloseTo(50);
  });

  it("uses dark filled shapes as walls, not light fills", () => {
    const v = page([
      {
        ...line(
          [
            [100, 100],
            [300, 100],
            [300, 300],
            [100, 300],
          ],
          {},
          true,
        ),
        stroke: false,
        fill: true,
        fillColor: "#eeeeee",
      },
      line(
        [
          [90, 90],
          [310, 90],
          [310, 310],
          [90, 310],
        ],
        {},
        true,
      ),
    ]);
    const room = regionAt(buildSnapIndex(v), [200, 200])!;
    expect(Math.abs(polygonArea(room))).toBeGreaterThan(210 * 210);
  });
});
