/** The billing conditions at the foot of every purchase order, on screen and on the printed copy */
export const PO_CONDITIONS: readonly { text: string; indented?: boolean }[] = [
  { text: '1. โปรดระบุเลขที่ใบสั่งซื้อข้างต้น ในใบส่งของทุกฉบับ' },
  { text: '2. การวางบิลและการรับเช็ค เป็นไปตามกำหนดเวลาที่บริษัทฯ กำหนดไว้' },
  { text: '2.1 วางบิลวันที่ 20 - 25 ของเดือน', indented: true },
  { text: '2.2 รับเช็ค สำหรับ Supplier วันที่ 30 ของเดือน', indented: true },
  { text: '2.3 รับเช็ค สำหรับผู้รับเหมา วันที่ 15 และ 30 ของเดือน', indented: true },
  { text: '3. การวางบิลเพื่อเรียกเก็บเงิน ให้แนบสำเนาใบสั่งซื้อกำกับมาด้วย' },
];

/** What the supplier agrees to by taking the order, printed above its lines */
export const PO_SUPPLIER_CLAUSE =
  '(ผู้ขายจะต้องส่งสินค้าให้เป็นไปตามเงื่อนไขที่ได้เสนอราคาไว้กับบริษัทฯ ดังต่อไปนี้) Supplier shall supply the following items in good order and condition as per quotation namely';
