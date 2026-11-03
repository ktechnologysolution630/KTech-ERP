import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { type MilestoneKind } from '@/domain/milestone';
import { requireUser } from '@/server/auth/current-user';
import { listVendors } from '@/server/services/master';
import { getMilestoneSheet, type MilestoneSheet } from '@/server/services/milestones';
import { MilestoneSheetClient } from './milestone-sheet-client';

export default async function ProjectMilestonesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const [{ projectId }, sp] = await Promise.all([params, searchParams]);
  const kind: MilestoneKind = sp.kind === 'RECEIVE' ? 'RECEIVE' : 'PAY';
  const actor = await requireUser();
  const db = await getDb();

  let sheet: MilestoneSheet;
  try {
    sheet = await getMilestoneSheet(db, actor, projectId, kind);
  } catch (err) {
    // Unknown project or no access: respond the same way so ids are not probeable
    if (err instanceof DomainError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
  const contractors = kind === 'PAY' ? (await listVendors(db)).filter((v) => v.active) : [];

  return (
    <MilestoneSheetClient
      sheet={sheet}
      contractors={contractors.map((v) => ({ id: v.id, name: v.name }))}
    />
  );
}
