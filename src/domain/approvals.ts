export const APPROVAL_TYPES = [
  'PR',
  'PO',
  'PV',
  'CLOSE_SHORT',
  'BOQ_OVERRUN',
  'VO',
  'ADVANCE',
  'RECEIPT_SUBSTITUTE',
  'STOCK_ADJUST',
  'PRV_VERIFY',
  'PRV_APPROVE',
] as const;

export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  PR: 'ใบขอซื้อ (PR)',
  PO: 'ใบสั่งซื้อ (PO)',
  PV: 'ใบสำคัญจ่าย (PV)',
  CLOSE_SHORT: 'ขอปิดยอดค้างรับ',
  BOQ_OVERRUN: 'ขอซื้อเกิน BOQ',
  VO: 'งานเพิ่ม/ลด (VO)',
  ADVANCE: 'เงินทดรองจ่าย',
  RECEIPT_SUBSTITUTE: 'ใบรับรองแทนใบเสร็จ',
  STOCK_ADJUST: 'ปรับยอดสต็อก',
  PRV_VERIFY: 'ใบขอเบิก (รอตรวจรับรอง)',
  PRV_APPROVE: 'ใบขอเบิก (รออนุมัติจ่าย)',
};

/** Types whose workflow keeps a note with the decision; stock adjustments have none, so nothing is asked. */
export const takesDecisionNote = (type: ApprovalType): boolean => type !== 'STOCK_ADJUST';
/** A note given when approving is only kept by these; the others record just the rejection reason. */
export const keepsApprovalNote = (type: ApprovalType): boolean => !['PR', 'PO', 'CLOSE_SHORT', 'STOCK_ADJUST'].includes(type);

export interface ApprovalItem {
  type: ApprovalType;
  id: string;
  number: string;
  title: string;
  projectId: string | null;
  projectName: string;
  /** Bangkok date, YYYY-MM-DD */
  date: string;
  requesterName: string;
  amount: number | null;
  href: string;
}

export interface ApprovalProjectGroup {
  /** Null for documents with no single project, such as a PV covering several */
  projectId: string | null;
  projectName: string;
  items: ApprovalItem[];
  typeLabels: string[];
}

export const NO_PROJECT_KEY = 'none';
export const NO_PROJECT_NAME = 'ไม่ระบุโครงการ';

export function filterApprovals(items: ApprovalItem[], filter: { query: string; from: string; to: string }): ApprovalItem[] {
  const query = filter.query.trim().toLowerCase();
  return items.filter(
    (i) =>
      (!filter.from || i.date >= filter.from) &&
      (!filter.to || i.date <= filter.to) &&
      (!query || [i.number, i.title, i.projectName, i.requesterName, APPROVAL_TYPE_LABELS[i.type]].some((text) => text.toLowerCase().includes(query))),
  );
}

/** One row per project, named projects first; documents without a project come last. */
export function groupApprovalsByProject(items: ApprovalItem[]): ApprovalProjectGroup[] {
  const groups = new Map<string, ApprovalProjectGroup>();
  for (const item of items) {
    const key = item.projectId ?? NO_PROJECT_KEY;
    const group = groups.get(key) ?? { projectId: item.projectId, projectName: item.projectName, items: [], typeLabels: [] };
    group.items.push(item);
    const label = APPROVAL_TYPE_LABELS[item.type];
    if (!group.typeLabels.includes(label)) group.typeLabels.push(label);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.projectId === null) return 1;
    if (b.projectId === null) return -1;
    return a.projectName.localeCompare(b.projectName, 'th');
  });
}
