import { and, eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { userRoles, type PoStatus, type PrStatus, type PrvStatus, type PvStatus } from '@/db/schema';
import { prSignatures, type PrType } from '@/domain/pr-type';
import { signerLine, type Signer } from '@/domain/signature';
import { signerPeople } from './signatures';

/**
 * Who has signed each document. A line is signed by the account that did that step in the system:
 * the one that wrote and sent it, the one that pressed approve. Steps not done yet, and lines for
 * outside parties (payee, customer), stay blank for a pen.
 */

type When = Date | string | null | undefined;

/** The person asking writes the requisition, so one box carries both; the other is the approver's */
export async function prSigners(db: Db, pr: { prType: PrType; status: PrStatus; requestedBy: string; approvedBy: string | null; approvedAt: When; docDate: When; createdAt: Date }): Promise<Signer[]> {
  const people = await signerPeople(db, [pr.requestedBy, pr.approvedBy]);
  const approved = pr.status === 'APPROVED' || pr.status === 'CLOSED';
  const [preparer, approver] = prSignatures(pr.prType);
  return [
    signerLine(preparer!, people, pr.requestedBy, pr.docDate ?? pr.createdAt, pr.status !== 'DRAFT'),
    signerLine(approver!, people, pr.approvedBy, pr.approvedAt, approved),
  ];
}

export async function poSigners(db: Db, po: { status: PoStatus; createdBy: string; approvedBy: string | null; approvedAt: When; docDate: When; createdAt: Date }): Promise<Signer[]> {
  const people = await signerPeople(db, [po.createdBy, po.approvedBy]);
  const approved = po.status === 'APPROVED' || po.status === 'ORDERED' || po.status === 'COMPLETED';
  return [
    signerLine('ผู้จัดทำ', people, po.createdBy, po.docDate ?? po.createdAt, po.status !== 'DRAFT'),
    signerLine('ผู้อนุมัติ', people, po.approvedBy, po.approvedAt, approved),
  ];
}

/**
 * The printed requisition's three boxes: the person asking, the PM, and an executive. Over BOQ the PM
 * passes it on and the owner approves, so both are signed; otherwise one person approves, and they sign
 * the PM's box when they are a PM, else the executive's (the GM, or the owner on a project with no PM).
 */
export async function prPdfSigners(
  db: Db,
  pr: { prType: PrType; status: PrStatus; requestedBy: string; pmApprovedBy: string | null; pmApprovedAt: When; approvedBy: string | null; approvedAt: When; docDate: When; createdAt: Date },
): Promise<Signer[]> {
  const people = await signerPeople(db, [pr.requestedBy, pr.pmApprovedBy, pr.approvedBy]);
  const approved = pr.status === 'APPROVED' || pr.status === 'CLOSED';
  let pm: { id: string | null; at: When } = { id: pr.pmApprovedBy, at: pr.pmApprovedAt };
  let executive: string | null = approved ? pr.approvedBy : null;
  if (!pr.pmApprovedBy && executive) {
    const [isPm] = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, executive), eq(userRoles.role, 'PM')))
      .limit(1);
    if (isPm) {
      pm = { id: executive, at: pr.approvedAt };
      executive = null;
    }
  }
  return [
    signerLine(prSignatures(pr.prType)[0]!, people, pr.requestedBy, pr.docDate ?? pr.createdAt, pr.status !== 'DRAFT'),
    signerLine('ผู้จัดการโครงการ (PM)', people, pm.id, pm.at),
    signerLine('ผู้บริหาร', people, executive, pr.approvedAt),
  ];
}

export async function pvSigners(db: Db, pv: { status: PvStatus; createdBy: string; submittedAt: When; approvedBy: string | null; approvedAt: When; createdAt: Date }): Promise<Signer[]> {
  const people = await signerPeople(db, [pv.createdBy, pv.approvedBy]);
  const approved = pv.status === 'APPROVED' || pv.status === 'PAID';
  return [
    signerLine('ผู้จัดทำ', people, pv.createdBy, pv.submittedAt ?? pv.createdAt, pv.status !== 'DRAFT'),
    signerLine('ผู้อนุมัติ', people, pv.approvedBy, pv.approvedAt, approved),
    { label: 'ผู้รับเงิน' },
  ];
}

export async function prvSigners(
  db: Db,
  prv: { status: PrvStatus; requestedBy: string; verifiedBy: string | null; verifiedAt: When; approvedBy: string | null; approvedAt: When; date: When; createdAt: Date },
): Promise<Signer[]> {
  const people = await signerPeople(db, [prv.requestedBy, prv.verifiedBy, prv.approvedBy]);
  const verified = prv.status === 'PM_VERIFIED' || prv.status === 'APPROVED' || prv.status === 'PV_CREATED';
  const approved = prv.status === 'APPROVED' || prv.status === 'PV_CREATED';
  return [
    signerLine('ผู้ขอเบิก', people, prv.requestedBy, prv.date ?? prv.createdAt, prv.status !== 'DRAFT'),
    signerLine('ผู้ตรวจรับรอง (PM)', people, prv.verifiedBy, prv.verifiedAt, verified),
    signerLine('ผู้อนุมัติจ่าย', people, prv.approvedBy, prv.approvedAt, approved),
  ];
}

/** A sales document is issued the moment it is saved; it has no approval step in the system */
export async function salesDocSigners(db: Db, doc: { kind: string; createdBy: string; docDate: When; createdAt: Date }): Promise<Signer[]> {
  const people = await signerPeople(db, [doc.createdBy]);
  return [signerLine('ผู้จัดทำ', people, doc.createdBy, doc.docDate ?? doc.createdAt), { label: 'ผู้อนุมัติ' }, { label: doc.kind === 'EXP' ? 'ผู้รับเงิน' : 'ลูกค้า' }];
}
