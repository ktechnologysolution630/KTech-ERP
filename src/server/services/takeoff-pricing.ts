import { and, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { boqLines, boqs, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { findSameWork, needsRates, suggestFromHistory, type PriceFrom, type PriceRef } from '@/domain/takeoff-pricing';
import { bangkokDateString } from '@/domain/thai';
import { can, isSiteScopedOnly } from '@/server/policy';
import { claudePriceEstimator, type AiPriceEstimator, type AiPriceRequest } from './boq-ai-takeoff';
import { assertCanViewTakeoff } from './boq-takeoff';
import { listLastPurchasePrices } from './price-history';

/**
 * Material and labour rates for the items of a take-off: the company's own earlier BOQs and
 * purchases first, then an AI estimate for what was never priced (domain/takeoff-pricing).
 * Nothing is saved; the user sees where each rate came from and picks what to keep.
 */

/** BOQ lines with a rate, newest BOQ first, from projects the user may see */
async function boqPriceRefs(db: Db, actor: SessionUser): Promise<PriceRef[]> {
  const rows = await db
    .select({
      description: boqLines.description,
      unit: boqLines.unit,
      materialRate: boqLines.materialRate,
      laborRate: boqLines.laborRate,
      number: boqs.number,
      projectId: boqs.projectId,
      updatedAt: boqs.updatedAt,
    })
    .from(boqLines)
    .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
    .where(and(eq(boqLines.isCategory, false), or(sql`${boqLines.materialRate} > 0`, sql`${boqLines.laborRate} > 0`)))
    .orderBy(desc(boqs.updatedAt), boqLines.sort)
    .limit(20000);
  const seen = new Set<string>();
  const out: PriceRef[] = [];
  for (const r of rows) {
    if (!r.description.trim() || !can(actor, 'project.view', { projectId: r.projectId })) continue;
    // The newest price of the same work in the same unit is the one kept
    const key = `${r.description.trim().replace(/\s+/g, ' ')}|${r.unit.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: 'boq',
      description: r.description.trim(),
      unit: r.unit,
      materialRate: r.materialRate === null ? null : Number(r.materialRate),
      laborRate: r.laborRate === null ? null : Number(r.laborRate),
      ref: r.number,
      date: bangkokDateString(r.updatedAt),
    });
  }
  return out;
}

/** What was paid last on approved POs; only for those who may see purchase prices */
async function poPriceRefs(db: Db, actor: SessionUser): Promise<PriceRef[]> {
  if (!can(actor, 'po.manage') && isSiteScopedOnly(actor)) return [];
  const prices = await listLastPurchasePrices(db);
  return prices.map((p) => ({
    source: 'po',
    description: p.description,
    unit: p.unitName,
    materialRate: p.unitPrice,
    laborRate: null,
    ref: p.poNumber,
    date: p.purchasedOn,
  }));
}

const inputSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        category: z.string().max(200),
        description: z.string().trim().min(1).max(1000),
        unit: z.string().max(50),
      }),
    )
    .min(1, 'ยังไม่มีรายการให้คิดราคา')
    .max(500, 'รายการมากเกินไป คิดราคาได้ครั้งละไม่เกิน 500 รายการ'),
  useAi: z.boolean(),
  hint: z.string().max(1000).optional(),
});
export type PriceTakeoffInput = z.input<typeof inputSchema>;

export interface PricedItem {
  key: string;
  materialRate: number | null;
  laborRate: number | null;
  materialFrom: PriceFrom | null;
  laborFrom: PriceFrom | null;
  /** The AI's confidence when a rate is its estimate */
  aiConfidence?: 'high' | 'medium' | 'low';
  /** Another item in the list that is the same work in another unit: pricing both pays twice */
  sameWorkAs?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const MAX_RATE = 1_000_000_000;

export async function priceTakeoffItems(
  db: Db,
  actor: SessionUser,
  takeoffId: string,
  input: PriceTakeoffInput,
  estimator: AiPriceEstimator = claudePriceEstimator,
): Promise<{ items: PricedItem[]; refCount: number; aiError?: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_TAKEOFF', parsed.error.issues[0]!.message);
  await assertCanViewTakeoff(db, actor, takeoffId);
  const { items, useAi, hint } = parsed.data;

  const refs = [...(await boqPriceRefs(db, actor)), ...(await poPriceRefs(db, actor))];
  const priced: PricedItem[] = items.map((it) => ({ key: it.key, ...suggestFromHistory(it, refs) }));

  const priceOf = new Map(priced.map((p) => [p.key, p]));
  const twins = findSameWork(items, (k) => Boolean(priceOf.get(k)?.materialFrom || priceOf.get(k)?.laborFrom));
  for (const [k, of] of twins) priceOf.get(k)!.sameWorkAs = of;

  let aiError: string | undefined;
  const ask: AiPriceRequest[] = [];
  items.forEach((it, i) => {
    // Its twin carries the price; this one is not priced again
    if (twins.has(it.key)) return;
    const need = needsRates(it.description);
    const needMaterial = need.material && priced[i]!.materialRate === null;
    const needLabor = need.labor && priced[i]!.laborRate === null;
    if (needMaterial || needLabor) ask.push({ key: it.key, category: it.category, description: it.description, unit: it.unit, needMaterial, needLabor });
  });
  if (useAi && ask.length > 0) {
    try {
      const byKey = new Map(priced.map((p) => [p.key, p]));
      for (const est of await estimator(ask, hint)) {
        const req = ask.find((a) => a.key === est.key);
        const p = byKey.get(est.key);
        if (!req || !p) continue;
        const from: PriceFrom = { source: 'ai', label: `AI ประมาณราคาตลาด: ${est.basis}`.slice(0, 300), score: 1 };
        if (req.needMaterial && Number.isFinite(est.materialRate) && est.materialRate > 0 && est.materialRate < MAX_RATE) {
          p.materialRate = round2(est.materialRate);
          p.materialFrom = from;
          p.aiConfidence = est.confidence;
        }
        if (req.needLabor && Number.isFinite(est.laborRate) && est.laborRate > 0 && est.laborRate < MAX_RATE) {
          p.laborRate = round2(est.laborRate);
          p.laborFrom = from;
          p.aiConfidence = est.confidence;
        }
      }
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      // Prices from the company's own history are still worth showing
      aiError = err.message;
    }
  }
  return { items: priced, refCount: refs.length, aiError };
}
