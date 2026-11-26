import { z } from 'zod';
import type { TakeoffKind } from './boq-takeoff';

/**
 * Quantities from a live Archicad model. Archicad answers its JSON API only on the user's own
 * computer, so a small bridge (public/tools/archicad/ktec_archicad_bridge.py) runs there on
 * 127.0.0.1 and the browser asks it; the ERP server never sees the model.
 */

export const ARCHICAD_BRIDGE_URL = 'http://127.0.0.1:19780';

export const BRIDGE_FILES = [
  { href: '/tools/archicad/ktec_archicad_bridge.py', label: 'ktec_archicad_bridge.py', hint: 'ตัวเชื่อม' },
  { href: '/tools/archicad/start_archicad_bridge.bat', label: 'start_archicad_bridge.bat', hint: 'ดับเบิลคลิกเพื่อเปิดตัวเชื่อม' },
] as const;

const infoSchema = z.object({
  port: z.number().optional(),
  version: z.string().optional().default(''),
  project: z.string().optional().default(''),
});

export const bridgeStatusSchema = z.object({
  ok: z.boolean(),
  bridge: z.string().optional().default(''),
  archicad: infoSchema.nullable().optional().default(null),
});

const rowSchema = z.object({
  category: z.string().catch('ไม่ระบุหมวด'),
  description: z.string(),
  qty: z.number(),
  unit: z.string().catch(''),
  elementType: z.string().catch(''),
  count: z.number().catch(0),
  note: z.string().catch(''),
});

export const bridgeTakeoffSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  rows: z.array(z.unknown()).optional().default([]),
  warnings: z.array(z.string()).optional().default([]),
  archicad: infoSchema.nullable().optional().default(null),
});

export type BridgeStatus = z.infer<typeof bridgeStatusSchema>;

export interface ArchicadRow {
  category: string;
  description: string;
  kind: TakeoffKind;
  unit: string;
  qty: number;
  note: string;
}

const COUNT_UNITS = ['ชุด', 'จุด', 'ชิ้น', 'ตัว', 'บ่อ', 'ต้น', 'แผ่น', 'อัน', 'เครื่อง', 'ท่อน', 'เส้น', 'ห้อง', 'ช่อง', 'บาน', 'ลูก', 'หลัง', 'งาน', 'แห่ง', 'คู่', 'ea', 'pcs', 'no', 'nos', 'set'];
const unitKey = (u: string) => u.replace(/\s+/g, '').replace(/\.$/, '').toLowerCase();

/**
 * Which way the item is measured. A volume (ลบ.ม.) has no tool of its own on the drawing; it is kept as
 * an area item with the model's quantity fixed, so the BOQ line still reads ลบ.ม.
 */
export function kindOfUnit(unit: string): TakeoffKind {
  const u = unitKey(unit);
  if (u === 'ม' || u === 'เมตร' || u === 'm' || u === 'ม.ย' || u === 'เมตรยาว' || u === 'lm') return 'length';
  if (COUNT_UNITS.includes(u)) return 'count';
  return 'area';
}

/** Rows the bridge sent, checked one by one: a row that is broken or has no quantity is left out */
export function readBridgeRows(raw: unknown[]): { rows: ArchicadRow[]; dropped: number } {
  const rows: ArchicadRow[] = [];
  let dropped = 0;
  for (const r of raw) {
    const p = rowSchema.safeParse(r);
    if (!p.success || !p.data.description.trim() || !Number.isFinite(p.data.qty) || p.data.qty <= 0) {
      dropped++;
      continue;
    }
    const d = p.data;
    rows.push({
      category: (d.category.trim() || 'ไม่ระบุหมวด').slice(0, 200),
      description: d.description.trim().slice(0, 1000),
      kind: kindOfUnit(d.unit),
      unit: d.unit.trim().slice(0, 50),
      qty: Math.round(d.qty * 1000) / 1000,
      note: (d.note || 'ปริมาณจากโมเดล Archicad').slice(0, 500),
    });
  }
  return { rows, dropped };
}
