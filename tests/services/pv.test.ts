import { beforeEach, describe, expect, test } from 'vitest';
import { D } from '@/domain/money';
import { approvePo, createPo, getPo, submitPo } from '@/server/services/po';
import { createInvoice } from '@/server/services/invoice';
import { listOpenPayables, requestInstallment } from '@/server/services/payable';
import {
  approvePv,
  cancelPv,
  createPv,
  getPv,
  markPvPaid,
  submitPv,
  updateCheque,
} from '@/server/services/pv';
import { listActivity } from '@/server/services/activity';
import '@/server/services/wht-cert';
import { seedBasics, type SeededBasics } from '../helpers/fixtures';
import { EARLY_PAY_REASON, receiveAll } from '../helpers/receive';
import { eq } from 'drizzle-orm';
import { payables, pos, whtCerts } from '@/db/schema';
import { bangkokDateString } from '@/domain/thai';
import { createTestDb } from '../helpers/test-db';
import type { Db } from '@/db/client';

describe('pv service', () => {
  let db: Db;
  let f: SeededBasics;
  let creditPo: string;
  let installmentPo: string;

  beforeEach(async () => {
    db = await createTestDb();
    f = await seedBasics(db);

    const cPo = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'ปูนซีเมนต์',
          qty: D(10),
          unitName: 'ถุง',
          unitPrice: D(107),
          discount: D(0),
        },
      ],
    });
    creditPo = cPo.id;
    await submitPo(db, f.users.buyer, creditPo);
    await approvePo(db, f.users.buyerHead, creditPo);
    await receiveAll(db, f.users.foreman, creditPo);

    const iPo = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'INSTALLMENT',
      vatMode: 'INCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'โครงสร้างเหล็ก',
          qty: D(10),
          unitName: 'ชุด',
          unitPrice: D(107),
          discount: D(0),
        },
      ],
      installments: [
        { name: 'มัดจำ 30%', condition: 'BEFORE_PRODUCTION', percent: D(30), amount: D(321) },
        { name: 'งวดสุดท้าย 70%', condition: 'AFTER_DELIVERY', percent: D(70), amount: D(749) },
      ],
    });
    installmentPo = iPo.id;
    await submitPo(db, f.users.buyer, installmentPo);
    await approvePo(db, f.users.buyerHead, installmentPo);
  });

  test('PV with WHT 3% on VAT-inclusive PO uses before-VAT', async () => {
    await createInvoice(db, f.users.finance, {
      poId: creditPo,
      invoiceNo: 'IV-WHT',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(70),
    });
    const [p] = await listOpenPayables(db, f.users.finance, {});
    const created = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [p!.id],
      whtRates: { [p!.id]: 3 },
      note: 'จ่ายค่าปูน หัก 3%',
    });
    const pv = await getPv(db, f.users.finance, created.id);
    expect(pv).toMatchObject({
      beforeVat: '1000.00',
      vat: '70.00',
      gross: '1070.00',
      wht: '30.00',
      net: '1040.00',
    });
  });

  test('cannot put same payable in two PVs', async () => {
    await createInvoice(db, f.users.finance, {
      poId: creditPo,
      invoiceNo: 'IV-DUP-PV',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(70),
    });
    const [p] = await listOpenPayables(db, f.users.finance, {});
    await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [p!.id],
    });
    await expect(
      createPv(db, f.users.finance, {
        vendorId: f.vendorCo,
        payableIds: [p!.id],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('owner approves, finance pays, payables PAID, installment PAID', async () => {
    const poDoc = await getPo(db, f.users.buyer, installmentPo);
    const inst1 = poDoc.installments[0]!;
    const payableId = await requestInstallment(db, f.users.buyer, inst1.id);

    const created = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [payableId],
    });
    await submitPv(db, f.users.finance, created.id);
    await approvePv(db, f.users.owner, created.id);
    await markPvPaid(db, f.users.finance, created.id, {
      paidAt: '2026-11-03',
      payMethod: 'TRANSFER',
      payFromAccount: 'KBANK-001',
      payRef: 'SLIP-001',
    });

    const pv = await getPv(db, f.users.finance, created.id);
    expect(pv.status).toBe('PAID');
    expect(pv.lines[0]!.payableStatus).toBe('PAID');

    const poAfter = await getPo(db, f.users.buyer, installmentPo);
    expect(poAfter.installments[0]!.status).toBe('PAID');
  });

  test('overpay blocked without reason, allowed with reason (logged)', async () => {
    await createInvoice(db, f.users.finance, {
      poId: creditPo,
      invoiceNo: 'IV-OVER-1',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(70),
    });
    const [p] = await listOpenPayables(db, f.users.finance, {});
    // An extra charge (e.g. delivery) raised on the bill takes it past the PO total
    await db.update(payables).set({ beforeVat: '1100.00', vat: '77.00', gross: '1177.00' }).where(eq(payables.id, p!.id));
    const created = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [p!.id],
    });
    await submitPv(db, f.users.finance, created.id);

    await expect(approvePv(db, f.users.owner, created.id)).rejects.toMatchObject({
      code: 'OVERPAY',
      status: 409,
    });

    await approvePv(db, f.users.owner, created.id, 'อนุมัติจ่ายค่าขนส่งเพิ่มตามจริง');
    const pv = await getPv(db, f.users.finance, created.id);
    expect(pv.status).toBe('APPROVED');
    expect(pv.overrideReason).toBe('อนุมัติจ่ายค่าขนส่งเพิ่มตามจริง');

    const acts = await listActivity(db, 'PV', created.id);
    expect(acts.some((a) => a.action === 'APPROVED')).toBe(true);
  });

  test('double approve call is idempotent-safe: second call fails with status error', async () => {
    await createInvoice(db, f.users.finance, {
      poId: creditPo,
      invoiceNo: 'IV-DBL',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(70),
    });
    const [p] = await listOpenPayables(db, f.users.finance, {});
    const created = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [p!.id],
    });
    await submitPv(db, f.users.finance, created.id);
    await approvePv(db, f.users.owner, created.id, EARLY_PAY_REASON);
    await expect(approvePv(db, f.users.owner, created.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  test('finance cannot approve', async () => {
    await createInvoice(db, f.users.finance, {
      poId: creditPo,
      invoiceNo: 'IV-FIN-NO',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(70),
    });
    const [p] = await listOpenPayables(db, f.users.finance, {});
    const created = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [p!.id],
    });
    await submitPv(db, f.users.finance, created.id);
    await expect(approvePv(db, f.users.finance, created.id)).rejects.toMatchObject({
      status: 403,
    });
  });

  async function approvedCreditPv(invoiceNo: string, dueDate?: string) {
    await createInvoice(db, f.users.finance, { poId: creditPo, invoiceNo, invoiceDate: '2026-11-02', beforeVat: D(1000), vat: D(70), dueDate });
    const [p] = await listOpenPayables(db, f.users.finance, {});
    const created = await createPv(db, f.users.finance, { vendorId: f.vendorCo, payableIds: [p!.id], whtRates: { [p!.id]: 3 } });
    await submitPv(db, f.users.finance, created.id);
    return created.id;
  }

  test('paying a bill before it falls due needs the owner to give a reason', async () => {
    const pvId = await approvedCreditPv('IV-EARLY');
    await expect(approvePv(db, f.users.owner, pvId)).rejects.toMatchObject({ code: 'EARLY_PAYMENT' });
    await approvePv(db, f.users.owner, pvId, 'ผู้ขายให้ส่วนลดเงินสด');
    expect((await getPv(db, f.users.finance, pvId)).overrideReason).toBe('ผู้ขายให้ส่วนลดเงินสด');
  });

  test('a bill already due is approved without a reason', async () => {
    const pvId = await approvedCreditPv('IV-DUE', bangkokDateString());
    await approvePv(db, f.users.owner, pvId);
    expect((await getPv(db, f.users.finance, pvId)).status).toBe('APPROVED');
  });

  test('paying by cheque needs its details, then the cheque is collected and clears', async () => {
    const pvId = await approvedCreditPv('IV-CHQ');
    await approvePv(db, f.users.owner, pvId, EARLY_PAY_REASON);
    const today = bangkokDateString();
    await expect(markPvPaid(db, f.users.finance, pvId, { paidAt: today, payMethod: 'CHEQUE' })).rejects.toMatchObject({ code: 'CHEQUE_REQUIRED' });
    await markPvPaid(db, f.users.finance, pvId, { paidAt: today, payMethod: 'CHEQUE', cheque: { no: '1234567', bank: 'กสิกรไทย', date: today } });
    let pv = await getPv(db, f.users.finance, pvId);
    expect(pv).toMatchObject({ status: 'PAID', chequeNo: '1234567', chequeStatus: 'ISSUED' });

    await expect(updateCheque(db, f.users.finance, pvId, { action: 'CLEAR', at: today })).rejects.toMatchObject({ status: 409 });
    await updateCheque(db, f.users.finance, pvId, { action: 'COLLECT', by: 'นายสมชาย', at: today });
    await updateCheque(db, f.users.finance, pvId, { action: 'CLEAR', at: today });
    pv = await getPv(db, f.users.finance, pvId);
    expect(pv).toMatchObject({ chequeStatus: 'CLEARED', chequeCollectedBy: 'นายสมชาย' });
    await expect(updateCheque(db, f.users.finance, pvId, { action: 'VOID', reason: 'x' })).rejects.toMatchObject({ status: 409 });
  });

  test('voiding a cheque puts the bill back to awaiting payment, and a new cheque reuses the 50 ทวิ', async () => {
    const pvId = await approvedCreditPv('IV-VOID');
    await approvePv(db, f.users.owner, pvId, EARLY_PAY_REASON);
    const today = bangkokDateString();
    await markPvPaid(db, f.users.finance, pvId, { paidAt: today, payMethod: 'CHEQUE', cheque: { no: '111', bank: 'กรุงเทพ', date: today } });
    const certId = (await getPv(db, f.users.finance, pvId)).whtCertId;
    expect(certId).toBeTruthy();

    await updateCheque(db, f.users.finance, pvId, { action: 'VOID', reason: 'เขียนเช็คผิด' });
    const pv = await getPv(db, f.users.finance, pvId);
    expect(pv).toMatchObject({ status: 'APPROVED', chequeStatus: 'VOID', whtCertId: null });
    expect(pv.lines[0]!.payableStatus).toBe('IN_PV');
    const [cert] = await db.select().from(whtCerts).where(eq(whtCerts.id, certId!));
    expect(cert!.status).toBe('VOID');

    await markPvPaid(db, f.users.finance, pvId, { paidAt: today, payMethod: 'CHEQUE', cheque: { no: '222', bank: 'กรุงเทพ', date: today } });
    const again = await getPv(db, f.users.finance, pvId);
    expect(again).toMatchObject({ status: 'PAID', chequeNo: '222', chequeStatus: 'ISSUED', whtCertId: certId });
    const [po] = await db.select().from(pos).where(eq(pos.id, creditPo));
    expect(po!.status).not.toBe('CANCELLED');
  });

  test('cancel releases payables to OPEN', async () => {
    await createInvoice(db, f.users.finance, {
      poId: creditPo,
      invoiceNo: 'IV-REL',
      invoiceDate: '2026-11-02',
      beforeVat: D(1000),
      vat: D(70),
    });
    const [p] = await listOpenPayables(db, f.users.finance, {});
    const created = await createPv(db, f.users.finance, {
      vendorId: f.vendorCo,
      payableIds: [p!.id],
    });
    expect((await listOpenPayables(db, f.users.finance, {})).length).toBe(0);

    await cancelPv(db, f.users.finance, created.id, 'สร้างผิด');
    expect((await listOpenPayables(db, f.users.finance, {})).length).toBe(1);
  });
});
