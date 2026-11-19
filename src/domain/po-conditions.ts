/**
 * The company's standing conditions, printed at the foot of every PO beside the signatures and shown
 * in the same box on the PO form. A vendor's own billing and cheque schedule stays on the PO record;
 * neither shows it.
 */
export const PO_CONDITIONS: string[] = [
  '1. โปรดระบุเลขที่ใบสั่งซื้อข้างต้น ในใบส่งของฉบับ',
  '2. การวางบิลและการรับเช็ค เป็นไปตามที่กำหนดเวลาที่บริษัท กำหนดไว้',
  '2.1 การวางบิลวันที่ 20-25 ของเดือน',
  '2.2 รับเช็ค สำหรับ Supplier วันที่ 30 ของเดือน',
  '2.3 รับเช็ค สำหรับผู้รับเหมา วันที่ 15 และ 30 ของเดือน',
  '3. การวางบิลเพื่อเรียกเก็บเงิน ให้แนบสำเนาใบสั่งซื้อกำกับมาด้วย',
];

/** A sub-item such as 2.1, set in under its parent */
export function isSubCondition(line: string): boolean {
  return /^\d+\.\d+\s/.test(line);
}
