import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { getTakeoff, type TakeoffDocumentDto } from '@/server/services/boq-takeoff';
import { listProjects } from '@/server/services/master';
import { BoqTakeoffWorkspace } from '@/components/boq-takeoff-workspace';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BoqTakeoffDetailPage({ params }: PageProps) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();
  let takeoff: TakeoffDocumentDto;
  try {
    takeoff = await getTakeoff(db, actor, id);
  } catch (err) {
    if (err instanceof DomainError && err.status === 404) notFound();
    throw err;
  }
  const projects = await listProjects(db, actor);
  return (
    <BoqTakeoffWorkspace
      initial={takeoff}
      projects={projects.map((p) => ({ id: p.id, label: `${p.code} ${p.name}`, canEditBoq: can(actor, 'boq.manage', { projectId: p.id }) }))}
    />
  );
}
