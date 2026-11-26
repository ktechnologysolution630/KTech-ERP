import type { TakeoffItem, TakeoffKind } from './boq-takeoff';

/**
 * Building elements measured once, the way Archicad takes off a wall, slab or column: one measurement
 * on the drawing gives every BOQ line the element needs. Archicad keeps a list of quantities for each
 * element type (Wall_NetOutsideSurfaceArea, Slab_EdgeSurfaceArea, Column_SideSurfaceArea …); each line
 * below is the same quantity worked out from the measurement and the element's dimensions.
 *
 * The first line holds the measurements; the others are derived from it (TakeoffItem.sourceItemId).
 */

export type ElementKey = 'wall' | 'slab' | 'column' | 'beam' | 'room' | 'roof';

export interface ElementParam {
  key: string;
  label: string;
  unit: string;
  default: number;
  min?: number;
  max?: number;
}

export interface ElementLine {
  /** Prefix put in front of the element's name, e.g. "ฉาบปูน" */
  prefix: string;
  unit: string;
  factor: number;
  deductQty?: number;
  basis?: 'perimeter';
  /** The Archicad quantity this line corresponds to, kept in the item's note */
  archicad: string;
  /** How the line is worked out, shown before the lines are made */
  formula: string;
}

export interface ElementTemplate {
  key: ElementKey;
  label: string;
  /** How the element is measured on the drawing */
  kind: TakeoffKind;
  measureHint: string;
  defaultName: string;
  params: ElementParam[];
  lines: (p: Record<string, number>) => ElementLine[];
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const n = (x: number) => x.toLocaleString('th-TH', { maximumFractionDigits: 3 });

export const ELEMENT_TEMPLATES: ElementTemplate[] = [
  {
    key: 'wall',
    label: 'ผนัง',
    kind: 'length',
    measureHint: 'ลากตามแนวผนังบนแปลน',
    defaultName: 'ผนังก่ออิฐมวลเบา หนา 7.5 ซม.',
    params: [
      { key: 'height', label: 'ความสูงผนัง', unit: 'ม.', default: 3, min: 0.01, max: 100 },
      { key: 'thickness', label: 'ความหนา', unit: 'ม.', default: 0.075, min: 0, max: 5 },
      { key: 'openings', label: 'ช่องประตู-หน้าต่างรวม', unit: 'ตร.ม.', default: 0, min: 0 },
      { key: 'sides', label: 'จำนวนด้านที่ฉาบ/ทาสี', unit: 'ด้าน', default: 2, min: 0, max: 2 },
    ],
    lines: ({ height: h, thickness: t, openings: a, sides: s }) => [
      { prefix: '', unit: 'ตร.ม.', factor: r6(h), deductQty: r6(a), archicad: 'Wall_NetOutsideSurfaceArea', formula: `ยาว × ${n(h)} − ช่องเปิด ${n(a)}` },
      ...(s > 0
        ? [
            { prefix: 'ฉาบปูน', unit: 'ตร.ม.', factor: r6(h * s), deductQty: r6(a * s), archicad: 'Wall_NetInsideSurfaceArea + Wall_NetOutsideSurfaceArea', formula: `(ยาว × ${n(h)} − ${n(a)}) × ${s} ด้าน` },
            { prefix: 'ทาสี', unit: 'ตร.ม.', factor: r6(h * s), deductQty: r6(a * s), archicad: 'Wall_NetInsideSurfaceArea + Wall_NetOutsideSurfaceArea', formula: `(ยาว × ${n(h)} − ${n(a)}) × ${s} ด้าน` },
          ]
        : []),
      ...(t > 0 ? [{ prefix: 'ปริมาตร', unit: 'ลบ.ม.', factor: r6(h * t), deductQty: r6(a * t), archicad: 'General_NetVolume', formula: `(ยาว × ${n(h)} − ${n(a)}) × หนา ${n(t)}` }] : []),
    ],
  },
  {
    key: 'slab',
    label: 'พื้น คสล.',
    kind: 'area',
    measureHint: 'ลากรอบพื้น ช่องเปิดใช้โหมดหักออก',
    defaultName: 'พื้น คสล. หนา 10 ซม.',
    params: [{ key: 'thickness', label: 'ความหนาพื้น', unit: 'ม.', default: 0.1, min: 0.01, max: 5 }],
    lines: ({ thickness: t }) => [
      { prefix: 'คอนกรีต', unit: 'ลบ.ม.', factor: r6(t), archicad: 'General_NetVolume', formula: `พื้นที่ × หนา ${n(t)}` },
      { prefix: 'ไม้แบบท้อง', unit: 'ตร.ม.', factor: 1, archicad: 'Slab_BottomSurfaceArea', formula: 'พื้นที่' },
      { prefix: 'ไม้แบบข้าง', unit: 'ตร.ม.', factor: r6(t), basis: 'perimeter', archicad: 'Slab_EdgeSurfaceArea', formula: `เส้นรอบรูป × หนา ${n(t)}` },
    ],
  },
  {
    key: 'column',
    label: 'เสา',
    kind: 'count',
    measureHint: 'คลิกที่ตำแหน่งเสาแต่ละต้น',
    defaultName: 'เสา คสล. 0.20×0.20 ม.',
    params: [
      { key: 'width', label: 'กว้าง', unit: 'ม.', default: 0.2, min: 0.01, max: 10 },
      { key: 'depth', label: 'ลึก', unit: 'ม.', default: 0.2, min: 0.01, max: 10 },
      { key: 'height', label: 'สูง', unit: 'ม.', default: 3, min: 0.01, max: 100 },
    ],
    lines: ({ width: w, depth: d, height: h }) => [
      { prefix: 'คอนกรีต', unit: 'ลบ.ม.', factor: r6(w * d * h), archicad: 'Column_GrossCoreVolume', formula: `จำนวน × ${n(w)} × ${n(d)} × ${n(h)}` },
      { prefix: 'ไม้แบบ', unit: 'ตร.ม.', factor: r6(2 * (w + d) * h), archicad: 'Column_SideSurfaceArea', formula: `จำนวน × 2 × (${n(w)} + ${n(d)}) × ${n(h)}` },
      { prefix: 'จำนวน', unit: 'ต้น', factor: 1, archicad: 'COUNT', formula: 'จำนวนจุด' },
    ],
  },
  {
    key: 'beam',
    label: 'คาน',
    kind: 'length',
    measureHint: 'ลากตามแนวคาน',
    defaultName: 'คาน คสล. 0.20×0.40 ม.',
    params: [
      { key: 'width', label: 'กว้าง', unit: 'ม.', default: 0.2, min: 0.01, max: 10 },
      { key: 'depth', label: 'ลึก', unit: 'ม.', default: 0.4, min: 0.01, max: 10 },
    ],
    lines: ({ width: w, depth: d }) => [
      { prefix: 'คอนกรีต', unit: 'ลบ.ม.', factor: r6(w * d), archicad: 'Beam_Volume', formula: `ยาว × ${n(w)} × ${n(d)}` },
      { prefix: 'ไม้แบบ', unit: 'ตร.ม.', factor: r6(w + 2 * d), archicad: 'Beam_BottomSurfaceArea + Beam_LeftSurfaceArea + Beam_RightSurfaceArea', formula: `ยาว × (${n(w)} + 2 × ${n(d)})` },
    ],
  },
  {
    key: 'room',
    label: 'ห้อง',
    kind: 'area',
    measureHint: 'ลากรอบห้องตามผิวผนังด้านใน',
    defaultName: 'ห้อง',
    params: [
      { key: 'height', label: 'ความสูงฝ้า', unit: 'ม.', default: 2.6, min: 0.01, max: 100 },
      { key: 'openings', label: 'ช่องประตู-หน้าต่างรวม', unit: 'ตร.ม.', default: 0, min: 0 },
    ],
    lines: ({ height: h, openings: a }) => [
      { prefix: 'พื้น', unit: 'ตร.ม.', factor: 1, archicad: 'Zone_NetArea', formula: 'พื้นที่' },
      { prefix: 'ฝ้าเพดาน', unit: 'ตร.ม.', factor: 1, archicad: 'Zone_NetArea', formula: 'พื้นที่' },
      { prefix: 'บัวเชิงผนัง', unit: 'ม.', factor: 1, basis: 'perimeter', archicad: 'Zone_Perimeter', formula: 'เส้นรอบรูป' },
      { prefix: 'ผิวผนังภายใน', unit: 'ตร.ม.', factor: r6(h), deductQty: r6(a), basis: 'perimeter', archicad: 'Zone_WallsSurfaceArea', formula: `เส้นรอบรูป × ${n(h)} − ช่องเปิด ${n(a)}` },
    ],
  },
  {
    key: 'roof',
    label: 'หลังคา',
    kind: 'area',
    measureHint: 'ลากรอบหลังคาบนแปลนหลังคา',
    defaultName: 'หลังคากระเบื้อง',
    params: [{ key: 'slope', label: 'ความชัน', unit: 'องศา', default: 30, min: 0, max: 80 }],
    lines: ({ slope }) => [
      { prefix: '', unit: 'ตร.ม.', factor: r6(1 / Math.cos((slope * Math.PI) / 180)), archicad: 'Roof_NetTopSurfaceArea', formula: `พื้นที่แปลน ÷ cos ${n(slope)}°` },
      { prefix: 'ขอบหลังคา (เชิงชาย+ปั้นลม)', unit: 'ม.', factor: 1, basis: 'perimeter', archicad: 'Roof_EavesLength + Roof_GablesLength', formula: 'เส้นรอบรูปบนแปลน' },
    ],
  },
];

export const elementTemplate = (key: ElementKey) => ELEMENT_TEMPLATES.find((t) => t.key === key)!;

/** The template's dimensions with anything missing, out of range or not a number put back to its default */
export function cleanParams(t: ElementTemplate, raw: Record<string, number | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of t.params) {
    const v = raw[p.key];
    out[p.key] = v === undefined || !Number.isFinite(v) ? p.default : Math.min(p.max ?? Infinity, Math.max(p.min ?? 0, v));
  }
  return out;
}

/**
 * The take-off items for one element: the first holds the measurements, the rest follow it.
 * `newId` and `colorOf` come from the page so ids and colours match the other items.
 */
export function buildElementItems(
  t: ElementTemplate,
  rawParams: Record<string, number | undefined>,
  opts: { name: string; category: string; newId: () => string; colorOf: (i: number) => string },
): TakeoffItem[] {
  const params = cleanParams(t, rawParams);
  const name = opts.name.trim() || t.defaultName;
  const lines = t.lines(params);
  const mainId = opts.newId();
  const dims = t.params.map((p) => `${p.label} ${n(params[p.key]!)} ${p.unit}`).join(', ');
  return lines.map((l, i) => ({
    id: i === 0 ? mainId : opts.newId(),
    category: opts.category,
    description: (l.prefix ? `${l.prefix} ${name}` : name).slice(0, 1000),
    kind: t.kind,
    unit: l.unit,
    factor: l.factor,
    wastePercent: 0,
    materialRate: '',
    laborRate: '',
    color: opts.colorOf(i),
    note: `${t.label} (${dims}): ${l.formula} · Archicad ${l.archicad}`.slice(0, 500),
    ...(i === 0 ? {} : { sourceItemId: mainId }),
    ...(l.basis ? { basis: l.basis } : {}),
    ...(l.deductQty ? { deductQty: l.deductQty } : {}),
  }));
}
