import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { getProjectBoqSheet, type ProjectBoqSheet } from '@/server/services/boq';
import { BoqSheetEditor } from '@/components/boq-sheet-editor';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectBoqPage({ params }: PageProps) {
  const { id } = await params;
  const actor = await requireUser();
  const db = await getDb();

  let sheet: ProjectBoqSheet;
  try {
    sheet = await getProjectBoqSheet(db, actor, id);
  } catch (err) {
    // Unknown project or no access: respond the same way so ids are not probeable
    if (err instanceof DomainError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }

  return (
    <BoqSheetEditor
      projectId={sheet.project.id}
      projectCode={sheet.project.code}
      projectName={sheet.project.name}
      initialBoq={sheet.boq}
      canEdit={sheet.canEdit}
    />
  );
}
