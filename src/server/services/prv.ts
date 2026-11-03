import { eq, desc, and } from 'drizzle-orm';
import { type Db } from '@/db/client';
import {
  prvs,
  prvItems,
  projects,
  vendors,
  pos,
  users,
  type PrvCategory,
  type PrvStatus,
} from '@/db/schema';
import { nextDocNumber } from './numbering';
import Decimal from 'decimal.js';

export type { PrvCategory, PrvStatus };

export interface PrvLineInput {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  progressPercent?: number;
}

export interface CreatePrvInput {
  date?: string;
  projectId: string;
  poId?: string | null;
  vendorId?: string | null;
  payeeName: string;
  category: PrvCategory;
  installmentNo?: number | null;
  retentionPercent?: number;
  whtRate?: number;
  vatRate?: number; // 7% or 0%
  notes?: string;
  attachments?: string[];
  items: PrvLineInput[];
}

export async function createPrv(db: Db, input: CreatePrvInput, requestedBy: string) {
  const prvNumber = await nextDocNumber(db, 'PRV');

  let totalAmount = new Decimal(0);
  for (const it of input.items) {
    const qty = new Decimal(it.quantity);
    const price = new Decimal(it.unitPrice);
    totalAmount = totalAmount.add(qty.mul(price));
  }

  const retPct = new Decimal(input.retentionPercent ?? 0);
  const retentionAmount = totalAmount.mul(retPct).div(100);

  const whtPct = new Decimal(input.whtRate ?? 0);
  const whtAmount = totalAmount.mul(whtPct).div(100);

  const vatPct = new Decimal(input.vatRate ?? 0);
  const vatAmount = totalAmount.mul(vatPct).div(100);

  // Net amount = Total - Retention - WHT + VAT
  const netAmount = totalAmount.sub(retentionAmount).sub(whtAmount).add(vatAmount);

  const [prv] = await db
    .insert(prvs)
    .values({
      prvNumber,
      date: input.date || new Date().toISOString().slice(0, 10),
      projectId: input.projectId,
      poId: input.poId || null,
      vendorId: input.vendorId || null,
      payeeName: input.payeeName,
      category: input.category,
      installmentNo: input.installmentNo || null,
      totalAmount: totalAmount.toFixed(2),
      retentionPercent: retPct.toFixed(2),
      retentionAmount: retentionAmount.toFixed(2),
      whtRate: whtPct.toFixed(2),
      whtAmount: whtAmount.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      netAmount: netAmount.toFixed(2),
      status: 'DRAFT',
      requestedBy,
      notes: input.notes || '',
      attachments: JSON.stringify(input.attachments || []),
    })
    .returning();

  for (const it of input.items) {
    const qty = new Decimal(it.quantity);
    const price = new Decimal(it.unitPrice);
    const amount = qty.mul(price);

    await db.insert(prvItems).values({
      prvId: prv.id,
      description: it.description,
      quantity: qty.toFixed(3),
      unit: it.unit,
      unitPrice: price.toFixed(2),
      amount: amount.toFixed(2),
      progressPercent: String(it.progressPercent ?? 100),
    });
  }

  return prv;
}

export async function getPrvs(
  db: Db,
  filters?: {
    projectId?: string;
    status?: PrvStatus;
    category?: PrvCategory;
  },
) {
  const allPrvs = await db.select().from(prvs).orderBy(desc(prvs.createdAt));
  const allProjects = await db.select().from(projects);
  const allUsers = await db.select().from(users);
  const allVendors = await db.select().from(vendors);

  const projectMap = new Map(allProjects.map((p) => [p.id, p.name]));
  const userMap = new Map(allUsers.map((u) => [u.id, u.name]));
  const vendorMap = new Map(allVendors.map((v) => [v.id, v.name]));

  return allPrvs
    .filter((p) => {
      if (filters?.projectId && p.projectId !== filters.projectId) return false;
      if (filters?.status && p.status !== filters.status) return false;
      if (filters?.category && p.category !== filters.category) return false;
      return true;
    })
    .map((p) => ({
      ...p,
      projectName: projectMap.get(p.projectId) || '-',
      requestedByName: userMap.get(p.requestedBy) || '-',
      verifiedByName: p.verifiedBy ? userMap.get(p.verifiedBy) || '-' : null,
      approvedByName: p.approvedBy ? userMap.get(p.approvedBy) || '-' : null,
      vendorName: p.vendorId ? vendorMap.get(p.vendorId) || '-' : null,
    }));
}

export async function getPrvById(db: Db, id: string) {
  const [prv] = await db.select().from(prvs).where(eq(prvs.id, id)).limit(1);
  if (!prv) return null;

  const items = await db.select().from(prvItems).where(eq(prvItems.prvId, prv.id));
  const [project] = await db.select().from(projects).where(eq(projects.id, prv.projectId)).limit(1);
  const [vendor] = prv.vendorId
    ? await db.select().from(vendors).where(eq(vendors.id, prv.vendorId)).limit(1)
    : [null];
  const [po] = prv.poId
    ? await db.select().from(pos).where(eq(pos.id, prv.poId)).limit(1)
    : [null];
  const [requestedByUser] = await db.select().from(users).where(eq(users.id, prv.requestedBy)).limit(1);
  const [verifiedByUser] = prv.verifiedBy
    ? await db.select().from(users).where(eq(users.id, prv.verifiedBy)).limit(1)
    : [null];
  const [approvedByUser] = prv.approvedBy
    ? await db.select().from(users).where(eq(users.id, prv.approvedBy)).limit(1)
    : [null];

  return {
    ...prv,
    items,
    project,
    vendor,
    po,
    requestedByName: requestedByUser?.name || '-',
    verifiedByName: verifiedByUser?.name || null,
    approvedByName: approvedByUser?.name || null,
  };
}

export async function updatePrvStatus(
  db: Db,
  id: string,
  newStatus: PrvStatus,
  userId: string,
) {
  const updateData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (newStatus === 'PM_VERIFIED') {
    updateData.verifiedBy = userId;
    updateData.verifiedAt = new Date();
  } else if (newStatus === 'APPROVED') {
    updateData.approvedBy = userId;
    updateData.approvedAt = new Date();
  }

  const [updated] = await db
    .update(prvs)
    .set(updateData)
    .where(eq(prvs.id, id))
    .returning();

  return updated;
}
