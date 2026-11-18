import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { items, poLines, prLines, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { ensureFontsRegistered } from '@/pdf/layout';
import { PoPdfDoc, type PoLineRef } from '@/pdf/po';
import { PrPdfDoc, type PrLineRef } from '@/pdf/pr';
import { PvPdfDoc } from '@/pdf/pv';
import { prFormKind } from '@/domain/form-templates';
import { poSigners, prPdfSigners, pvSigners } from './doc-signers';
import { getFormTemplates } from './form-templates';
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
  const [settings, forms] = await Promise.all([getSettings(db), getFormTemplates(db)]);
  const { header } = forms;

  if (kind === 'pr') {
    const pr = await getPr(db, actor, id);
    const [signers, lineRefs] = await Promise.all([prPdfSigners(db, pr), prLineRefs(db, id)]);
    const buffer = await renderToBuffer(
      PrPdfDoc({ pr, settings, signers, lineRefs, form: forms.texts[prFormKind(pr.prType)], header }) as unknown as React.ReactElement<never>,
    );
    return { buffer: Buffer.from(buffer), filename: `${pr.number}.pdf` };
  }

  if (kind === 'po') {
    const po = await getPo(db, actor, id);
    const buffer = await renderToBuffer(
      PoPdfDoc({
        po,
        settings,
        form: forms.texts.PO,
        header,
        signers: await poSigners(db, po),
        lineRefs: await poLineRefs(db, id),
      }) as unknown as React.ReactElement<never>,
    );
    return { buffer: Buffer.from(buffer), filename: `${po.number}.pdf` };
  }

  if (kind === 'pv') {
    const pv = await getPv(db, actor, id);
    const buffer = await renderToBuffer(
      PvPdfDoc({ pv, settings, form: forms.texts.PV, header, signers: await pvSigners(db, pv) }) as unknown as React.ReactElement<never>,
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
    .select({ id: poLines.id, itemCode: items.code })
    .from(poLines)
    .leftJoin(items, eq(items.id, poLines.itemId))
    .where(eq(poLines.poId, poId));
  return new Map(rows.map((r) => [r.id, { itemCode: r.itemCode ?? '' }]));
}

/** The item code each requisition line was picked as, by PR line */
export async function prLineRefs(db: Db, prId: string): Promise<Map<string, PrLineRef>> {
  const rows = await db
    .select({ id: prLines.id, itemCode: items.code })
    .from(prLines)
    .leftJoin(items, eq(items.id, prLines.itemId))
    .where(eq(prLines.prId, prId));
  return new Map(rows.map((r) => [r.id, { itemCode: r.itemCode ?? '' }]));
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
