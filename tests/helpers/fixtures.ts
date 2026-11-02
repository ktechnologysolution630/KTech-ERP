import { type Db } from '@/db/client';
import {
  items,
  projectMembers,
  projects,
  units,
  userRoles,
  users,
  vendors,
  receipts,
  receiptLines,
  type Role,
  type SessionUser,
} from '@/db/schema';
import { type Decimal } from '@/domain/money';
import { bangkokDateString } from '@/domain/thai';

export async function receiveDirect(
  db: Db,
  poId: string,
  poLineId: string,
  receivedBy: string,
  qty: Decimal,
): Promise<string> {
  const [rec] = await db
    .insert(receipts)
    .values({
      poId,
      poRevision: 0,
      receivedAt: bangkokDateString(),
      receivedBy,
      status: 'CONFIRMED',
    })
    .returning();
  await db.insert(receiptLines).values({
    receiptId: rec.id,
    poLineId,
    qty: qty.toDecimalPlaces(3).toFixed(3),
  });
  return rec.id;
}

export type SeededBasics = {
  users: Record<
    'foreman' | 'pm' | 'buyer' | 'buyerHead' | 'finance' | 'owner' | 'admin' | 'otherForeman',
    SessionUser
  >;
  projectA: string;
  projectB: string;
  vendorCo: string;
  vendorPerson: string;
  unitBag: string;
  itemCement: string;
};

export async function seedBasics(db: Db): Promise<SeededBasics> {
  const [projA, projB] = await db
    .insert(projects)
    .values([
      { code: 'PJ-001', name: 'โครงการก่อสร้างคลังสินค้า A' },
      { code: 'PJ-002', name: 'โครงการอาคารสำนักงาน B' },
    ])
    .returning();

  const userDefs: {
    key: keyof SeededBasics['users'];
    email: string;
    name: string;
    roles: Role[];
    projectIds: string[];
  }[] = [
    {
      key: 'foreman',
      email: 'foreman@ktec.local',
      name: 'สมชาย หน้างาน',
      roles: ['FOREMAN'],
      projectIds: [projA.id],
    },
    {
      key: 'otherForeman',
      email: 'foreman2@ktec.local',
      name: 'สมหมาย หน้างาน B',
      roles: ['FOREMAN'],
      projectIds: [projB.id],
    },
    {
      key: 'pm',
      email: 'pm@ktec.local',
      name: 'วิชัย ผู้จัดการโครงการ',
      roles: ['PM'],
      projectIds: [projA.id],
    },
    {
      key: 'buyer',
      email: 'buyer@ktec.local',
      name: 'กานดา จัดซื้อ',
      roles: ['PURCHASING'],
      projectIds: [],
    },
    {
      key: 'buyerHead',
      email: 'buyerhead@ktec.local',
      name: 'อรอนงค์ หัวหน้าจัดซื้อ',
      roles: ['PURCHASING_HEAD'],
      projectIds: [],
    },
    {
      key: 'finance',
      email: 'finance@ktec.local',
      name: 'นภา การเงิน',
      roles: ['FINANCE'],
      projectIds: [],
    },
    {
      key: 'owner',
      email: 'owner@ktec.local',
      name: 'ประเสริฐ เจ้าของบริษัท',
      roles: ['OWNER'],
      projectIds: [],
    },
    {
      key: 'admin',
      email: 'admin@ktec.local',
      name: 'แอดมิน ระบบ',
      roles: ['ADMIN'],
      projectIds: [],
    },
  ];

  const seededUsers = {} as SeededBasics['users'];

  for (const u of userDefs) {
    const [inserted] = await db
      .insert(users)
      .values({
        email: u.email,
        name: u.name,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012',
      })
      .returning();

    await db.insert(userRoles).values(
      u.roles.map((role) => ({
        userId: inserted.id,
        role,
      })),
    );

    if (u.projectIds.length > 0) {
      await db.insert(projectMembers).values(
        u.projectIds.map((projectId) => ({
          projectId,
          userId: inserted.id,
        })),
      );
    }

    seededUsers[u.key] = {
      id: inserted.id,
      email: u.email,
      name: u.name,
      roles: u.roles,
      projectIds: u.projectIds,
    };
  }

  const [vCo, vPerson] = await db
    .insert(vendors)
    .values([
      {
        code: 'V-001',
        name: 'บริษัท สยามวัสดุก่อสร้าง จำกัด',
        type: 'COMPANY',
        taxId: '0105551234567',
        branch: '00000',
        address: '123 ถนนพระราม 2 กรุงเทพฯ',
        phone: '021234567',
        bankName: 'กสิกรไทย',
        bankAccountNo: '123-4-56789-0',
        bankAccountName: 'บจก. สยามวัสดุก่อสร้าง',
        defaultCreditDays: 30,
        defaultWhtRate: 0,
      },
      {
        code: 'V-002',
        name: 'นายสมศักดิ์ บริการขนส่ง',
        type: 'INDIVIDUAL',
        taxId: '1100500123456',
        branch: '00000',
        address: '99นนทบุรี',
        phone: '0812345678',
        bankName: 'ไทยพาณิชย์',
        bankAccountNo: '987-6-54321-0',
        bankAccountName: 'นายสมศักดิ์ บริการขนส่ง',
        defaultCreditDays: 7,
        defaultWhtRate: 3,
      },
    ])
    .returning();

  const [uBag] = await db.insert(units).values({ name: 'ถุง' }).returning();
  const [cement] = await db
    .insert(items)
    .values({
      code: 'MAT-001',
      name: 'ปูนซีเมนต์ปอร์ตแลนด์',
      unitId: uBag.id,
      category: 'วัสดุโครงสร้าง',
    })
    .returning();

  return {
    users: seededUsers,
    projectA: projA.id,
    projectB: projB.id,
    vendorCo: vCo.id,
    vendorPerson: vPerson.id,
    unitBag: uBag.id,
    itemCement: cement.id,
  };
}
