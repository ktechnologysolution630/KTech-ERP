import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { createPr, submitPr, approvePr, getPr } from '@/server/services/pr';
import {
  createPo,
  updatePo,
  submitPo,
  approvePo,
  rejectPo,
  markOrdered,
  cancelPo,
  getPo,
} from '@/server/services/po';
import { receiveDirect } from '../helpers/fixtures';
import { D } from '@/domain/money';
import { DomainError } from '@/domain/errors';

describe('PO service', () => {
  test('po from PR splits PR across vendors and tracks ordered qty', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const pr = await createPr(db, f.users.foreman, {
      projectId: f.projectA,
      lines: [
        {
          description: 'ปูนซีเมนต์',
          unitName: 'ถุง',
          qty: D(100),
        },
      ],
    });
    await submitPr(db, f.users.foreman, pr.id);
    await approvePr(db, f.users.pm, pr.id);
    const prDoc = await getPr(db, f.users.pm, pr.id);
    const prLineId = prDoc.lines[0].id;

    await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      creditDays: 30,
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          prLineId,
          description: 'ปูนซีเมนต์',
          unitName: 'ถุง',
          qty: D(60),
          unitPrice: D(100),
          discount: D(0),
        },
      ],
    });
    expect((await getPr(db, f.users.pm, pr.id)).orderProgress).toBe('PARTIAL');

    await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorPerson,
      paymentType: 'CREDIT',
      creditDays: 7,
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          prLineId,
          description: 'ปูนซีเมนต์',
          unitName: 'ถุง',
          qty: D(40),
          unitPrice: D(105),
          discount: D(0),
        },
      ],
    });
    expect((await getPr(db, f.users.pm, pr.id)).orderProgress).toBe('FULL');

    await expect(
      createPo(db, f.users.buyer, {
        projectId: f.projectA,
        vendorId: f.vendorCo,
        paymentType: 'CREDIT',
        vatMode: 'NONE',
        billDiscount: D(0),
        shipping: D(0),
        lines: [
          {
            prLineId,
            description: 'ปูนซีเมนต์',
            unitName: 'ถุง',
            qty: D(1),
            unitPrice: D(100),
            discount: D(0),
          },
        ],
      }),
    ).rejects.toThrow(DomainError);
  });

  test('office PO without PR, approval routing by limit, and creator cannot approve own PO', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    // Under 50,000 limit: buyer creates, buyerHead approves
    const poSmall = await createPo(db, f.users.buyer, {
      projectId: null,
      vendorId: f.vendorCo,
      paymentType: 'PREPAID',
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'กระดาษ A4 สำนักงาน',
          unitName: 'รีม',
          qty: D(10),
          unitPrice: D(100),
          discount: D(0),
        },
      ],
    });
    expect(poSmall.number).toMatch(/^PO-\d{4}-\d{4}$/);
    await submitPo(db, f.users.buyer, poSmall.id);
    await approvePo(db, f.users.buyerHead, poSmall.id);
    expect((await getPo(db, f.users.buyer, poSmall.id)).status).toBe('APPROVED');

    // Creator is buyerHead → cannot approve own PO
    const poByHead = await createPo(db, f.users.buyerHead, {
      projectId: null,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'หมึกพิมพ์',
          unitName: 'กล่อง',
          qty: D(1),
          unitPrice: D(500),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyerHead, poByHead.id);
    await expect(approvePo(db, f.users.buyerHead, poByHead.id)).rejects.toMatchObject({
      status: 403,
    });
    await approvePo(db, f.users.owner, poByHead.id);

    // At/over limit (50,000): buyerHead cannot approve, owner can
    const poLarge = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'คอนกรีตผสมเสร็จ',
          unitName: 'คิว',
          qty: D(25),
          unitPrice: D(2000),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, poLarge.id);
    await expect(approvePo(db, f.users.buyerHead, poLarge.id)).rejects.toMatchObject({
      status: 403,
    });
    await approvePo(db, f.users.owner, poLarge.id);
    expect((await getPo(db, f.users.owner, poLarge.id)).status).toBe('APPROVED');
  });

  test('installments must total 100%, reject -> edit -> resubmit keeps number', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await expect(
      createPo(db, f.users.buyer, {
        projectId: f.projectA,
        vendorId: f.vendorCo,
        paymentType: 'INSTALLMENT',
        vatMode: 'NONE',
        billDiscount: D(0),
        shipping: D(0),
        lines: [
          {
            description: 'งานสั่งผลิตโครงเหล็ก',
            unitName: 'งาน',
            qty: D(1),
            unitPrice: D(10000),
            discount: D(0),
          },
        ],
        installments: [{ name: 'งวด 1', percent: D(50), condition: 'BEFORE_PRODUCTION' }],
      }),
    ).rejects.toThrow(DomainError);

    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'INSTALLMENT',
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'งานสั่งผลิตโครงเหล็ก',
          unitName: 'งาน',
          qty: D(1),
          unitPrice: D(10000),
          discount: D(0),
        },
      ],
      installments: [
        { name: 'มัดจำ', percent: D(30), condition: 'BEFORE_PRODUCTION' },
        { name: 'ส่งมอบ', percent: D(70), condition: 'AFTER_DELIVERY' },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await rejectPo(db, f.users.buyerHead, po.id, 'ต่อรองราคาเพิ่ม');
    expect((await getPo(db, f.users.buyer, po.id)).status).toBe('REJECTED');

    await updatePo(db, f.users.buyer, po.id, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'INSTALLMENT',
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'งานสั่งผลิตโครงเหล็ก',
          unitName: 'งาน',
          qty: D(1),
          unitPrice: D(9000),
          discount: D(0),
        },
      ],
      installments: [
        { name: 'มัดจำ', percent: D(30), condition: 'BEFORE_PRODUCTION' },
        { name: 'ส่งมอบ', percent: D(70), condition: 'AFTER_DELIVERY' },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    const updated = await getPo(db, f.users.buyer, po.id);
    expect(updated.number).toBe(po.number);
    expect(updated.gross).toBe('9000.00');
  });

  test('revision after receipt cannot drop qty below received and cancel blocked after receipt', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [
        {
          description: 'อิฐมวลเบา',
          unitName: 'ก้อน',
          qty: D(100),
          unitPrice: D(20),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    await markOrdered(db, f.users.buyer, po.id);

    const poDoc = await getPo(db, f.users.buyer, po.id);
    const lineId = poDoc.lines[0].id;
    await receiveDirect(db, po.id, lineId, f.users.foreman.id, D(50));

    // Cancel blocked after receipt
    await expect(cancelPo(db, f.users.buyer, po.id, 'ยกเลิก')).rejects.toMatchObject({
      code: 'PO_HAS_ACTIVITY',
    });

    // Revision dropping qty below 50 is rejected
    await expect(
      updatePo(db, f.users.buyer, po.id, {
        projectId: f.projectA,
        vendorId: f.vendorCo,
        paymentType: 'CREDIT',
        vatMode: 'NONE',
        billDiscount: D(0),
        shipping: D(0),
        reason: 'ลดจำนวน',
        lines: [
          {
            id: lineId,
            description: 'อิฐมวลเบา',
            unitName: 'ก้อน',
            qty: D(40),
            unitPrice: D(20),
            discount: D(0),
          },
        ],
      }),
    ).rejects.toThrow(DomainError);

    // Valid revision to 80 stores pendingRevision, then approvePo applies it
    await updatePo(db, f.users.buyer, po.id, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      reason: 'ปรับลดจำนวนตามหน้างาน',
      lines: [
        {
          id: lineId,
          description: 'อิฐมวลเบา',
          unitName: 'ก้อน',
          qty: D(80),
          unitPrice: D(20),
          discount: D(0),
        },
      ],
    });
    await submitPo(db, f.users.buyer, po.id);
    const withPending = await getPo(db, f.users.buyer, po.id);
    expect(withPending.pendingRevision).toBeTruthy();
    expect(withPending.lines[0].qty).toBe('100.000'); // Live still 100 until approved

    await approvePo(db, f.users.buyerHead, po.id);
    const afterRev = await getPo(db, f.users.buyer, po.id);
    expect(afterRev.pendingRevision).toBeNull();
    expect(afterRev.lines[0].qty).toBe('80.000');
    expect(afterRev.approvedRevision).toBe(1);
  });
});
