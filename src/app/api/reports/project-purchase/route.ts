import React from 'react';
import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDb } from '@/db/client';
import { DomainError } from '@/domain/errors';
import { ensureFontsRegistered } from '@/pdf/layout';
import { ProjectPurchaseReportPdf } from '@/pdf/project-purchase-report';
import { requireUser } from '@/server/auth/current-user';
import { getProjectPurchaseReport } from '@/server/services/project-purchase-report';
import { getSettings } from '@/server/services/settings';

/** PDF of the project purchasing summary, for the same filters as the page. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const actor = await requireUser();
    const db = await getDb();
    const report = await getProjectPurchaseReport(db, actor, {
      projectId: url.searchParams.get('projectId') ?? '',
      from: url.searchParams.get('from') || null,
      to: url.searchParams.get('to') || null,
      q: url.searchParams.get('q') ?? '',
    });
    ensureFontsRegistered();
    const settings = await getSettings(db);
    const buffer = await renderToBuffer(
      ProjectPurchaseReportPdf({ report, settings }) as unknown as React.ReactElement<never>,
    );
    const filename = `รายงานจัดซื้อ-${report.project.code}.pdf`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
