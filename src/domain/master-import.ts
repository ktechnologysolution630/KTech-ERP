import type { BoqSheetCell, BoqSheetGrid } from './boq-import';

export interface VendorImportRow {
  name: string;
  type: 'COMPANY' | 'INDIVIDUAL';
  taxId: string | null;
  branch: string;
  address: string;
  phone: string;
}

export interface ItemImportRow {
  code: string;
  name: string;
  /** Null when no purchase order in the file says what the item is counted in */
  unitName: string | null;
}

export interface MasterWorkbookResult {
  vendors: VendorImportRow[];
  items: ItemImportRow[];
  /** Tax ids that are not valid even with the lost zeros put back; the vendor goes in without one, by sheet row */
  invalidTaxIds: string[];
  skippedVendors: string[];
  skippedItems: string[];
  /** Vendors whose fax or e-mail is left behind, because the system has nowhere to keep them */
  vendorsWithUnkeptContact: number;
  itemsWithoutUnit: number;
  itemsWithSeveralUnits: number;
  poSheetsRead: number;
}

/** Used until someone sets the real unit: an item must have one, and a wrong guess would look like a fact. */
export const UNKNOWN_UNIT = 'ไม่ระบุ';

const MAX_NAME = 300;
const MAX_ITEM_CODE = 50;
const MAX_ADDRESS = 500;
const MAX_UNIT = 50;
const MAX_LISTED_ROWS = 50;

const textOf = (cell: BoqSheetCell | null | undefined): string => (cell ? String(cell.v).replace(/\s+/g, ' ').trim() : '');
/** The sheets write "-" for "nothing here" */
const filled = (text: string) => (/^-*$/.test(text) ? '' : text);

/** The check digit every Thai tax id carries, so a mistyped one can be told from a real one. */
export function isValidTaxId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const total = [...id.slice(0, 12)].reduce((sum, digit, i) => sum + Number(digit) * (13 - i), 0);
  return (11 - (total % 11)) % 10 === Number(id[12]);
}

/** Excel keeps a tax id as a number when it is typed as one, which drops the zeros in front of every company's. */
function readTaxId(raw: string): { id: string | null; invalid: boolean } {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { id: null, invalid: false };
  const id = digits.padStart(13, '0');
  return isValidTaxId(id) ? { id, invalid: false } : { id: null, invalid: true };
}

const isCompanyName = (name: string) => /บริษัท|บจก|หจก|ห้างหุ้นส่วน|จำกัด/.test(name);
const isPersonName = (name: string) => /^(นางสาว|นาง|นาย|น\.ส\.|Mr\.?\s|Mrs\.?\s|Miss\s|Ms\.?\s)/i.test(name);

/** Decides which withholding form applies: the name says it when it can, and otherwise a company's tax id starts with 0. */
function vendorType(name: string, taxId: string | null): VendorImportRow['type'] {
  if (isCompanyName(name)) return 'COMPANY';
  if (isPersonName(name)) return 'INDIVIDUAL';
  return taxId && taxId[0] !== '0' ? 'INDIVIDUAL' : 'COMPANY';
}

/** "(สาขาที่ 00012)" names a branch; anything else, including "สำนักงานใหญ่", is the head office. */
function branchOf(text: string): string {
  return /สาขาที่\s*(\d{5})/.exec(text)?.[1] ?? '00000';
}

const headerColumns = (sheet: BoqSheetGrid): Map<string, number> => {
  const entries = (sheet.rows[0] ?? []).map((cell, c) => [textOf(cell).toUpperCase(), c] as const);
  // The first column of a name wins: these sheets repeat helper columns to the right
  return new Map(entries.filter(([name]) => name).reverse());
};

function readVendors(sheet: BoqSheetGrid, result: MasterWorkbookResult): void {
  const columns = headerColumns(sheet);
  const at = (row: BoqSheetGrid['rows'][number], name: string) => {
    const c = columns.get(name);
    return c === undefined ? '' : filled(textOf(row[c]));
  };
  const seen = new Set<string>();
  sheet.rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    const name = at(row ?? [], 'VENDOR').slice(0, MAX_NAME);
    if (!name) return;
    if (seen.has(name)) {
      result.skippedVendors.push(`แถว ${rowNumber}: ${name} ซ้ำกับแถวก่อนหน้า`);
      return;
    }
    seen.add(name);
    const addressLines = [at(row, 'ADDRESS 1'), at(row, 'ADDRESS 2')].filter(Boolean);
    const { id, invalid } = readTaxId(at(row, 'TAX ID'));
    if (invalid) result.invalidTaxIds.push(`แถว ${rowNumber}: ${name}`);
    if (at(row, 'FAX') || at(row, 'E-MAIL')) result.vendorsWithUnkeptContact += 1;
    result.vendors.push({
      name,
      type: vendorType(name, id),
      taxId: id,
      branch: branchOf(`${name} ${addressLines.join(' ')}`),
      address: addressLines.join(' ').slice(0, MAX_ADDRESS),
      phone: [at(row, 'TEL'), at(row, 'MOBILE')].filter(Boolean).join(', '),
    });
  });
}

/** Items carry no unit of their own, but the purchase orders in the same file say what each was bought in. */
function unitsFromPurchaseOrders(sheets: BoqSheetGrid[], result: MasterWorkbookResult): Map<string, Map<string, number>> {
  const units = new Map<string, Map<string, number>>();
  for (const sheet of sheets) {
    const headerRow = sheet.rows.findIndex((row) => {
      const cells = (row ?? []).map(textOf);
      return cells.includes('รหัสสินค้า') && cells.includes('หน่วย');
    });
    if (headerRow < 0) continue;
    const header = (sheet.rows[headerRow] ?? []).map(textOf);
    const codeColumn = header.indexOf('รหัสสินค้า');
    const unitColumn = header.indexOf('หน่วย');
    result.poSheetsRead += 1;
    for (const row of sheet.rows.slice(headerRow + 1)) {
      const code = textOf(row?.[codeColumn]);
      const unit = textOf(row?.[unitColumn]).slice(0, MAX_UNIT);
      if (!code || !unit) continue;
      const counts = units.get(code) ?? new Map<string, number>();
      counts.set(unit, (counts.get(unit) ?? 0) + 1);
      units.set(code, counts);
    }
  }
  return units;
}

function readItems(sheet: BoqSheetGrid, poSheets: BoqSheetGrid[], result: MasterWorkbookResult): void {
  const columns = headerColumns(sheet);
  const codeColumn = columns.get('รหัสสินค้า')!;
  const nameColumn = columns.get('รายการสินค้า')!;
  const units = unitsFromPurchaseOrders(poSheets, result);
  const seen = new Set<string>();
  sheet.rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    const code = textOf(row?.[codeColumn]);
    const name = textOf(row?.[nameColumn]).slice(0, MAX_NAME);
    if (!code && !name) return;
    if (!code || !name) {
      result.skippedItems.push(`แถว ${rowNumber}: ${code || name} ${code ? 'ไม่มีชื่อสินค้า' : 'ไม่มีรหัสสินค้า'}`);
      return;
    }
    if (code.length > MAX_ITEM_CODE) {
      result.skippedItems.push(`แถว ${rowNumber}: รหัส ${code.slice(0, 20)}... ยาวเกินไป`);
      return;
    }
    if (seen.has(code)) {
      result.skippedItems.push(`แถว ${rowNumber}: รหัส ${code} ซ้ำกับแถวก่อนหน้า`);
      return;
    }
    seen.add(code);
    const counts = units.get(code);
    if (!counts) result.itemsWithoutUnit += 1;
    else if (counts.size > 1) result.itemsWithSeveralUnits += 1;
    // The unit used most often; a tie goes to the one written first, so the same file always reads the same way
    const unitName = counts ? [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0] : null;
    result.items.push({ code, name, unitName });
  });
}

const hasColumns = (sheet: BoqSheetGrid, names: string[]) => {
  const columns = headerColumns(sheet);
  return names.every((name) => columns.has(name));
};

/** Finds the vendor and item lists of a purchase order workbook by their headings, wherever the sheets sit in it. */
export function parseMasterWorkbook(sheets: BoqSheetGrid[]): MasterWorkbookResult {
  const result: MasterWorkbookResult = {
    vendors: [],
    items: [],
    invalidTaxIds: [],
    skippedVendors: [],
    skippedItems: [],
    vendorsWithUnkeptContact: 0,
    itemsWithoutUnit: 0,
    itemsWithSeveralUnits: 0,
    poSheetsRead: 0,
  };
  const vendorSheet = sheets.find((s) => hasColumns(s, ['VENDOR', 'TAX ID']));
  const itemSheet = sheets.find((s) => hasColumns(s, ['รหัสสินค้า', 'รายการสินค้า']));
  if (vendorSheet) readVendors(vendorSheet, result);
  if (itemSheet) readItems(itemSheet, sheets.filter((s) => s !== itemSheet && s !== vendorSheet), result);
  result.invalidTaxIds = result.invalidTaxIds.slice(0, MAX_LISTED_ROWS);
  return result;
}
