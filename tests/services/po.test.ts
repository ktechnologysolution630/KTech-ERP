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
  reviewPo,
} from '@/server/services/po';
import { receiveDirect } from '../helpers/fixtures';
import { D } from '@/domain/money';
import { DomainError } from '@/domain/errors';
import { and, eq } from 'drizzle-orm';
import { activityLogs, notifications } from '@/db/schema';
import { getInbox } from '@/server/services/inbox';

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
    await reviewPo(db, f.users.buyerHead, poSmall.id);
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
    await reviewPo(db, f.users.buyerHead, poLarge.id);
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
    await reviewPo(db, f.users.buyerHead, po.id);
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
    await reviewPo(db, f.users.buyerHead, po.id);
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
    await reviewPo(db, f.users.buyerHead, po.id);
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

describe('PO document header', () => {
  test('keeps the printed header and line detail, through a revision after approval', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'PREPAID',
      terms: { payMethod: 'PROMPTPAY' },
      header: { docDate: '2026-11-10', department: 'จัดซื้อ', requesterName: 'นายช่าง', paymentTerms: 'จ่ายก่อนส่งของ' },
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ทราย', detail: 'ทรายหยาบ', unitName: 'คิว', qty: D(2), unitPrice: D(500), discount: D(0) }],
    });
    let doc = await getPo(db, f.users.buyer, po.id);
    expect(doc).toMatchObject({ docDate: '2026-11-10', department: 'จัดซื้อ', requesterName: 'นายช่าง', paymentTerms: 'จ่ายก่อนส่งของ', payMethod: 'PROMPTPAY' });
    expect(doc.lines[0]!.detail).toBe('ทรายหยาบ');

    await submitPo(db, f.users.buyer, po.id);

    await reviewPo(db, f.users.buyerHead, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    await updatePo(db, f.users.buyer, po.id, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'PREPAID',
      header: { department: 'ฝ่ายก่อสร้าง' },
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      reason: 'แก้รายละเอียด',
      lines: [{ id: doc.lines[0]!.id, description: 'ทราย', detail: 'ทรายละเอียด', unitName: 'คิว', qty: D(2), unitPrice: D(500), discount: D(0) }],
    });
    await submitPo(db, f.users.buyer, po.id);
    await approvePo(db, f.users.buyerHead, po.id);
    doc = await getPo(db, f.users.buyer, po.id);
    expect(doc).toMatchObject({ department: 'ฝ่ายก่อสร้าง', requesterName: 'นายช่าง', docDate: '2026-11-10' });
    expect(doc.lines[0]!.detail).toBe('ทรายละเอียด');
  });
});

describe('the purchasing head checks a PO before the owner', () => {
  const officePo = (db: Awaited<ReturnType<typeof createTestDb>>, f: Awaited<ReturnType<typeof seedBasics>>, by = f.users.buyer) =>
    createPo(db, by, {
      projectId: null,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      vatMode: 'EXCLUSIVE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'กระดาษ A4', unitName: 'รีม', qty: D(10), unitPrice: D(100), discount: D(0) }],
    });
  const notesTo = async (db: Awaited<ReturnType<typeof createTestDb>>, userId: string, poId: string) =>
    (await db.select().from(notifications).where(eq(notifications.href, `/po/${poId}`))).filter((n) => n.userId === userId).map((n) => n.title);

  test('purchasing sends it to the head; once the head approves, it goes to the owner', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await officePo(db, f);

    await submitPo(db, f.users.buyer, po.id);
    expect(await getPo(db, f.users.buyer, po.id)).toMatchObject({ status: 'PENDING_REVIEW', reviewedBy: null });
    expect(await notesTo(db, f.users.buyerHead.id, po.id)).toEqual([`ใบสั่งซื้อ ${po.number} รอหัวหน้าจัดซื้อตรวจสอบ`]);
    expect(await notesTo(db, f.users.owner.id, po.id)).toEqual([]);
    // The owner cannot skip the head, and nobody but the head checks it
    await expect(approvePo(db, f.users.owner, po.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(reviewPo(db, f.users.buyer, po.id)).rejects.toMatchObject({ status: 403 });
    await expect(reviewPo(db, f.users.owner, po.id)).rejects.toMatchObject({ status: 403 });
    // Only the head is asked to decide it
    expect((await getInbox(db, f.users.buyerHead)).map((g) => g.key)).toContain('PO_TO_REVIEW');
    expect((await getInbox(db, f.users.owner)).map((g) => g.key)).not.toContain('PO_TO_APPROVE');

    await reviewPo(db, f.users.buyerHead, po.id);
    const reviewed = await getPo(db, f.users.buyer, po.id);
    expect(reviewed).toMatchObject({ status: 'PENDING_APPROVAL', reviewedBy: f.users.buyerHead.id });
    expect(reviewed.reviewedAt).toBeInstanceOf(Date);
    expect(await notesTo(db, f.users.owner.id, po.id)).toEqual([`ใบสั่งซื้อ ${po.number} รออนุมัติ`]);
    expect((await getInbox(db, f.users.owner)).map((g) => g.key)).toContain('PO_TO_APPROVE');
    // Checked once is enough
    await expect(reviewPo(db, f.users.buyerHead, po.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

    await approvePo(db, f.users.owner, po.id);
    expect(await getPo(db, f.users.buyer, po.id)).toMatchObject({ status: 'APPROVED', reviewedBy: f.users.buyerHead.id, approvedBy: f.users.owner.id });
  });

  test('the head can send it back, and the buyer\'s resubmission waits for the head again', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await officePo(db, f);

    await submitPo(db, f.users.buyer, po.id);
    await expect(rejectPo(db, f.users.buyer, po.id, 'ไม่ผ่าน')).rejects.toMatchObject({ status: 403 });
    await rejectPo(db, f.users.buyerHead, po.id, 'ราคาสูงไป ขอใบเสนอราคาเพิ่ม');
    expect(await getPo(db, f.users.buyer, po.id)).toMatchObject({ status: 'REJECTED', rejectReason: 'ราคาสูงไป ขอใบเสนอราคาเพิ่ม' });

    await submitPo(db, f.users.buyer, po.id);
    expect(await getPo(db, f.users.buyer, po.id)).toMatchObject({ status: 'PENDING_REVIEW', reviewedBy: null, rejectReason: null });

    // Sent back by the owner after the head passed it, it needs the head again
    await reviewPo(db, f.users.buyerHead, po.id);
    await rejectPo(db, f.users.owner, po.id, 'เลื่อนไปเดือนหน้า');
    await submitPo(db, f.users.buyer, po.id);
    expect(await getPo(db, f.users.buyer, po.id)).toMatchObject({ status: 'PENDING_REVIEW', reviewedBy: null });
  });

  test('a PO the head sends counts as checked by the head and goes straight to the owner', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await officePo(db, f, f.users.buyerHead);

    await submitPo(db, f.users.buyerHead, po.id);
    expect(await getPo(db, f.users.buyer, po.id)).toMatchObject({ status: 'PENDING_APPROVAL', reviewedBy: f.users.buyerHead.id });
    expect(await notesTo(db, f.users.owner.id, po.id)).toEqual([`ใบสั่งซื้อ ${po.number} รออนุมัติ`]);
    await approvePo(db, f.users.owner, po.id);
    expect((await getPo(db, f.users.buyer, po.id)).status).toBe('APPROVED');
  });

  test('cancelling a PO twice leaves one cancel in its history', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    const po = await createPo(db, f.users.buyer, {
      projectId: f.projectA,
      vendorId: f.vendorCo,
      paymentType: 'CREDIT',
      vatMode: 'NONE',
      billDiscount: D(0),
      shipping: D(0),
      lines: [{ description: 'ทรายหยาบ', unitName: 'คิว', qty: D(5), unitPrice: D(400), discount: D(0) }],
    });
    await cancelPo(db, f.users.buyer, po.id, 'ผิดใบ');
    await cancelPo(db, f.users.buyer, po.id, 'กดซ้ำ');
    expect((await getPo(db, f.users.buyer, po.id)).status).toBe('CANCELLED');
    const cancels = await db
      .select()
      .from(activityLogs)
      .where(and(eq(activityLogs.entityId, po.id), eq(activityLogs.action, 'cancel')));
    expect(cancels).toHaveLength(1);
  });
});
