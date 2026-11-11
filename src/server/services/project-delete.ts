import { and, count, eq, gt, inArray, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { type PgTable } from 'drizzle-orm/pg-core';
import { type Db } from '@/db/client';
import {
  advanceExpenses,
  advances,
  arCreditNotes,
  arInvoices,
  arReceipts,
  assets,
  vehicleTrips,
  attachments,
  boqLines,
  boqOverrunRequests,
  boqs,
  closeShortRequests,
  comments,
  dailyReports,
  invoicePayableMatches,
  invoices,
  milestones,
  payables,
  poLines,
  pos,
  projectEvents,
  projects,
  projectTasks,
  prLines,
  prs,
  prvs,
  pvLines,
  pvs,
  receipts,
  receiptSubstitutes,
  stockAdjustRequests,
  stockBalances,
  stockMovements,
  stockDocs,
  variationOrders,
  whtCerts,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { removeStoredFile } from './attachments';
import { getProjectDetail } from './master';

export interface ProjectDeletionPreview {
  /** What goes with the project; rows with nothing to remove are left out */
  items: { label: string; count: number }[];
  /** Tax records that disappear for good; the accountant may still need them */
  taxRecords: { label: string; count: number }[];
  /** Assets stay company property and go back to the office */
  assetsToOffice: number;
  /** Item balances above zero that stop being counted anywhere */
  stockBalancesLeft: number;
  /** Why the project cannot go yet; empty when it can */
  blockers: string[];
}

const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id);

/** Every document that belongs to the project, including those reached only through its POs, milestones or advances. */
async function collectDocuments(db: Db, projectId: string) {
  const poIds = idsOf(await db.select({ id: pos.id }).from(pos).where(eq(pos.projectId, projectId)));
  const prIds = idsOf(await db.select({ id: prs.id }).from(prs).where(eq(prs.projectId, projectId)));
  const receiptIds = idsOf(await db.select({ id: receipts.id }).from(receipts).where(inArray(receipts.poId, poIds)));
  const invoiceIds = idsOf(await db.select({ id: invoices.id }).from(invoices).where(inArray(invoices.poId, poIds)));
  const closeShortIds = idsOf(await db.select({ id: closeShortRequests.id }).from(closeShortRequests).where(inArray(closeShortRequests.poId, poIds)));
  const payableIds = idsOf(
    await db.select({ id: payables.id }).from(payables).where(or(eq(payables.projectId, projectId), inArray(payables.poId, poIds))),
  );
  const prvIds = idsOf(await db.select({ id: prvs.id }).from(prvs).where(eq(prvs.projectId, projectId)));
  const boqIds = idsOf(await db.select({ id: boqs.id }).from(boqs).where(eq(boqs.projectId, projectId)));
  const voIds = idsOf(await db.select({ id: variationOrders.id }).from(variationOrders).where(eq(variationOrders.projectId, projectId)));
  const dailyReportIds = idsOf(await db.select({ id: dailyReports.id }).from(dailyReports).where(eq(dailyReports.projectId, projectId)));
  const stockAdjustIds = idsOf(await db.select({ id: stockAdjustRequests.id }).from(stockAdjustRequests).where(eq(stockAdjustRequests.projectId, projectId)));
  const milestoneIds = idsOf(await db.select({ id: milestones.id }).from(milestones).where(eq(milestones.projectId, projectId)));
  // A bill raised from one of the project's milestones without a project of its own still belongs here
  const arInvoiceIds = idsOf(
    await db
      .select({ id: arInvoices.id })
      .from(arInvoices)
      .where(or(eq(arInvoices.projectId, projectId), and(isNull(arInvoices.projectId), inArray(arInvoices.milestoneId, milestoneIds)))),
  );
  const advanceIds = idsOf(await db.select({ id: advances.id }).from(advances).where(eq(advances.projectId, projectId)));
  const substituteIds = idsOf(
    await db
      .select({ id: receiptSubstitutes.id })
      .from(receiptSubstitutes)
      .where(or(eq(receiptSubstitutes.projectId, projectId), and(isNull(receiptSubstitutes.projectId), inArray(receiptSubstitutes.advanceId, advanceIds)))),
  );

  // One PV can pay bills from several projects, so whether it goes depends on all of its lines
  const pvIdsTouched = [...new Set((await db.select({ pvId: pvLines.pvId }).from(pvLines).where(inArray(pvLines.payableId, payableIds))).map((l) => l.pvId))];
  const ownPayables = new Set(payableIds);
  const linesOfPvs = await db.select({ pvId: pvLines.pvId, payableId: pvLines.payableId }).from(pvLines).where(inArray(pvLines.pvId, pvIdsTouched));
  const mixedPvIds = new Set(linesOfPvs.filter((l) => !ownPayables.has(l.payableId)).map((l) => l.pvId));
  const pvRows = await db.select({ id: pvs.id, number: pvs.number, status: pvs.status }).from(pvs).where(inArray(pvs.id, pvIdsTouched));
  const pvIds = pvRows.filter((p) => !mixedPvIds.has(p.id)).map((p) => p.id);
  const mixedPvs = pvRows.filter((p) => mixedPvIds.has(p.id));

  const blockers = mixedPvs
    .filter((p) => p.status !== 'CANCELLED')
    .map((p) =>
      p.status === 'PAID'
        ? `ใบสำคัญจ่าย ${p.number} จ่ายเงินแล้วโดยรวมรายการของโครงการอื่น จึงลบโครงการนี้ไม่ได้ หากเลิกใช้งานให้เปลี่ยนสถานะเป็น "ยกเลิก"`
        : `ใบสำคัญจ่าย ${p.number} รวมรายการของโครงการอื่น กรุณายกเลิกใบนี้ก่อน`,
    );

  const outsideBills = await db
    .select({ invoiceNo: invoices.invoiceNo })
    .from(payables)
    .innerJoin(invoices, eq(invoices.id, payables.invoiceId))
    .where(and(inArray(payables.invoiceId, invoiceIds), notInArray(payables.id, payableIds)));
  const outsideMatches = await db
    .select({ invoiceNo: invoices.invoiceNo })
    .from(invoicePayableMatches)
    .innerJoin(invoices, eq(invoices.id, invoicePayableMatches.invoiceId))
    .where(
      or(
        and(inArray(invoicePayableMatches.invoiceId, invoiceIds), notInArray(invoicePayableMatches.payableId, payableIds)),
        and(inArray(invoicePayableMatches.payableId, payableIds), notInArray(invoicePayableMatches.invoiceId, invoiceIds)),
      ),
    );
  for (const invoiceNo of new Set([...outsideBills, ...outsideMatches].map((r) => r.invoiceNo))) {
    blockers.push(`ใบแจ้งหนี้ ${invoiceNo} เกี่ยวข้องกับรายการของโครงการอื่น จึงลบโครงการนี้ไม่ได้ หากเลิกใช้งานให้เปลี่ยนสถานะเป็น "ยกเลิก"`);
  }

  return {
    poIds,
    prIds,
    receiptIds,
    invoiceIds,
    closeShortIds,
    payableIds,
    prvIds,
    boqIds,
    voIds,
    dailyReportIds,
    stockAdjustIds,
    milestoneIds,
    arInvoiceIds,
    advanceIds,
    substituteIds,
    pvIds,
    /** Already cancelled PVs shared with another project: they stay, minus this project's lines */
    cancelledMixedPvIds: mixedPvs.filter((p) => p.status === 'CANCELLED').map((p) => p.id),
    blockers,
  };
}

type ProjectDocuments = Awaited<ReturnType<typeof collectDocuments>>;

/** Everything comments and files can hang on. Ids are random UUIDs, so the entity type is not needed to tell them apart. */
const entityIdsOf = (projectId: string, d: ProjectDocuments) => [
  projectId,
  ...d.poIds,
  ...d.prIds,
  ...d.receiptIds,
  ...d.invoiceIds,
  ...d.closeShortIds,
  ...d.payableIds,
  ...d.prvIds,
  ...d.boqIds,
  ...d.voIds,
  ...d.dailyReportIds,
  ...d.stockAdjustIds,
  ...d.milestoneIds,
  ...d.arInvoiceIds,
  ...d.advanceIds,
  ...d.substituteIds,
  ...d.pvIds,
];

async function countOf(db: Db, table: PgTable, where: SQL | undefined) {
  const [row] = await db.select({ n: count() }).from(table).where(where);
  return row?.n ?? 0;
}

/** Shown before anyone confirms, so they can see what a delete would take with it. */
export async function previewProjectDeletion(db: Db, actor: SessionUser, projectId: string): Promise<ProjectDeletionPreview> {
  await getProjectDetail(db, actor, projectId);
  assertCan(actor, 'project.delete', { projectId });

  const d = await collectDocuments(db, projectId);
  const entityIds = entityIdsOf(projectId, d);
  const [tasks, events, movements, files, notes, whtCount, paidPvs, arIssued, arReceiptCount, arCreditCount, assetCount, balances] = await Promise.all([
    countOf(db, projectTasks, eq(projectTasks.projectId, projectId)),
    countOf(db, projectEvents, eq(projectEvents.projectId, projectId)),
    countOf(db, stockMovements, and(eq(stockMovements.projectId, projectId), ne(stockMovements.type, 'TRANSFER'))),
    countOf(db, attachments, inArray(attachments.entityId, entityIds)),
    countOf(db, comments, inArray(comments.entityId, entityIds)),
    countOf(db, whtCerts, inArray(whtCerts.pvId, d.pvIds)),
    countOf(db, pvs, and(inArray(pvs.id, d.pvIds), eq(pvs.status, 'PAID'))),
    countOf(db, arInvoices, and(inArray(arInvoices.id, d.arInvoiceIds), ne(arInvoices.status, 'DRAFT'))),
    countOf(db, arReceipts, inArray(arReceipts.invoiceId, d.arInvoiceIds)),
    countOf(db, arCreditNotes, inArray(arCreditNotes.invoiceId, d.arInvoiceIds)),
    countOf(db, assets, eq(assets.projectId, projectId)),
    countOf(db, stockBalances, and(eq(stockBalances.projectId, projectId), gt(stockBalances.quantity, '0'))),
  ]);

  const items = [
    { label: 'BOQ', count: d.boqIds.length },
    { label: 'งาน', count: tasks },
    { label: 'งวดงาน', count: d.milestoneIds.length },
    { label: 'งานเพิ่ม/ลด (VO)', count: d.voIds.length },
    { label: 'รายงานประจำวัน', count: d.dailyReportIds.length },
    { label: 'กิจกรรมในปฏิทิน', count: events },
    { label: 'ใบขอซื้อ (PR)', count: d.prIds.length },
    { label: 'ใบสั่งซื้อ (PO)', count: d.poIds.length },
    { label: 'ใบรับของ', count: d.receiptIds.length },
    { label: 'ใบแจ้งหนี้ผู้ขาย', count: d.invoiceIds.length },
    { label: 'รายการตั้งเบิก', count: d.payableIds.length },
    { label: 'ใบสำคัญจ่าย (PV)', count: d.pvIds.length },
    { label: 'ใบขอเบิก (PRV)', count: d.prvIds.length },
    { label: 'ใบแจ้งหนี้ลูกค้า', count: d.arInvoiceIds.length },
    { label: 'ใบขอเงินทดรองจ่าย', count: d.advanceIds.length },
    { label: 'ใบรับรองแทนใบเสร็จ', count: d.substituteIds.length },
    { label: 'ความเคลื่อนไหวสต็อก', count: movements },
    { label: 'คำขอปรับยอดสต็อก', count: d.stockAdjustIds.length },
    { label: 'ไฟล์และรูปภาพ', count: files },
    { label: 'ข้อความและความคิดเห็น', count: notes },
  ].filter((i) => i.count > 0);

  const taxRecords = [
    { label: 'ใบสำคัญจ่ายที่จ่ายเงินแล้ว', count: paidPvs },
    { label: 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)', count: whtCount },
    { label: 'ใบแจ้งหนี้/ใบกำกับภาษีจากผู้ขาย', count: d.invoiceIds.length },
    { label: 'ใบแจ้งหนี้ที่ออกให้ลูกค้าแล้ว', count: arIssued },
    { label: 'ใบเสร็จรับเงิน/ใบกำกับภาษีขาย', count: arReceiptCount },
    { label: 'ใบลดหนี้', count: arCreditCount },
  ].filter((i) => i.count > 0);

  return { items, taxRecords, assetsToOffice: assetCount, stockBalancesLeft: balances, blockers: d.blockers };
}

const isForeignKeyViolation = (err: unknown): boolean => {
  const { code, cause } = err as { code?: string; cause?: { code?: string } };
  return code === '23503' || cause?.code === '23503';
};

/**
 * Permanently removes a project and everything that belongs to it, in one transaction. Other projects keep what is
 * theirs: links into this project are cleared, and transfers to or from it stay in their stock history with a note.
 * Assets go back to the office, and the activity log is kept as the record of what happened.
 */
export async function deleteProject(db: Db, actor: SessionUser, projectId: string, confirmCode: string): Promise<void> {
  const project = await getProjectDetail(db, actor, projectId);
  assertCan(actor, 'project.delete', { projectId });
  if (confirmCode.trim() !== project.code) {
    throw new DomainError('INVALID_CONFIRMATION', 'รหัสโครงการที่พิมพ์ไม่ตรงกัน จึงยังไม่ได้ลบ');
  }

  try {
    await db.transaction(async (tx) => {
      // Inserting a document for this project waits on this lock, then fails because the project is gone
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('update');
      const d = await collectDocuments(tx, projectId);
      if (d.blockers.length > 0) throw new DomainError('PROJECT_IN_USE', d.blockers[0]!, 409);
      const entityIds = entityIdsOf(projectId, d);

      await tx.delete(boqOverrunRequests).where(eq(boqOverrunRequests.projectId, projectId));

      await tx.delete(pvLines).where(and(inArray(pvLines.pvId, d.cancelledMixedPvIds), inArray(pvLines.payableId, d.payableIds)));
      await tx.delete(whtCerts).where(inArray(whtCerts.pvId, d.pvIds));
      await tx.delete(pvs).where(inArray(pvs.id, d.pvIds));
      await tx.delete(payables).where(inArray(payables.id, d.payableIds));
      await tx.delete(invoices).where(inArray(invoices.id, d.invoiceIds));

      await tx.update(prvs).set({ poId: null }).where(inArray(prvs.poId, d.poIds));
      await tx.delete(prvs).where(inArray(prvs.id, d.prvIds));
      await tx.delete(receipts).where(inArray(receipts.id, d.receiptIds));
      await tx.delete(pos).where(inArray(pos.id, d.poIds));

      // A PO of another project can point at this project's PR lines or BOQ lines
      const prLineIds = idsOf(await tx.select({ id: prLines.id }).from(prLines).where(inArray(prLines.prId, d.prIds)));
      await tx.update(poLines).set({ prLineId: null }).where(inArray(poLines.prLineId, prLineIds));
      const boqLineIds = idsOf(await tx.select({ id: boqLines.id }).from(boqLines).where(inArray(boqLines.boqId, d.boqIds)));
      await tx.update(poLines).set({ boqLineId: null }).where(inArray(poLines.boqLineId, boqLineIds));
      await tx.delete(prs).where(inArray(prs.id, d.prIds));

      await tx.delete(arCreditNotes).where(inArray(arCreditNotes.invoiceId, d.arInvoiceIds));
      await tx.delete(arReceipts).where(inArray(arReceipts.invoiceId, d.arInvoiceIds));
      await tx.delete(arInvoices).where(inArray(arInvoices.id, d.arInvoiceIds));
      await tx.update(arInvoices).set({ milestoneId: null }).where(inArray(arInvoices.milestoneId, d.milestoneIds));

      await tx.update(advanceExpenses).set({ substituteId: null }).where(inArray(advanceExpenses.substituteId, d.substituteIds));
      await tx.delete(receiptSubstitutes).where(inArray(receiptSubstitutes.id, d.substituteIds));
      await tx.update(receiptSubstitutes).set({ advanceId: null }).where(inArray(receiptSubstitutes.advanceId, d.advanceIds));
      await tx.delete(advances).where(inArray(advances.id, d.advanceIds));

      await tx.delete(stockAdjustRequests).where(eq(stockAdjustRequests.projectId, projectId));
      // Without these rows the other location's history would no longer add up to its balance
      await tx
        .update(stockMovements)
        .set({ projectId: null, notes: sql`trim(coalesce(${stockMovements.notes}, '') || ' ' || ${`โอนมาจากโครงการ ${project.code} ที่ลบแล้ว`})` })
        .where(and(eq(stockMovements.projectId, projectId), eq(stockMovements.type, 'TRANSFER')));
      await tx
        .update(stockMovements)
        .set({ targetProjectId: null, notes: sql`trim(coalesce(${stockMovements.notes}, '') || ' ' || ${`โอนไปโครงการ ${project.code} ที่ลบแล้ว`})` })
        .where(eq(stockMovements.targetProjectId, projectId));
      await tx.delete(stockMovements).where(eq(stockMovements.projectId, projectId));
      // Receipts and issues of this store go with it; a transfer or borrow keeps its document, with the link cleared
      await tx.delete(stockDocs).where(and(eq(stockDocs.projectId, projectId), inArray(stockDocs.type, ['RECEIVE', 'ISSUE'])));

      await tx.update(assets).set({ projectId: null, updatedAt: new Date() }).where(eq(assets.projectId, projectId));
      // A trip is the vehicle's history: it stays, counted as an office trip from now on
      await tx.update(vehicleTrips).set({ projectId: null, updatedAt: new Date() }).where(eq(vehicleTrips.projectId, projectId));

      const files = await tx.select({ url: attachments.url }).from(attachments).where(inArray(attachments.entityId, entityIds));
      await tx.delete(attachments).where(inArray(attachments.entityId, entityIds));
      await tx.delete(comments).where(inArray(comments.entityId, entityIds));
      for (const file of files) await removeStoredFile(tx, file.url);

      await tx.delete(projects).where(eq(projects.id, projectId));
      await removeStoredFile(tx, project.coverImageUrl);
      await logActivity(tx, {
        entityType: 'PROJECT',
        entityId: projectId,
        action: 'project.delete',
        userId: actor.id,
        note: `${project.code} ${project.name}`,
        data: {
          pos: d.poIds.length,
          prs: d.prIds.length,
          pvs: d.pvIds.length,
          invoices: d.invoiceIds.length,
          arInvoices: d.arInvoiceIds.length,
          advances: d.advanceIds.length,
          files: files.length,
        },
      });
    });
  } catch (err) {
    // Something was added or linked to the project while this ran; nothing has been removed
    if (isForeignKeyViolation(err)) {
      throw new DomainError('PROJECT_IN_USE', 'มีเอกสารอื่นอ้างถึงโครงการนี้อยู่ จึงยังไม่ได้ลบ กรุณาลองใหม่อีกครั้ง', 409);
    }
    throw err;
  }
}
