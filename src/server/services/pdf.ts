import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { items, poLines, prLines, prs, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { ensureFontsRegistered } from '@/pdf/layout';
import { PoPdfDoc, type PoLineRef } from '@/pdf/po';
import { PrPdfDoc } from '@/pdf/pr';
import { PvPdfDoc } from '@/pdf/pv';
import { poSigners, prSigners, pvSigners } from './doc-signers';
import { getPo } from './po';
import { getPr } from './pr';
import { getPv } from './pv';
import { getSettings } from './settings';

export type PdfDocKind = 'pr' | 'po' | 'pv' | 'wht';

// Hook for Task 16 WHT 50 ทวิ PDF renderer
let whtPdfRenderer: (
  db: Db,
  actor: SessionUser,
  id: string,
) => Promise<{ buffer: Buffer; filename: string }> | null = () => null;

export function registerWhtPdfRenderer(
  fn: (
    db: Db,
    actor: SessionUser,
    id: string,
  ) => Promise<{ buffer: Buffer; filename: string }>,
) {
  whtPdfRenderer = fn;
}

export async function renderDocPdfWithMeta(
  db: Db,
  actor: SessionUser,
  kind: PdfDocKind,
  id: string,
): Promise<{ buffer: Buffer; filename: string }> {
  ensureFontsRegistered();
  const settings = await getSettings(db);

  if (kind === 'pr') {
    const pr = await getPr(db, actor, id);
    const buffer = await renderToBuffer(
      PrPdfDoc({ pr, settings, signers: await prSigners(db, pr) }) as unknown as React.ReactElement<never>,
    );
    return { buffer: Buffer.from(buffer), filename: `${pr.number}.pdf` };
  }

  if (kind === 'po') {
    const po = await getPo(db, actor, id);
    const buffer = await renderToBuffer(
      PoPdfDoc({
        po,
        settings,
        signers: await poSigners(db, po),
        lineRefs: await poLineRefs(db, id),
      }) as unknown as React.ReactElement<never>,
    );
    return { buffer: Buffer.from(buffer), filename: `${po.number}.pdf` };
  }

  if (kind === 'pv') {
    const pv = await getPv(db, actor, id);
    const buffer = await renderToBuffer(
      PvPdfDoc({ pv, settings, signers: await pvSigners(db, pv) }) as unknown as React.ReactElement<never>,
    );
    return { buffer: Buffer.from(buffer), filename: `${pv.number}.pdf` };
  }

  if (kind === 'wht') {
    const res = await whtPdfRenderer(db, actor, id);
    if (!res) {
      throw new DomainError('NOT_FOUND', 'ไม่พบเอกสารหนังสือรับรองหัก ณ ที่จ่าย', 404);
    }
    return res;
  }

  throw new DomainError('INVALID_KIND', 'ประเภทเอกสาร PDF ไม่ถูกต้อง', 400);
}

/** The requisition each PO line came from and the item code it was bought as, by PO line */
export async function poLineRefs(db: Db, poId: string): Promise<Map<string, PoLineRef>> {
  const rows = await db
    .select({ id: poLines.id, prNumber: prs.number, itemCode: items.code })
    .from(poLines)
    .leftJoin(prLines, eq(prLines.id, poLines.prLineId))
    .leftJoin(prs, eq(prs.id, prLines.prId))
    .leftJoin(items, eq(items.id, poLines.itemId))
    .where(eq(poLines.poId, poId));
  return new Map(rows.map((r) => [r.id, { prNumber: r.prNumber ?? '', itemCode: r.itemCode ?? '' }]));
}

export async function renderDocPdf(
  db: Db,
  actor: SessionUser,
  kind: PdfDocKind,
  id: string,
): Promise<Buffer> {
  const { buffer } = await renderDocPdfWithMeta(db, actor, kind, id);
  return buffer;
}
