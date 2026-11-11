import { STOCK_CATEGORIES, type StockCategory } from './stock';

/**
 * Item groups under each work category. Item codes are CC-GG-NNN (category, group, running number),
 * so 10-02-004 is in group 10-02.
 */
export const ITEM_GROUPS: readonly { code: string; category: StockCategory; name: string }[] = [
  { code: '10-01', category: 'งานโครงสร้าง', name: 'ปูนซีเมนต์และคอนกรีต' },
  { code: '10-02', category: 'งานโครงสร้าง', name: 'เหล็กเสริม' },
  { code: '10-03', category: 'งานโครงสร้าง', name: 'เหล็กรูปพรรณ' },
  { code: '10-04', category: 'งานโครงสร้าง', name: 'ไม้แบบ นั่งร้าน และค้ำยัน' },
  { code: '10-05', category: 'งานโครงสร้าง', name: 'เสาเข็มและงานฐานราก' },
  { code: '10-06', category: 'งานโครงสร้าง', name: 'มวลรวมและดินถม' },
  { code: '10-07', category: 'งานโครงสร้าง', name: 'น้ำยาและสารผสมคอนกรีต' },
  { code: '10-08', category: 'งานโครงสร้าง', name: 'อุปกรณ์ยึดและงานโครงสร้างอื่น' },
  { code: '20-01', category: 'งานสถาปัตยกรรม', name: 'งานผนังก่อ' },
  { code: '20-02', category: 'งานสถาปัตยกรรม', name: 'งานฉาบและผิวผนัง' },
  { code: '20-03', category: 'งานสถาปัตยกรรม', name: 'งานพื้นและวัสดุปู' },
  { code: '20-04', category: 'งานสถาปัตยกรรม', name: 'งานฝ้าเพดาน' },
  { code: '20-05', category: 'งานสถาปัตยกรรม', name: 'งานหลังคา' },
  { code: '20-06', category: 'งานสถาปัตยกรรม', name: 'ประตูและหน้าต่าง' },
  { code: '20-07', category: 'งานสถาปัตยกรรม', name: 'งานสีและเคลือบผิว' },
  { code: '20-08', category: 'งานสถาปัตยกรรม', name: 'งานตกแต่งและอุปกรณ์ประกอบ' },
  { code: '30-01', category: 'งานสุขาภิบาล', name: 'ท่อและข้อต่อน้ำดี' },
  { code: '30-02', category: 'งานสุขาภิบาล', name: 'ท่อน้ำทิ้งและระบายน้ำ' },
  { code: '30-03', category: 'งานสุขาภิบาล', name: 'สุขภัณฑ์' },
  { code: '30-04', category: 'งานสุขาภิบาล', name: 'ก๊อกน้ำ วาล์ว และอุปกรณ์' },
  { code: '30-05', category: 'งานสุขาภิบาล', name: 'ปั๊มน้ำและถังเก็บน้ำ' },
  { code: '30-06', category: 'งานสุขาภิบาล', name: 'ระบบบำบัดน้ำเสีย' },
  { code: '40-01', category: 'งานระบบไฟฟ้าและสื่อสาร', name: 'สายไฟฟ้า' },
  { code: '40-02', category: 'งานระบบไฟฟ้าและสื่อสาร', name: 'ท่อร้อยสายและรางสาย' },
  { code: '40-03', category: 'งานระบบไฟฟ้าและสื่อสาร', name: 'ตู้ควบคุมและอุปกรณ์ตัดตอน' },
  { code: '40-04', category: 'งานระบบไฟฟ้าและสื่อสาร', name: 'สวิตช์และเต้ารับ' },
  { code: '40-05', category: 'งานระบบไฟฟ้าและสื่อสาร', name: 'ดวงโคมและหลอดไฟ' },
  { code: '40-06', category: 'งานระบบไฟฟ้าและสื่อสาร', name: 'ระบบสื่อสารและเครือข่าย' },
  { code: '40-07', category: 'งานระบบไฟฟ้าและสื่อสาร', name: 'ระบบความปลอดภัยและแจ้งเหตุ' },
  { code: '40-08', category: 'งานระบบไฟฟ้าและสื่อสาร', name: 'ระบบไฟฟ้ากำลังและพลังงาน' },
  { code: '50-01', category: 'งานระบบปรับอากาศ', name: 'เครื่องปรับอากาศ' },
  { code: '50-02', category: 'งานระบบปรับอากาศ', name: 'ท่อน้ำยาและท่อน้ำทิ้ง' },
  { code: '50-03', category: 'งานระบบปรับอากาศ', name: 'ฉนวนและวัสดุหุ้มท่อ' },
  { code: '50-04', category: 'งานระบบปรับอากาศ', name: 'ท่อลมและหัวจ่ายลม' },
  { code: '50-05', category: 'งานระบบปรับอากาศ', name: 'ระบบระบายอากาศ' },
  { code: '50-06', category: 'งานระบบปรับอากาศ', name: 'อุปกรณ์ติดตั้งและน้ำยาทำความเย็น' },
  { code: '60-01', category: 'ครุภัณฑ์', name: 'ครุภัณฑ์สำนักงาน (เฟอร์นิเจอร์)' },
  { code: '60-02', category: 'ครุภัณฑ์', name: 'ครุภัณฑ์คอมพิวเตอร์' },
  { code: '60-03', category: 'ครุภัณฑ์', name: 'ครุภัณฑ์โฆษณาและเผยแพร่' },
  { code: '60-04', category: 'ครุภัณฑ์', name: 'ครุภัณฑ์งานบ้านงานครัว' },
  { code: '60-05', category: 'ครุภัณฑ์', name: 'ครุภัณฑ์ก่อสร้างและเครื่องมือช่าง' },
  { code: '60-06', category: 'ครุภัณฑ์', name: 'ครุภัณฑ์ยานพาหนะและขนส่ง' },
  { code: '60-07', category: 'ครุภัณฑ์', name: 'ครุภัณฑ์ความปลอดภัย' },
  { code: '90-01', category: 'อื่น', name: 'อุปกรณ์ป้องกันอันตรายส่วนบุคคล (PPE)' },
  { code: '90-02', category: 'อื่น', name: 'วัสดุสิ้นเปลืองหน้างาน' },
  { code: '90-03', category: 'อื่น', name: 'งานชั่วคราวและป้าย' },
  { code: '90-04', category: 'อื่น', name: 'เครื่องเขียนและวัสดุสำนักงาน' },
  { code: '90-05', category: 'อื่น', name: 'งานภูมิทัศน์' },
  { code: '90-06', category: 'อื่น', name: 'บริการและค่าใช้จ่ายอื่น' },
];

/** Groups offered once a category is chosen */
export const groupsOfCategory = (category: string | null | undefined) => ITEM_GROUPS.filter((g) => g.category === category);

/** Group an item code falls in; undefined for codes that do not follow CC-GG-NNN */
export function groupOfItemCode(code: string | null | undefined) {
  const m = /^(\d{2}-\d{2})-/.exec((code ?? '').trim());
  return m ? ITEM_GROUPS.find((g) => g.code === m[1]) : undefined;
}

/** Category and group to put on a line for a picked item: its code decides, else its own category */
export function classifyItem(item: { code: string; category?: string | null }): { category: StockCategory | ''; group: string } {
  const group = groupOfItemCode(item.code);
  if (group) return { category: group.category, group: group.name };
  const own = STOCK_CATEGORIES.find((c) => c === item.category);
  return { category: own ?? '', group: '' };
}
