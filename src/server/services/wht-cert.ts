import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import {
  pvLines,
  pvs,
  vendors,
  whtCerts,
  type SessionUser,
} from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { D, sum } from '@/domain/money';
import { ensureFontsRegistered } from '@/pdf/layout';
import { Wht50PdfDoc, type WhtCertView } from '@/pdf/wht50';
import { assertCan } from '@/server/policy';
import { logActivity } from './activity';
import { nextDocNumber } from './numbering';
import { registerWhtPdfRenderer } from './pdf';
import { registerWhtCertIssuer } from './pv';
import { getSettings } from './settings';

export async function issueWhtCert(
  tx: Db,
  pvId: string,
): Promise<string | null> {
  const [pv] = await tx.select().from(pvs).where(eq(pvs.id, pvId)).limit(1);
  if (!pv) throw new DomainError('NOT_FOUND', 'ไม่พบใบสำคัญจ่าย', 404);

  const lines = await tx
    .select()
    .from(pvLines)
    .where(eq(pvLines.pvId, pv.id));

  const whtLines = lines.filter((l) => D(l.wht).gt(0));
  const totalWht = sum(whtLines.map((l) => D(l.wht)));
  if (totalWht.lte(0)) {
    return null;
  }

  const totalBasis = sum(whtLines.map((l) => D(l.beforeVat)));

  const [vendor] = await tx
    .select()
    .from(vendors)
    .where(eq(vendors.id, pv.vendorId))
    .limit(1);
  if (!vendor) throw new DomainError('NOT_FOUND', 'ไม่พบข้อมูลผู้ขาย', 404);

  // A PV paid again after its cheque was voided brings back its own certificate, dated the new payment
  const [previous] = await tx.select().from(whtCerts).where(eq(whtCerts.pvId, pv.id)).limit(1);
  if (previous) {
    await tx
      .update(whtCerts)
      .set({
        status: 'ACTIVE',
        voidReason: null,
        formType: vendor.type === 'INDIVIDUAL' ? 'PND3' : 'PND53',
        paidAt: pv.paidAt ?? new Date().toISOString().slice(0, 10),
        basis: totalBasis.toFixed(2),
        wht: totalWht.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(whtCerts.id, previous.id));
    return previous.id;
  }

  const paidDateObj = pv.paidAt
    ? new Date(`${pv.paidAt}T00:00:00+07:00`)
    : new Date();
  const number = await nextDocNumber(tx, 'WHT', paidDateObj);
  const formType = vendor.type === 'INDIVIDUAL' ? 'PND3' : 'PND53';

  const [cert] = await tx
    .insert(whtCerts)
    .values({
      number,
      pvId: pv.id,
      vendorId: vendor.id,
      formType,
      paidAt: pv.paidAt ?? new Date().toISOString().slice(0, 10),
      incomeType: 'ค่าจ้างทำของ/ค่าบริการ',
      basis: totalBasis.toFixed(2),
      wht: totalWht.toFixed(2),
      status: 'ACTIVE',
    })
    .returning();

  return cert!.id;
}

export async function getWhtCert(
  db: Db,
  actor: SessionUser,
  certId: string,
): Promise<WhtCertView> {
  assertCan(actor, 'export.view');

  const [cert] = await db
    .select()
    .from(whtCerts)
    .where(eq(whtCerts.id, certId))
    .limit(1);
  if (!cert) throw new DomainError('NOT_FOUND', 'ไม่พบหนังสือรับรอง 50 ทวิ', 404);

  const [vendor] = await db
    .select()
    .from(vendors)
    .where(eq(vendors.id, cert.vendorId))
    .limit(1);

  return {
    id: cert.id,
    number: cert.number,
    pvId: cert.pvId,
    vendorId: cert.vendorId,
    vendorName: vendor?.name ?? '',
    vendorTaxId: vendor?.taxId ?? '',
    vendorBranch: vendor?.branch ?? '00000',
    vendorAddress: vendor?.address ?? '',
    formType: cert.formType,
    paidAt: cert.paidAt,
    incomeType: cert.incomeType,
    basis: cert.basis,
    wht: cert.wht,
    status: cert.status,
  };
}

/**
 * Cancels a certificate issued wrongly; it keeps its number and prints with ยกเลิก across it. Finance,
 * the owner or an admin, with a reason. The PV stays paid: reissueWhtCert brings the certificate back.
 */
export async function voidWhtCert(
  db: Db,
  actor: SessionUser,
  certId: string,
  reason: string,
) {
  assertCan(actor, 'pv.manage');
  const why = reason.trim();
  if (!why) {
    throw new DomainError('REASON_REQUIRED', 'กรุณาระบุเหตุผลในการยกเลิกหนังสือรับรอง 50 ทวิ', 400);
  }
  if (!z.string().uuid().safeParse(certId).success) throw new DomainError('NOT_FOUND', 'ไม่พบหนังสือรับรอง 50 ทวิ', 404);

  return db.transaction(async (tx) => {
    const [cert] = await tx
      .select()
      .from(whtCerts)
      .where(eq(whtCerts.id, certId))
      .for('update');
    if (!cert) throw new DomainError('NOT_FOUND', 'ไม่พบหนังสือรับรอง 50 ทวิ', 404);
    if (cert.status === 'VOID') throw new DomainError('INVALID_STATUS', `${cert.number} ถูกยกเลิกไปแล้ว`, 409);

    await tx
      .update(whtCerts)
      .set({
        status: 'VOID',
        voidReason: why,
        updatedAt: new Date(),
      })
      .where(eq(whtCerts.id, cert.id));

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PV',
      entityId: cert.pvId,
      action: 'WHT_CERT_VOIDED',
      note: why,
      data: { certId: cert.id, number: cert.number },
    });
  });
}

/**
 * Brings back a cancelled certificate of a PV that is still paid, with its own number, worked out
 * again from the PV and the vendor as they are now
 */
export async function reissueWhtCert(db: Db, actor: SessionUser, certId: string) {
  assertCan(actor, 'pv.manage');
  if (!z.string().uuid().safeParse(certId).success) throw new DomainError('NOT_FOUND', 'ไม่พบหนังสือรับรอง 50 ทวิ', 404);

  return db.transaction(async (tx) => {
    const [cert] = await tx.select().from(whtCerts).where(eq(whtCerts.id, certId)).for('update');
    if (!cert) throw new DomainError('NOT_FOUND', 'ไม่พบหนังสือรับรอง 50 ทวิ', 404);
    if (cert.status !== 'VOID') throw new DomainError('INVALID_STATUS', `${cert.number} ยังไม่ได้ยกเลิก`, 409);
    const [pv] = await tx.select({ status: pvs.status, number: pvs.number }).from(pvs).where(eq(pvs.id, cert.pvId)).limit(1);
    if (pv?.status !== 'PAID') {
      throw new DomainError('INVALID_STATUS', `${pv?.number ?? 'ใบสำคัญจ่าย'} ยังไม่ได้จ่าย จึงออกหนังสือรับรองไม่ได้ จะออกให้เองเมื่อบันทึกจ่าย`, 409);
    }

    const id = await issueWhtCert(tx as unknown as Db, cert.pvId);
    if (!id) throw new DomainError('INVALID_STATUS', 'ใบสำคัญจ่ายนี้ไม่มีการหัก ณ ที่จ่ายแล้ว', 409);

    await logActivity(tx, {
      userId: actor.id,
      entityType: 'PV',
      entityId: cert.pvId,
      action: 'WHT_CERT_REISSUED',
      data: { certId: cert.id, number: cert.number },
    });
    return id;
  });
}

// Register hooks into PV and PDF services
registerWhtCertIssuer(issueWhtCert);

registerWhtPdfRenderer(async (db, actor, id) => {
  ensureFontsRegistered();
  const [cert, settings] = await Promise.all([
    getWhtCert(db, actor, id),
    getSettings(db),
  ]);
  const buf = await renderToBuffer(
    Wht50PdfDoc({ cert, settings }) as unknown as React.ReactElement<never>,
  );
  return { buffer: Buffer.from(buf), filename: `${cert.number}.pdf` };
});
