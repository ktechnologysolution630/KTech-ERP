import { gte, sql } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { arInvoices, attachments, dailyReports, pos, prs, projects, pvs, users, type SessionUser } from '@/db/schema';
import { type ProjectStatus } from '@/domain/project';
import { bangkokDateString } from '@/domain/thai';
import { assertCan } from '@/server/policy';

export interface SystemUsage {
  users: { active: number; inactive: number };
  projects: Partial<Record<ProjectStatus, number>>;
  storage: { files: number; bytes: number };
  thisMonth: { label: string; count: number }[];
  database: 'PGLITE' | 'POSTGRES';
  fileStorage: 'LOCAL' | 'BLOB';
}

/** What this installation holds: users, projects, stored files and this month's documents. */
export async function getSystemUsage(db: Db, actor: SessionUser): Promise<SystemUsage> {
  assertCan(actor, 'settings.manage');
  const monthStart = new Date(`${bangkokDateString().slice(0, 7)}-01T00:00:00+07:00`);

  const [userRows, projectRows, fileRows, prCount, poCount, pvCount, arCount, drCount] = await Promise.all([
    db.select({ active: users.active, n: sql<number>`count(*)::int` }).from(users).groupBy(users.active),
    db.select({ status: projects.status, n: sql<number>`count(*)::int` }).from(projects).groupBy(projects.status),
    db.select({ n: sql<number>`count(*)::int`, bytes: sql<string>`coalesce(sum(${attachments.size}), 0)` }).from(attachments),
    db.select({ n: sql<number>`count(*)::int` }).from(prs).where(gte(prs.createdAt, monthStart)),
    db.select({ n: sql<number>`count(*)::int` }).from(pos).where(gte(pos.createdAt, monthStart)),
    db.select({ n: sql<number>`count(*)::int` }).from(pvs).where(gte(pvs.createdAt, monthStart)),
    db.select({ n: sql<number>`count(*)::int` }).from(arInvoices).where(gte(arInvoices.createdAt, monthStart)),
    db.select({ n: sql<number>`count(*)::int` }).from(dailyReports).where(gte(dailyReports.createdAt, monthStart)),
  ]);

  const url = process.env.DATABASE_URL ?? '';
  return {
    users: {
      active: Number(userRows.find((r) => r.active)?.n ?? 0),
      inactive: Number(userRows.find((r) => !r.active)?.n ?? 0),
    },
    projects: Object.fromEntries(projectRows.map((r) => [r.status, Number(r.n)])),
    storage: { files: Number(fileRows[0]?.n ?? 0), bytes: Number(fileRows[0]?.bytes ?? 0) },
    thisMonth: [
      { label: 'ใบขอซื้อ (PR)', count: Number(prCount[0]?.n ?? 0) },
      { label: 'ใบสั่งซื้อ (PO)', count: Number(poCount[0]?.n ?? 0) },
      { label: 'ใบสำคัญจ่าย (PV)', count: Number(pvCount[0]?.n ?? 0) },
      { label: 'ใบแจ้งหนี้ลูกค้า', count: Number(arCount[0]?.n ?? 0) },
      { label: 'รายงานประจำวัน', count: Number(drCount[0]?.n ?? 0) },
    ],
    database: !url || url.startsWith('pglite:') ? 'PGLITE' : 'POSTGRES',
    fileStorage: process.env.BLOB_READ_WRITE_TOKEN ? 'BLOB' : 'LOCAL',
  };
}
