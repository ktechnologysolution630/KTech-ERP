/**
 * Matching BOQ units to the units of the item register (ทะเบียนสินค้า).
 *
 * A BOQ often spells a unit differently from the register ("ตารางเมตร", "ม2" or "m2" for "ตร.ม.").
 * Only spellings of the same unit are matched, so changing one never changes what a quantity means.
 * A unit of another kind (ตัน vs กก.) is never converted: it is reported for a person to check.
 */

/** Spellings of one unit; the register's own spelling wins when it is in the group. */
const UNIT_ALIASES: readonly (readonly string[])[] = [
  ['ตร.ม.', 'ตร.ม', 'ตรม.', 'ตรม', 'ตารางเมตร', 'ม2', 'ม.2', 'ม²', 'm2', 'm²', 'sq.m', 'sq.m.', 'sqm', 'ตร.เมตร'],
  ['ลบ.ม.', 'ลบ.ม', 'ลบม.', 'ลบม', 'ลูกบาศก์เมตร', 'ม3', 'ม.3', 'ม³', 'm3', 'm³', 'cu.m', 'cu.m.', 'คิว'],
  ['ม.', 'ม', 'เมตร', 'm', 'm.', 'เมตรยาว', 'ม.ยาว'],
  ['ซม.', 'ซม', 'เซนติเมตร', 'cm', 'cm.'],
  ['มม.', 'มม', 'มิลลิเมตร', 'mm', 'mm.'],
  ['ตร.ว.', 'ตร.ว', 'ตารางวา', 'ตรว.'],
  ['กก.', 'กก', 'กิโลกรัม', 'กิโล', 'kg', 'kg.', 'kgs'],
  ['ตัน', 'ton', 'tons', 't'],
  ['ลิตร', 'ล.', 'l', 'lit', 'liter', 'litre'],
  ['ชิ้น', 'pcs', 'pcs.', 'pc', 'pc.', 'piece', 'ea', 'ea.', 'each'],
  ['ชุด', 'set', 'sets', 'st'],
  ['ตัว', 'no.', 'nos', 'nos.'],
  ['แผ่น', 'sheet', 'sheets', 'sht'],
  ['เส้น', 'ท่อน'],
  ['ถุง', 'bag', 'bags', 'กระสอบ'],
  ['กล่อง', 'box', 'boxes', 'ลัง'],
  ['ม้วน', 'roll', 'rolls'],
  ['แกลลอน', 'แกลอน', 'gallon', 'gal'],
  ['ถัง', 'pail', 'drum'],
  ['จุด', 'point', 'pts', 'pt'],
  ['งาน', 'เหมา', 'ls', 'l.s.', 'l.s', 'lump sum', 'lumpsum', 'job'],
  ['วัน', 'day', 'days'],
  ['เดือน', 'month', 'months'],
  ['คน', 'man', 'person'],
];

/** Spacing and case never make a unit different. */
export function unitKey(unit: string): string {
  return unit.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

const GROUP_OF = new Map<string, number>();
UNIT_ALIASES.forEach((group, i) => group.forEach((u) => GROUP_OF.set(unitKey(u), i)));
/** Also match with every dot and space taken out ("ตร ม", "ตร.ม .") */
const looseKey = (unit: string) => unitKey(unit).replace(/[.\s]/g, '');
UNIT_ALIASES.forEach((group, i) =>
  group.forEach((u) => {
    if (!GROUP_OF.has(looseKey(u))) GROUP_OF.set(looseKey(u), i);
  }),
);

function groupOf(unit: string): number | undefined {
  return GROUP_OF.get(unitKey(unit)) ?? GROUP_OF.get(looseKey(unit));
}

/** Two spellings of the same unit */
export function sameUnit(a: string, b: string): boolean {
  if (unitKey(a) === unitKey(b)) return true;
  const ga = groupOf(a);
  return ga !== undefined && ga === groupOf(b);
}

/**
 * The register's spelling of a unit, or null when the register has no unit of that kind.
 * An exact match always wins over a spelling from the alias list.
 */
export function registerUnitFor(unit: string, registerUnits: readonly string[]): string | null {
  const key = unitKey(unit);
  if (!key) return null;
  const exact = registerUnits.find((u) => unitKey(u) === key);
  if (exact !== undefined) return exact;
  const g = groupOf(unit);
  if (g === undefined) return null;
  return registerUnits.find((u) => groupOf(u) === g) ?? null;
}

/** Item names are compared the way people type them: spacing and case do not count. */
export function itemNameKey(name: string): string {
  return unitKey(name);
}

export interface UnitReference {
  /** Unit names of the item register */
  units: string[];
  /** Item name key → the item's unit */
  itemUnits: Record<string, string>;
}

export type BoqUnitStatus =
  /** Unit is written as in the register (or the row has no unit to check) */
  | { kind: 'ok' }
  /** Same unit spelled differently: can be changed to the register's spelling */
  | { kind: 'respell'; to: string }
  /** The register has no such unit */
  | { kind: 'unknown' }
  /** The row names a register item counted in a unit of another kind: a person must check */
  | { kind: 'item-differs'; itemUnit: string };

/** How a BOQ row's unit stands against the register */
export function boqUnitStatus(row: { description: string; unit: string; isCategory?: boolean }, ref: UnitReference): BoqUnitStatus {
  if (row.isCategory || !unitKey(row.unit)) return { kind: 'ok' };
  const itemUnit = ref.itemUnits[itemNameKey(row.description)];
  if (itemUnit !== undefined) {
    if (unitKey(itemUnit) === unitKey(row.unit)) return { kind: 'ok' };
    if (sameUnit(itemUnit, row.unit)) return { kind: 'respell', to: itemUnit };
    return { kind: 'item-differs', itemUnit };
  }
  const to = registerUnitFor(row.unit, ref.units);
  if (to === null) return { kind: 'unknown' };
  return unitKey(to) === unitKey(row.unit) && to === row.unit.trim() ? { kind: 'ok' } : { kind: 'respell', to };
}

export interface AlignResult<R> {
  rows: R[];
  /** Rows whose unit was respelled */
  changed: number;
  /** Rows left as they were because the register has no such unit */
  unknown: number;
  /** Rows left as they were because their item is counted in a unit of another kind */
  itemDiffers: number;
}

/** Respell every BOQ unit the register knows under another spelling; quantities are never touched. */
export function alignBoqUnits<R extends { description: string; unit: string; isCategory?: boolean }>(
  rows: R[],
  ref: UnitReference,
): AlignResult<R> {
  let changed = 0;
  let unknown = 0;
  let itemDiffers = 0;
  const out = rows.map((r) => {
    const s = boqUnitStatus(r, ref);
    if (s.kind === 'respell') {
      changed++;
      return { ...r, unit: s.to };
    }
    if (s.kind === 'unknown') unknown++;
    if (s.kind === 'item-differs') itemDiffers++;
    return r;
  });
  return { rows: out, changed, unknown, itemDiffers };
}
