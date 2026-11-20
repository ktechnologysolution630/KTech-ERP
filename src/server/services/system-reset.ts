import { randomUUID } from 'node:crypto';
import { count, inArray, isNotNull, ne, notInArray, type SQL } from 'drizzle-orm';
import { type PgTable } from 'drizzle-orm/pg-core';
import { type Db } from '@/db/client';
import {
  activityLogs,
  apCreditNotes,
  bankReconciliations,
  glClosings,
  advanceExpenses,
  advances,
  arCreditNotes,
  arInvoiceLines,
  arInvoices,
  arReceipts,
  assetInspections,
  attachments,
  boqLines,
  boqOverrunRequests,
  boqs,
  closeShortRequests,
  comments,
  dailyReports,
  docCounters,
  invoicePayableMatches,
  invoices,
  journalEntries,
  journalLines,
  milestones,
  notifications,
  payables,
  poInstallments,
  poLines,
  poRevisions,
  pos,
  prLines,
  prs,
  prvItems,
  prvs,
  projectEvents,
  projectHandovers,
  pvLines,
  pvs,
  receiptLines,
  receipts,
  receiptSubstituteLines,
  receiptSubstitutes,
  salesDocLines,
  salesDocs,
  stockAdjustRequests,
  stockBalances,
  stockCountLines,
  stockCounts,
  stockDocs,
  stockMovements,
  variationOrders,
  vehiclePositions,
  vehicleTripExpenses,
  vehicleTrips,
  warrantyDefects,
  whtCerts,
  type EntityType,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { removeStoredFile } from './attachments';
import { guarded } from './record-delete';

/**
 * The reset of the whole system before going live: every document on every menu goes and every running number
 * starts again from 1. What the company set up stays: users, the BOQs (and the projects they belong to), suppliers,
 * the item register and the other registers. Only the owner and admin may run it, and it runs in one transaction.
 */

/** Typed by the person resetting, so it cannot happen by a stray click */
export const SYSTEM_RESET_CONFIRM = 'ล้างข้อมูลทั้งระบบ';

/**
 * Counters of the registers that stay: their codes are still in use, so these keep counting.
 * BOQ numbers, project codes, supplier codes, stock item codes and asset codes.
 */
export const KEPT_COUNTERS = ['BOQ', 'PJ', 'V', 'MAT', 'AST'] as const;

/** Files and comments on these stay, since the records they hang on stay */
const KEPT_ENTITY_TYPES: EntityType[] = ['BOQ', 'PROJECT', 'MILESTONE', 'VENDOR', 'ITEM', 'ASSET', 'CUSTOMER', 'COMPANY_ACCOUNT', 'ACCOUNT_CATEGORY'];

/** What goes, grouped as the menus show it; children go with their document */
const GROUPS: { label: string; table: PgTable }[] = [
  { label: 'ใบขอซื้อ (PR)', table: prs },
  { label: 'ใบสั่งซื้อ (PO)', table: pos },
  { label: 'คำขอเกินงบ BOQ', table: boqOverrunRequests },
  { label: 'คำขอปิด PO ไม่ครบ', table: closeShortRequests },
  { label: 'ใบรับของ', table: receipts },
  { label: 'ใบขอเบิกงวดผู้รับเหมา (PRV)', table: prvs },
  { label: 'ใบแจ้งหนี้ผู้ขาย (AP)', table: invoices },
  { label: 'ใบลดหนี้ผู้ขาย/ส่งคืนสินค้า', table: apCreditNotes },
  { label: 'รายการตั้งจ่าย', table: payables },
  { label: 'ใบสำคัญจ่าย (PV)', table: pvs },
  { label: 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)', table: whtCerts },
  { label: 'เอกสารขาย/รับเงิน (ใบเสนอราคา ใบเสร็จ ใบกำกับภาษี ฯลฯ)', table: salesDocs },
  { label: 'ใบแจ้งหนี้/วางบิลลูกค้า', table: arInvoices },
  { label: 'ใบเสร็จรับชำระจากใบแจ้งหนี้', table: arReceipts },
  { label: 'ใบลดหนี้', table: arCreditNotes },
  { label: 'ใบขอเงินทดรองจ่าย', table: advances },
  { label: 'ใบรับรองแทนใบเสร็จ', table: receiptSubstitutes },
  { label: 'เอกสารคลังสินค้า (รับ/เบิก/โอน/ยืม)', table: stockDocs },
  { label: 'รายการเคลื่อนไหวสต็อก', table: stockMovements },
  { label: 'ยอดคงเหลือสต็อก', table: stockBalances },
  { label: 'คำขอปรับยอดสต็อก', table: stockAdjustRequests },
  { label: 'ใบตรวจนับสต็อก', table: stockCounts },
  { label: 'ใบสั่งเปลี่ยนแปลงงาน (VO)', table: variationOrders },
  { label: 'รายงานประจำวัน', table: dailyReports },
  { label: 'นัดหมาย/กิจกรรมโครงการ', table: projectEvents },
  { label: 'ส่งมอบงาน', table: projectHandovers },
  { label: 'แจ้งซ่อมในประกัน', table: warrantyDefects },
  { label: 'การจองใช้รถ', table: vehicleTrips },
  { label: 'ค่าใช้จ่ายรถ', table: vehicleTripExpenses },
  { label: 'ตำแหน่ง GPS รถ', table: vehiclePositions },
  { label: 'ใบตรวจสภาพทรัพย์สิน', table: assetInspections },
  { label: 'สมุดรายวัน (รายการบัญชีอัตโนมัติ)', table: journalEntries },
  { label: 'ประวัติการทำงาน (Activity log)', table: activityLogs },
  { label: 'การแจ้งเตือน', table: notifications },
];

export interface SystemResetPreview {
  /** Records that go; kinds with none are left out */
  documents: { label: string; count: number }[];
  /** Running-number counters set back to 0 */
  counters: number;
}

async function countOf(db: Db, table: PgTable, where?: SQL) {
  const [row] = await db.select({ n: count() }).from(table).where(where);
  return row?.n ?? 0;
}

const resetCounters = notInArray(docCounters.prefix, [...KEPT_COUNTERS]);
const docAttachments = notInArray(attachments.entityType, KEPT_ENTITY_TYPES);
const docComments = notInArray(comments.entityType, KEPT_ENTITY_TYPES);

export async function previewSystemReset(db: Db, actor: SessionUser): Promise<SystemResetPreview> {
  assertCan(actor, 'data.delete');
  const counts = await Promise.all(GROUPS.map((g) => countOf(db, g.table)));
  const [files, counters] = await Promise.all([countOf(db, attachments, docAttachments), countOf(db, docCounters, resetCounters)]);
  const documents = [...GROUPS.map((g, i) => ({ label: g.label, count: counts[i]! })), { label: 'ไฟล์แนบของเอกสาร', count: files }].filter((d) => d.count > 0);
  return { documents, counters };
}

/**
 * Deletes every document and sets every running number back to 0, in one transaction: if anything fails nothing is
 * removed. BOQs priced from a variation order stay as BOQs; milestones go back to planned and BOQ usage alerts to 0.
 */
export async function resetSystem(db: Db, actor: SessionUser, confirm: string): Promise<SystemResetPreview> {
  assertCan(actor, 'data.delete');
  if (confirm.trim() !== SYSTEM_RESET_CONFIRM) {
    throw new DomainError('INVALID_CONFIRMATION', `พิมพ์ "${SYSTEM_RESET_CONFIRM}" ให้ตรงก่อน จึงจะล้างข้อมูลได้`);
  }
  const summary = await previewSystemReset(db, actor);
  return guarded(() =>
    db.transaction(async (tx) => {
      const files = await tx.select({ url: attachments.url }).from(attachments).where(docAttachments);
      await tx.delete(attachments).where(docAttachments);
      await tx.delete(comments).where(docComments);
      for (const f of files) await removeStoredFile(tx, f.url);
      await tx.delete(notifications);
      // Deleted numbers are listed in the log so they are skipped; with the log cleared, numbering starts again at 1
      await tx.delete(activityLogs);

      // Vehicles and assets
      await tx.delete(vehiclePositions);
      await tx.delete(vehicleTripExpenses);
      await tx.delete(vehicleTrips);
      await tx.delete(assetInspections);

      // Advances and receipt substitutes
      await tx.delete(advanceExpenses);
      await tx.delete(receiptSubstituteLines);
      await tx.delete(receiptSubstitutes);
      await tx.delete(advances);

      // The books: entries go, the chart of accounts stays
      await tx.delete(glClosings);
      await tx.delete(bankReconciliations);
      await tx.delete(journalLines);
      await tx.delete(journalEntries);

      // Receivables and sales documents
      await tx.delete(arCreditNotes);
      await tx.delete(arReceipts);
      await tx.delete(arInvoiceLines);
      await tx.delete(arInvoices);
      await tx.delete(salesDocLines);
      await tx.delete(salesDocs);

      // Payables
      await tx.delete(whtCerts);
      await tx.delete(pvLines);
      await tx.delete(pvs);
      await tx.delete(invoicePayableMatches);
      await tx.delete(apCreditNotes);
      await tx.delete(payables);
      await tx.delete(invoices);

      // Purchasing
      await tx.delete(receiptLines);
      await tx.delete(receipts);
      await tx.delete(prvItems);
      await tx.delete(prvs);
      await tx.delete(boqOverrunRequests);
      await tx.delete(closeShortRequests);
      await tx.delete(poRevisions);
      await tx.delete(poInstallments);
      await tx.delete(poLines);
      await tx.delete(pos);
      await tx.delete(prLines);
      await tx.delete(prs);

      // Stock: the items stay, their movements and balances go
      await tx.delete(stockMovements);
      await tx.delete(stockDocs);
      await tx.delete(stockBalances);
      await tx.delete(stockAdjustRequests);
      await tx.delete(stockCountLines);
      await tx.delete(stockCounts);

      // Projects: the project, its BOQs, plan and milestones stay
      await tx.update(boqs).set({ voId: null }).where(isNotNull(boqs.voId));
      await tx.delete(variationOrders);
      await tx.delete(dailyReports);
      await tx.delete(projectEvents);
      await tx.delete(warrantyDefects);
      await tx.delete(projectHandovers);
      await tx.update(boqLines).set({ usageAlertLevel: 0 }).where(ne(boqLines.usageAlertLevel, 0));
      await tx
        .update(milestones)
        .set({ status: 'PLANNED', claimedAt: null, approvedAt: null, paidAt: null, updatedAt: new Date() })
        .where(inArray(milestones.status, ['CLAIMED', 'APPROVED', 'PAID']));

      // Every running number starts again at 1
      await tx.delete(docCounters).where(resetCounters);

      await logActivity(tx, {
        entityType: 'SYSTEM',
        entityId: randomUUID(),
        action: 'RESET',
        userId: actor.id,
        note: `ล้างข้อมูลทั้งระบบ: ${summary.documents.map((d) => `${d.label} ${d.count}`).join(', ') || 'ไม่มีเอกสาร'}`,
        data: { documents: summary.documents, counters: summary.counters },
      });
      return summary;
    }),
  );
}
