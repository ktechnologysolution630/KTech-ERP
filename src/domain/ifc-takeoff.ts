import type { ArchicadRow } from './archicad-bridge';
import { kindOfUnit } from './archicad-bridge';

/**
 * Quantities from an IFC file (the open BIM exchange format Archicad, Revit and others export).
 * The file is read in the browser: the STEP text is parsed just enough to find building elements,
 * the quantities attached to them (Qto_… base quantities or numeric properties), their material and
 * their type, and the same kinds of elements are added up into BOQ lines.
 */

/* ------------------------------------------------------------------------------------------------
 * STEP (ISO 10303-21) reading
 * ---------------------------------------------------------------------------------------------- */

export type StepValue = string | number | boolean | null | StepRef | StepEnum | StepValue[] | StepTyped;
export interface StepRef {
  ref: number;
}
export interface StepEnum {
  enum: string;
}
export interface StepTyped {
  type: string;
  value: StepValue;
}
export interface StepEntity {
  id: number;
  type: string;
  args: StepValue[];
}

const isRef = (v: StepValue): v is StepRef => typeof v === 'object' && v !== null && !Array.isArray(v) && 'ref' in v;
const isEnum = (v: StepValue): v is StepEnum => typeof v === 'object' && v !== null && !Array.isArray(v) && 'enum' in v;
const isTyped = (v: StepValue): v is StepTyped => typeof v === 'object' && v !== null && !Array.isArray(v) && 'type' in v;

/** Text in a STEP string: '' is a quote, \X2\…\X0\ is UTF-16 hex (Thai), \X\hh is one Latin-1 byte, \S\c is c+128 */
export function decodeStepString(s: string): string {
  return s
    .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) => {
      let out = '';
      for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
      return out;
    })
    .replace(/\\X4\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) => {
      let out = '';
      for (let i = 0; i + 8 <= hex.length; i += 8) out += String.fromCodePoint(parseInt(hex.slice(i, i + 8), 16));
      return out;
    })
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128))
    .replace(/\\\\/g, '\\');
}

class ArgReader {
  i = 0;
  constructor(private readonly s: string) {}

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }

  list(): StepValue[] {
    // at '('
    this.i++;
    const out: StepValue[] = [];
    this.ws();
    if (this.s[this.i] === ')') {
      this.i++;
      return out;
    }
    for (;;) {
      out.push(this.value());
      this.ws();
      const c = this.s[this.i];
      this.i++;
      if (c === ')') return out;
      if (c !== ',') throw new Error('bad list');
    }
  }

  value(): StepValue {
    this.ws();
    const c = this.s[this.i];
    if (c === '(') return this.list();
    if (c === "'") {
      let j = this.i + 1;
      let raw = '';
      for (;;) {
        const k = this.s.indexOf("'", j);
        if (k < 0) throw new Error('bad string');
        raw += this.s.slice(j, k);
        if (this.s[k + 1] === "'") {
          raw += "'";
          j = k + 2;
          continue;
        }
        this.i = k + 1;
        break;
      }
      return decodeStepString(raw);
    }
    if (c === '#') {
      const m = /^#(\d+)/.exec(this.s.slice(this.i, this.i + 20))!;
      this.i += m[0].length;
      return { ref: Number(m[1]) };
    }
    if (c === '$' || c === '*') {
      this.i++;
      return null;
    }
    if (c === '.') {
      const k = this.s.indexOf('.', this.i + 1);
      const e = this.s.slice(this.i + 1, k);
      this.i = k + 1;
      if (e === 'T') return true;
      if (e === 'F') return false;
      return { enum: e };
    }
    const typed = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i, this.i + 80));
    if (typed) {
      this.i += typed[0].length;
      this.ws();
      const inner = this.list();
      return { type: typed[0].toUpperCase(), value: inner.length === 1 ? inner[0]! : inner };
    }
    const num = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(this.s.slice(this.i, this.i + 40));
    if (num) {
      this.i += num[0].length;
      return Number(num[0]);
    }
    throw new Error(`bad value at ${this.i}`);
  }
}

/** Every entity in the DATA section, by id. Lines that cannot be read are skipped. */
export function parseStep(text: string): Map<number, StepEntity> {
  const out = new Map<number, StepEntity>();
  const start = text.search(/\bDATA\s*;/);
  if (start < 0) return out;
  let i = text.indexOf(';', start) + 1;
  const n = text.length;
  while (i < n) {
    // Find the end of the statement: a ';' outside a string
    let j = i;
    let inStr = false;
    for (; j < n; j++) {
      const c = text.charCodeAt(j);
      if (c === 39) inStr = !inStr; // '
      else if (c === 59 && !inStr) break; // ;
    }
    const stmt = text.slice(i, j).trim();
    i = j + 1;
    if (stmt === 'ENDSEC') break;
    const m = /^#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/.exec(stmt);
    if (!m) continue;
    try {
      const r = new ArgReader(stmt);
      r.i = m[0].length - 1;
      out.set(Number(m[1]), { id: Number(m[1]), type: m[2]!.toUpperCase(), args: r.list() });
    } catch {
      // a line this reader does not understand is left out
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * IFC model
 * ---------------------------------------------------------------------------------------------- */

const str = (v: StepValue | undefined): string => {
  if (typeof v === 'string') return v.trim();
  if (v && isTyped(v)) return str(v.value);
  return '';
};
const num = (v: StepValue | undefined): number | null => {
  if (typeof v === 'number') return v;
  if (v && isTyped(v)) return num(v.value);
  return null;
};
const refs = (v: StepValue | undefined): number[] => (Array.isArray(v) ? v.filter(isRef).map((r) => r.ref) : v && isRef(v) ? [v.ref] : []);

const PREFIX: Record<string, number> = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9 };

/** Multipliers that turn the file's length, area and volume units into metres, m² and m³ */
function unitScales(ents: Map<number, StepEntity>) {
  const scale = { LENGTHUNIT: 1, AREAUNIT: 1, VOLUMEUNIT: 1 };
  const seen = { LENGTHUNIT: false, AREAUNIT: false, VOLUMEUNIT: false };
  for (const e of ents.values()) {
    if (e.type !== 'IFCUNITASSIGNMENT') continue;
    for (const id of refs(e.args[0])) {
      const u = ents.get(id);
      if (!u) continue;
      let kind = '';
      let factor = 1;
      if (u.type === 'IFCSIUNIT') {
        kind = isEnum(u.args[1]!) ? u.args[1].enum : '';
        const p = u.args[2] && isEnum(u.args[2]) ? PREFIX[u.args[2].enum] ?? 1 : 1;
        factor = kind === 'AREAUNIT' ? p * p : kind === 'VOLUMEUNIT' ? p * p * p : p;
      } else if (u.type === 'IFCCONVERSIONBASEDUNIT') {
        kind = u.args[1] && isEnum(u.args[1]) ? u.args[1].enum : '';
        const mwu = ents.get(refs(u.args[3])[0] ?? -1);
        const v = mwu ? num(mwu.args[0]) : null;
        const base = mwu ? ents.get(refs(mwu.args[1])[0] ?? -1) : undefined;
        const bp = base?.type === 'IFCSIUNIT' && base.args[2] && isEnum(base.args[2]) ? PREFIX[base.args[2].enum] ?? 1 : 1;
        factor = (v ?? 1) * (kind === 'AREAUNIT' ? bp * bp : kind === 'VOLUMEUNIT' ? bp * bp * bp : bp);
      }
      if (kind in scale && !seen[kind as keyof typeof scale]) {
        scale[kind as keyof typeof scale] = factor;
        seen[kind as keyof typeof scale] = true;
      }
    }
  }
  return scale;
}

type Measure = 'length' | 'area' | 'volume' | 'count';
const MEASURE_OF: Record<string, Measure> = {
  IFCQUANTITYLENGTH: 'length',
  IFCQUANTITYAREA: 'area',
  IFCQUANTITYVOLUME: 'volume',
  IFCQUANTITYCOUNT: 'count',
};
const TYPED_MEASURE: Record<string, Measure> = {
  IFCLENGTHMEASURE: 'length',
  IFCPOSITIVELENGTHMEASURE: 'length',
  IFCAREAMEASURE: 'area',
  IFCVOLUMEMEASURE: 'volume',
  IFCCOUNTMEASURE: 'count',
};

/** Quantity names compared without case, spaces or punctuation: "Net Volume" = "NetVolume" */
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface IfcElement {
  id: number;
  type: string;
  name: string;
  /** IfcSpace: long name such as "ห้องนอน 1" */
  longName: string;
  predefined: string;
  typeName: string;
  material: string;
  /** Quantity name (key) -> value in m, m², m³ or count */
  qty: Map<string, number>;
  /** Made of other elements in the file (a roof made of roof slabs): its parts are counted instead */
  decomposed: boolean;
}

function materialName(ents: Map<number, StepEntity>, id: number, depth = 0): string {
  const m = ents.get(id);
  if (!m || depth > 4) return '';
  switch (m.type) {
    case 'IFCMATERIAL':
      return str(m.args[0]);
    case 'IFCMATERIALLAYERSETUSAGE':
    case 'IFCMATERIALPROFILESETUSAGE':
      return materialName(ents, refs(m.args[0])[0] ?? -1, depth + 1);
    case 'IFCMATERIALLAYERSET': {
      const own = str(m.args[1]);
      if (own) return own;
      return uniqueJoin(refs(m.args[0]).map((l) => materialName(ents, l, depth + 1)));
    }
    case 'IFCMATERIALLAYER':
    case 'IFCMATERIALPROFILE':
      return materialName(ents, refs(m.type === 'IFCMATERIALLAYER' ? m.args[0] : m.args[2])[0] ?? -1, depth + 1);
    case 'IFCMATERIALPROFILESET': {
      const own = str(m.args[0]);
      if (own) return own;
      return uniqueJoin(refs(m.args[2]).map((p) => materialName(ents, p, depth + 1)));
    }
    case 'IFCMATERIALLIST':
      return uniqueJoin(refs(m.args[0]).map((x) => materialName(ents, x, depth + 1)));
    case 'IFCMATERIALCONSTITUENTSET': {
      const own = str(m.args[0]);
      if (own) return own;
      return uniqueJoin(refs(m.args[2]).map((x) => materialName(ents, x, depth + 1)));
    }
    case 'IFCMATERIALCONSTITUENT':
      return materialName(ents, refs(m.args[2])[0] ?? -1, depth + 1);
    default:
      return '';
  }
}
const uniqueJoin = (xs: string[]) => [...new Set(xs.filter(Boolean))].join(' + ');

const ELEMENT_TYPES = new Set([
  'IFCWALL',
  'IFCWALLSTANDARDCASE',
  'IFCWALLELEMENTEDCASE',
  'IFCSLAB',
  'IFCSLABSTANDARDCASE',
  'IFCCOLUMN',
  'IFCCOLUMNSTANDARDCASE',
  'IFCBEAM',
  'IFCBEAMSTANDARDCASE',
  'IFCROOF',
  'IFCDOOR',
  'IFCDOORSTANDARDCASE',
  'IFCWINDOW',
  'IFCWINDOWSTANDARDCASE',
  'IFCSTAIR',
  'IFCSTAIRFLIGHT',
  'IFCRAILING',
  'IFCCOVERING',
  'IFCSPACE',
  'IFCFOOTING',
  'IFCPILE',
  'IFCCURTAINWALL',
]);

/** Building elements with their quantities, material and type */
export function readIfcElements(ents: Map<number, StepEntity>): IfcElement[] {
  const scale = unitScales(ents);
  const els = new Map<number, IfcElement>();
  for (const e of ents.values()) {
    if (!ELEMENT_TYPES.has(e.type)) continue;
    // IfcSpace: LongName at 7; IfcElement: Tag at 7, PredefinedType at 8 (IFC4)
    const pre = e.args[8];
    els.set(e.id, {
      id: e.id,
      type: e.type.replace(/STANDARDCASE$|ELEMENTEDCASE$/, ''),
      name: str(e.args[2]),
      longName: e.type === 'IFCSPACE' ? str(e.args[7]) : '',
      predefined: pre && isEnum(pre) ? pre.enum : '',
      typeName: str(e.args[4]),
      material: '',
      qty: new Map(),
      decomposed: false,
    });
  }

  const scaleOf = (m: Measure) => (m === 'length' ? scale.LENGTHUNIT : m === 'area' ? scale.AREAUNIT : m === 'volume' ? scale.VOLUMEUNIT : 1);

  const setsOf = new Map<number, number[]>(); // property definition -> elements
  for (const e of ents.values()) {
    if (e.type === 'IFCRELDEFINESBYPROPERTIES') {
      const objs = refs(e.args[4]).filter((id) => els.has(id));
      if (!objs.length) continue;
      for (const def of refs(e.args[5])) setsOf.set(def, [...(setsOf.get(def) ?? []), ...objs]);
    } else if (e.type === 'IFCRELDEFINESBYTYPE') {
      const t = ents.get(refs(e.args[5])[0] ?? -1);
      const name = t ? str(t.args[2]) : '';
      if (!name) continue;
      for (const id of refs(e.args[4])) {
        const el = els.get(id);
        if (el) el.typeName = name;
      }
    } else if (e.type === 'IFCRELAGGREGATES') {
      const whole = els.get(refs(e.args[4])[0] ?? -1);
      if (whole && refs(e.args[5]).some((id) => els.has(id))) whole.decomposed = true;
    } else if (e.type === 'IFCRELASSOCIATESMATERIAL') {
      const name = materialName(ents, refs(e.args[5])[0] ?? -1);
      if (!name) continue;
      for (const id of refs(e.args[4])) {
        const el = els.get(id);
        if (el && !el.material) el.material = name;
      }
    }
  }

  for (const [defId, objs] of setsOf) {
    const def = ents.get(defId);
    if (!def) continue;
    const put = (name: string, value: number) => {
      const k = key(name);
      for (const id of objs) {
        const el = els.get(id)!;
        // Base quantities (Qto_…) come first in most files; a later property set does not replace them
        if (!el.qty.has(k)) el.qty.set(k, value);
      }
    };
    if (def.type === 'IFCELEMENTQUANTITY') {
      for (const qid of refs(def.args[5])) {
        const q = ents.get(qid);
        const m = q && MEASURE_OF[q.type];
        const v = q ? num(q.args[3]) : null;
        if (q && m && v !== null) put(str(q.args[0]), v * scaleOf(m));
      }
    } else if (def.type === 'IFCPROPERTYSET') {
      for (const pid of refs(def.args[4])) {
        const p = ents.get(pid);
        if (p?.type !== 'IFCPROPERTYSINGLEVALUE') continue;
        const v = p.args[2];
        if (!v || !isTyped(v)) continue;
        const m = TYPED_MEASURE[v.type];
        const n = num(v);
        if (m && n !== null) put(str(p.args[0]), n * scaleOf(m));
      }
    }
  }
  return [...els.values()];
}

/* ------------------------------------------------------------------------------------------------
 * BOQ lines
 * ---------------------------------------------------------------------------------------------- */

interface Rule {
  category: string;
  types: string[];
  /** IfcSlab: only these predefined types (FLOOR, ROOF, BASESLAB…); '!ROOF' means anything but ROOF */
  predefined?: string;
  item: string;
  /** Quantity names tried in order; COUNT counts the elements */
  qty: string[] | 'COUNT';
  unit: string;
  group?: 'material' | 'type' | 'space';
}

const RULES: Rule[] = [
  { category: 'งานโครงสร้าง', types: ['IFCFOOTING'], item: 'คอนกรีตฐานราก', qty: ['NetVolume', 'GrossVolume', 'Volume'], unit: 'ลบ.ม.' },
  { category: 'งานโครงสร้าง', types: ['IFCPILE'], item: 'เสาเข็ม {group}', qty: 'COUNT', unit: 'ต้น', group: 'type' },
  { category: 'งานโครงสร้าง', types: ['IFCCOLUMN'], item: 'คอนกรีตเสา', qty: ['NetVolume', 'GrossVolume', 'Volume'], unit: 'ลบ.ม.' },
  { category: 'งานโครงสร้าง', types: ['IFCBEAM'], item: 'คอนกรีตคาน', qty: ['NetVolume', 'GrossVolume', 'Volume'], unit: 'ลบ.ม.' },
  { category: 'งานโครงสร้าง', types: ['IFCSLAB'], predefined: '!ROOF', item: 'คอนกรีตพื้น', qty: ['NetVolume', 'GrossVolume', 'Volume'], unit: 'ลบ.ม.' },
  { category: 'งานพื้น', types: ['IFCSLAB'], predefined: '!ROOF', item: 'ผิวพื้น {group}', qty: ['NetArea', 'GrossArea', 'Area'], unit: 'ตร.ม.', group: 'material' },
  { category: 'งานผนัง', types: ['IFCWALL'], item: 'ผนัง {group}', qty: ['NetSideArea', 'GrossSideArea', 'NetArea', 'Area'], unit: 'ตร.ม.', group: 'material' },
  { category: 'งานผนัง', types: ['IFCWALL'], item: 'ความยาวผนัง {group}', qty: ['Length', 'NetLength'], unit: 'ม.', group: 'material' },
  { category: 'งานผนัง', types: ['IFCCURTAINWALL'], item: 'ผนังกระจก {group}', qty: ['NetSideArea', 'GrossSideArea', 'Area'], unit: 'ตร.ม.', group: 'type' },
  { category: 'งานหลังคา', types: ['IFCROOF'], item: 'หลังคา {group}', qty: ['NetArea', 'GrossArea', 'ProjectedArea', 'Area'], unit: 'ตร.ม.', group: 'material' },
  { category: 'งานหลังคา', types: ['IFCSLAB'], predefined: 'ROOF', item: 'หลังคา {group}', qty: ['NetArea', 'GrossArea', 'Area'], unit: 'ตร.ม.', group: 'material' },
  { category: 'งานผิว', types: ['IFCCOVERING'], item: 'งานผิว {group}', qty: ['NetArea', 'GrossArea', 'Area'], unit: 'ตร.ม.', group: 'material' },
  { category: 'งานประตู-หน้าต่าง', types: ['IFCDOOR'], item: 'ประตู {group}', qty: 'COUNT', unit: 'ชุด', group: 'type' },
  { category: 'งานประตู-หน้าต่าง', types: ['IFCWINDOW'], item: 'หน้าต่าง {group}', qty: 'COUNT', unit: 'ชุด', group: 'type' },
  { category: 'งานบันได', types: ['IFCSTAIR'], item: 'บันได {group}', qty: 'COUNT', unit: 'ชุด', group: 'type' },
  { category: 'งานราวกันตก', types: ['IFCRAILING'], item: 'ราวกันตก {group}', qty: ['Length'], unit: 'ม.', group: 'type' },
  { category: 'พื้นที่ใช้สอย', types: ['IFCSPACE'], item: 'พื้นที่ {group}', qty: ['NetFloorArea', 'GrossFloorArea', 'NetArea', 'Area'], unit: 'ตร.ม.', group: 'space' },
];

const TYPE_LABEL: Record<string, string> = {
  IFCWALL: 'ผนัง',
  IFCSLAB: 'พื้น',
  IFCCOLUMN: 'เสา',
  IFCBEAM: 'คาน',
  IFCROOF: 'หลังคา',
  IFCDOOR: 'ประตู',
  IFCWINDOW: 'หน้าต่าง',
  IFCSTAIR: 'บันได',
  IFCRAILING: 'ราวกันตก',
  IFCCOVERING: 'งานผิว',
  IFCSPACE: 'ห้อง',
  IFCFOOTING: 'ฐานราก',
  IFCPILE: 'เสาเข็ม',
  IFCCURTAINWALL: 'ผนังกระจก',
};

export interface IfcTakeoff {
  rows: ArchicadRow[];
  /** Elements found, by Thai label */
  found: { label: string; count: number }[];
  warnings: string[];
}

/** "ประตู {group}" with group "ประตู D1" reads "ประตู D1", not "ประตู ประตู D1" */
function describe(item: string, group: string) {
  const lead = item.split('{group}')[0]!.trim();
  if (lead && group.startsWith(lead)) return item.replace(`${lead} {group}`, group).trim();
  return item.replace('{group}', group).trim();
}

function predefinedMatches(rule: Rule, el: IfcElement) {
  if (!rule.predefined) return true;
  if (rule.predefined.startsWith('!')) return el.predefined !== rule.predefined.slice(1);
  return el.predefined === rule.predefined;
}

/** BOQ lines from the elements: one line per rule and group, quantities added up */
export function ifcTakeoff(elements: IfcElement[]): IfcTakeoff {
  const rows: ArchicadRow[] = [];
  const warnings: string[] = [];
  for (const rule of RULES) {
    const els = elements.filter((e) => rule.types.includes(e.type) && (!e.decomposed || rule.qty === 'COUNT') && predefinedMatches(rule, e));
    if (!els.length) continue;
    const groups = new Map<string, { qty: number; n: number }>();
    let missing = 0;
    for (const el of els) {
      let q: number | undefined;
      if (rule.qty === 'COUNT') q = 1;
      else for (const name of rule.qty) if ((q = el.qty.get(key(name))) !== undefined) break;
      if (q === undefined || !Number.isFinite(q)) {
        missing++;
        continue;
      }
      const g =
        rule.group === 'material'
          ? el.material
          : rule.group === 'type'
            ? el.typeName || el.name
            : rule.group === 'space'
              ? el.longName || el.name
              : '';
      const name = rule.group ? g || '(ไม่ระบุ)' : '';
      const acc = groups.get(name) ?? { qty: 0, n: 0 };
      acc.qty += q;
      acc.n += 1;
      groups.set(name, acc);
    }
    if (missing) {
      const label = TYPE_LABEL[rule.types[0]!] ?? rule.types[0]!;
      warnings.push(`${rule.item.replace(' {group}', '')}: ${label} ${missing} ชิ้นไม่มีค่าปริมาณในไฟล์ (ตอน export IFC ให้เปิด "Base Quantities")`);
    }
    for (const [g, { qty, n }] of groups) {
      const v = Math.round(qty * 1000) / 1000;
      if (v <= 0) continue;
      rows.push({
        category: rule.category,
        description: describe(rule.item, g).slice(0, 1000),
        kind: kindOfUnit(rule.unit),
        unit: rule.unit,
        qty: v,
        note: `IFC: ${TYPE_LABEL[rule.types[0]!] ?? ''} ${n} ชิ้น`.slice(0, 500),
      });
    }
  }
  const counts = new Map<string, number>();
  for (const e of elements) {
    const label = TYPE_LABEL[e.type] ?? e.type;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return { rows, found: [...counts].map(([label, count]) => ({ label, count })), warnings: [...new Set(warnings)] };
}

/** The whole path: IFC text in, BOQ lines out */
export function readIfc(text: string): IfcTakeoff {
  if (!/ISO-10303-21/.test(text.slice(0, 200))) throw new Error('not an IFC file');
  return ifcTakeoff(readIfcElements(parseStep(text)));
}
