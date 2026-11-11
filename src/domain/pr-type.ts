/** The three requisition forms */
export type PrType = 'GOODS' | 'LABOR' | 'GOODS_AND_LABOR';
export const PR_TYPES: readonly PrType[] = ['GOODS', 'LABOR', 'GOODS_AND_LABOR'];
/** What a line asks for; a combined requisition has both */
export type PrLineKind = 'GOODS' | 'LABOR';

export const PR_TYPE_META: Record<PrType, { label: string; short: string; titleTh: string; titleEn: string; hint: string; priced: boolean }> = {
  GOODS: {
    label: 'ขอซื้อสินค้า (ไม่มีราคา)',
    short: 'สั่งสินค้า',
    titleTh: 'ใบขอซื้อ',
    titleEn: 'PURCHASE REQUISITION',
    hint: 'หน้างานแจ้งรายการและจำนวนที่ต้องการ ฝ่ายจัดซื้อเป็นผู้หาราคา',
    priced: false,
  },
  LABOR: {
    label: 'ขอจ้างช่าง (มีราคา)',
    short: 'จ้างช่าง',
    titleTh: 'ใบขอจ้างช่าง',
    titleEn: 'LABOR HIRE REQUISITION',
    hint: 'ขออนุมัติจ้างช่างหรือผู้รับเหมา ระบุงาน ปริมาณ และค่าจ้าง',
    priced: true,
  },
  GOODS_AND_LABOR: {
    label: 'ขอซื้อและจ้างทำงาน',
    short: 'ซื้อและจ้าง',
    titleTh: 'ใบขอซื้อและจ้างทำงาน',
    titleEn: 'PURCHASE AND WORK REQUISITION',
    hint: 'งานที่ต้องซื้อของและจ้างทำในใบเดียว แยกรายการสินค้าและรายการค่าแรง',
    priced: true,
  },
};

export const LINE_KIND_LABEL: Record<PrLineKind, string> = { GOODS: 'สินค้า / วัสดุ', LABOR: 'จ้างทำงาน / ค่าแรง' };

/**
 * Who signs each form. On the goods form the person asking also writes the document, so the two
 * share one box.
 */
export const prSignatures = (type: PrType): string[] =>
  type === 'GOODS' ? ['ผู้ขอซื้อ / ผู้จัดทำ', 'ผู้อนุมัติ'] : [type === 'LABOR' ? 'ผู้ขอจ้าง' : 'ผู้ขอซื้อ', 'ผู้จัดทำ', 'ผู้อนุมัติ'];

export const isPrType =(v: unknown): v is PrType => PR_TYPES.includes(v as PrType);
