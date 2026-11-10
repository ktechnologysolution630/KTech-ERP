/** Work categories a stock item can belong to; the item form offers exactly these. */
export const STOCK_CATEGORIES = [
  'งานโครงสร้าง',
  'งานสถาปัตยกรรม',
  'งานสุขาภิบาล',
  'งานระบบไฟฟ้าและสื่อสาร',
  'งานระบบปรับอากาศ',
  'ครุภัณฑ์',
  'อื่น',
] as const;

export type StockCategory = (typeof STOCK_CATEGORIES)[number];

/** Category for items created without one (e.g. from goods received against a PO). */
export const DEFAULT_STOCK_CATEGORY: StockCategory = 'อื่น';
