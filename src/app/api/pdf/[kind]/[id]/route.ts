import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { requireUser } from '@/server/auth/current-user';
import { renderDocPdfWithMeta, type PdfDocKind } from '@/server/services/pdf';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const { kind, id } = await params;
    const actor = await requireUser();
    const db = await getDb();

    const { buffer, filename } = await renderDocPdfWithMeta(
      db,
      actor,
      kind as PdfDocKind,
      id,
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    throw err;
  }
}
