import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { toBangkok } from '@/domain/thai';
import { requireUser } from '@/server/auth/current-user';
import { exportMonthly, type ExportKind } from '@/server/services/exports';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  try {
    const { kind } = await params;
    const url = new URL(req.url);
    const nowBkk = toBangkok(new Date());
    const year = Number(url.searchParams.get('year') ?? nowBkk.getUTCFullYear());
    const month = Number(url.searchParams.get('month') ?? nowBkk.getUTCMonth() + 1);

    const actor = await requireUser();
    const db = await getDb();

    const buffer = await exportMonthly(db, actor, kind as ExportKind, {
      year,
      month,
    });

    const mm = String(month).padStart(2, '0');
    const filename = `${kind}-${year}-${mm}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
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
