import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z as z4 } from 'zod/v4';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCanViewTakeoff } from './boq-takeoff';
import { TILE_NAMES, type TakeoffKind, type TileName } from '@/domain/boq-takeoff';

/**
 * AI take-off: one page of a CAD drawing (rendered to an image in the browser, the PDF itself never
 * leaves the computer) goes to Claude, which reads it the way an estimator would and lists the BOQ
 * items it can quantify. Nothing is saved here; the user reviews the list and picks what to keep.
 */

export const AI_TAKEOFF_MODEL = 'claude-opus-5-5';

/** Images above ~5 MB are refused by the API; the browser sends a JPEG well under this */
const MAX_IMAGE_BASE64 = 6_800_000;

const aiItemSchema = z4.object({
  category: z4.string().describe('BOQ category heading in Thai, e.g. งานโครงสร้าง, งานสถาปัตยกรรม, งานระบบไฟฟ้า'),
  description: z4.string().describe('Work item in Thai as it would appear in a Thai BOQ, with size/spec when shown'),
  kind: z4.enum(['length', 'area', 'count', 'volume']).describe('length (ม.), area (ตร.ม.), count (pieces) or volume (ลบ.ม.: concrete, excavation, fill)'),
  unit: z4.string().describe('Thai BOQ unit, e.g. ม., ตร.ม., ลบ.ม., จุด, ชุด, ต้น, ตัว, กก.'),
  qty: z4.number().describe('Quantity in the unit, before waste'),
  basis: z4.string().describe('Short Thai note of how the quantity was worked out (dimensions read, counts, formula)'),
  confidence: z4.enum(['high', 'medium', 'low']),
  scope: z4
    .enum(['project_total', 'this_sheet', 'per_unit'])
    .describe('project_total: a total for the whole job written on the sheet; this_sheet: only what this sheet shows (one segment, one floor); per_unit: for ONE typical unit in a detail (one pit, one panel, one footing)'),
  perUnitOf: z4.string().describe('For per_unit: the unit it is for, in Thai, e.g. "บ่อพัก คสล.1 1 บ่อ". Empty otherwise'),
  location: z4
    .string()
    .optional()
    .describe('Where on the job this quantity is, as the sheet names it (zone, segment, station range, building, floor), e.g. "ลานจอดรถหน้าอาคาร", "STA 0+000–0+500", "โซน B". Empty for a total of the whole job'),
});

const aiPageSchema = z4.object({
  drawingTitle: z4.string().describe('Title / sheet name read from the title block, or empty'),
  scaleSeen: z4.string().describe('Scale written on the drawing, e.g. 1:100, or empty'),
  items: z4.array(aiItemSchema),
  warnings: z4.array(z4.string()).describe('Thai notes on anything unreadable or assumed'),
});

export type AiTakeoffPage = z4.infer<typeof aiPageSchema>;
export type AiTakeoffItem = z4.infer<typeof aiItemSchema>;

const SYSTEM = `You are a senior Thai quantity surveyor (ผู้ถอดแบบประมาณราคา) doing a BOQ take-off from one sheet of a construction drawing set.

Read the sheet image carefully: title block, scale, grid lines and their dimensions, dimension strings, schedules/tables (door & window schedules, rebar schedules, fixture legends), annotations and symbols. Then list every work item on this sheet that can be quantified, grouped under the usual Thai BOQ categories (งานเตรียมการ, งานโครงสร้าง, งานสถาปัตยกรรม, งานหลังคา, งานระบบไฟฟ้า, งานระบบสุขาภิบาล, งานระบบปรับอากาศ, งานภายนอก ...).

How to quantify:
- Prefer dimensions written on the drawing. Use grid dimensions to work out lengths and areas. Only scale off the drawing when nothing is written, using the scale and paper size you are given, and mark such items confidence "low".
- Counts (doors, windows, columns, footings, lights, sockets, sanitary ware) come from counting symbols or tags, or from schedules.
- Walls: length × height when the height is known (from sections or notes), otherwise give length in ม. and say so in basis.
- Floors/ceilings/roof: area in ตร.ม. Concrete, excavation, backfill, sand/gravel base: volume in ลบ.ม. (kind volume) when the sizes are given: area × thickness, or a typical section's area × the length it runs. Show the multiplication in basis.
- Count symbols one by one in the zoomed images, quadrant by quadrant, then check the total against any schedule or legend count. Symbols in the overlap band between two zoomed images are the same symbols: count them once.
- The same material at different places is a separate item for each place, never one item counted once: ท่อ HDPE at the car park and ท่อ HDPE along the canal are two items even with the same size and count. Put the place in location (and in the description when the sheet shows several places), so the sheets can be joined later without mixing places up.
- Say what each quantity covers in scope. A detail sheet of a typical pit, panel or footing gives quantities for one unit: mark them per_unit and name the unit in perUnitOf, never multiply by a count you cannot see on this sheet. A plan of one segment gives this_sheet counts. A note that states the total for the whole job is project_total.
- Totals written in notes win. When a note states a quantity ("พื้นที่ประมาณ 9,000.00 ตารางเมตร", "ยาวประมาณ 1,800.00 เมตร", "จำนวน 90 บ่อ"), copy that number exactly as the qty (9,000.00 is nine thousand) with confidence high, even when width × length would give something else; keep any exclusion it states ("ไม่รวมพื้นที่บ่อพัก") in the description. One note can hold several items (an area and a length of the same road): list each one it states. Do not also list your own recalculation of the same work.
- Work repeated at a spacing ("ทำทุกระยะ 100.00 เมตร", "@ 2.00 ม."): give it as per_unit for one piece, put the spacing in perUnitOf (e.g. "1 จุด ทุกระยะ 100 ม."), and say in basis which length it runs along if the sheet shows it. If a table on the sheet lists every piece (100 M, 200 M … 1800 M), count the entries instead and mark the count project_total.
- A page that lists the scope of the whole job (วัตถุประสงค์ / ขอบเขตงาน, numbered lines such as "2.1 งาน… พื้นที่รวมประมาณ 9,000.00 ตารางเมตร", "จำนวน 90 บ่อ") is a summary: list every line that states a quantity as its own project_total item, with the line number in basis (e.g. "ขอบเขตงานข้อ 3.2"). Copy the unit as written, but if the unit clearly does not fit the work (a length written in ตารางเมตร), use the fitting unit and say so in basis.
- A note that names several types together ("คันหิน คสล.รูปแบบที่ 1/รูปแบบที่ 2 ความยาวรวมประมาณ 3,600.00 เมตร") is ONE project_total item that names all of them; do not split it between the types.
- Each surface or finish with its own written total is its own item, named by its material (ไหล่ทางปูหญ้ามาเลเซีย 1,025 ตร.ม., ไหล่ทางคอนกรีตพิมพ์ลาย 615 ตร.ม.); keep the material in the description so different finishes are never mixed up.
- When a note gives the count of something repeated at a spacing ("ทุกระยะ 100 เมตร จำนวน 36 จุด"), the written count wins: one project_total count item.
- Leader numbers in circles that mark section cuts or detail references (①, ②, 1–22 along a route) are not things to count. Sheet references ("ดูแบบขยายหน้าที่ 51") are not items.
- Do not invent items the sheet does not show. Do not double count the same item. If the sheet is a cover, index or a detail with nothing to measure, return no items and explain in warnings.
- Write description, unit, basis and warnings in Thai. Keep basis short and show the numbers used, e.g. "แกน A-D 12.00 ม. × แกน 1-4 9.00 ม. หักบันได 2.4 ตร.ม."
- confidence: high when the quantity comes straight from written dimensions or a schedule; medium when you combined several readings; low when you scaled or assumed.`;

export interface AiTakeoffPageInput {
  page: number;
  /** JPEG, base64 without the data: prefix: the whole sheet */
  imageBase64: string;
  /**
   * Zoomed quarters of the same sheet, with a small overlap, for the small text and symbols a
   * whole-sheet image is too coarse to read. An object, not an array: server actions refuse arrays
   * of strings this long.
   */
  tiles?: Partial<Record<TileName, string>>;
  /** Paper size of the PDF page in millimetres */
  paperMm: { w: number; h: number };
  /** What the user set for this page in the take-off, e.g. "1:100" */
  scaleLabel?: string;
  /** Free text from the user, e.g. "แบบสถาปัตย์ ชั้น 1 ผนังสูง 3 ม." */
  hint?: string;
}

const imageSchema = z
  .string()
  .min(100, 'ไม่พบภาพของหน้าแบบ')
  .max(MAX_IMAGE_BASE64, 'ภาพหน้าแบบใหญ่เกินไป')
  .regex(/^[A-Za-z0-9+/=]+$/, 'ภาพหน้าแบบไม่ถูกต้อง');

const TILE_LABEL: Record<TileName, string> = { topLeft: 'top-left', topRight: 'top-right', bottomLeft: 'bottom-left', bottomRight: 'bottom-right' };

const inputSchema = z.object({
  page: z.number().int().min(1).max(99999),
  imageBase64: imageSchema,
  tiles: z.object({ topLeft: imageSchema, topRight: imageSchema, bottomLeft: imageSchema, bottomRight: imageSchema }).partial().strict().optional(),
  paperMm: z.object({ w: z.number().positive().max(10000), h: z.number().positive().max(10000) }),
  scaleLabel: z.string().max(100).optional(),
  hint: z.string().max(1000).optional(),
});

/** What the call to Claude looks like, so tests can stand in for it */
export type AiReader = (input: AiTakeoffPageInput) => Promise<AiTakeoffPage>;

export const isAiTakeoffConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ timeout: 10 * 60 * 1000, maxRetries: 2 }));

export const claudeReader: AiReader = async (input) => {
  if (!isAiTakeoffConfigured()) {
    throw new DomainError('AI_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า AI ถอดแบบ (ANTHROPIC_API_KEY) กรุณาแจ้งผู้ดูแลระบบ', 400);
  }
  const facts = [
    `Sheet: page ${input.page} of the PDF.`,
    `Paper size: ${Math.round(input.paperMm.w)} × ${Math.round(input.paperMm.h)} mm (the image shows the whole page).`,
    input.scaleLabel ? `Scale the user set for this page: ${input.scaleLabel}.` : 'The user has not set a scale for this page; read it from the drawing.',
    input.hint?.trim() ? `Note from the user: ${input.hint.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const tiles = TILE_NAMES.flatMap((n) => (input.tiles?.[n] ? [[n, input.tiles[n]] as const] : []));
  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: AI_TAKEOFF_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(aiPageSchema) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Image 1: the whole sheet.' },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.imageBase64 } },
            ...tiles.flatMap(([name, data], i) => [
              { type: 'text' as const, text: `Image ${i + 2}: zoomed ${TILE_LABEL[name]} quarter of the same sheet (twice the detail, overlapping its neighbours slightly).` },
              { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data } },
            ]),
            {
              type: 'text',
              text: `${facts}\n\n${tiles.length ? 'Use the whole sheet for the layout and the zoomed quarters to read small dimensions and notes and to count symbols. ' : ''}Do the take-off for this sheet.`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.error('AI take-off failed', err);
    if (err instanceof Anthropic.AuthenticationError) {
      throw new DomainError('AI_NOT_CONFIGURED', 'API key ของ AI ถอดแบบไม่ถูกต้อง กรุณาแจ้งผู้ดูแลระบบ', 400);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new DomainError('AI_BUSY', 'AI มีคิวเต็ม กรุณารอสักครู่แล้วลองใหม่', 400);
    }
    throw new DomainError('AI_FAILED', 'AI อ่านแบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 400);
  }

  if (response.stop_reason === 'refusal') {
    throw new DomainError('AI_REFUSED', 'AI ไม่สามารถอ่านหน้านี้ได้ กรุณาถอดแบบหน้านี้ด้วยการวัดเอง', 400);
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new DomainError('AI_FAILED', 'หน้านี้มีรายการมากเกินกว่าที่ AI อ่านได้ในครั้งเดียว กรุณาเพิ่มคำแนะนำให้แคบลง เช่น เฉพาะงานผนัง', 400);
  }
  return response.parsed_output;
};

/** Reads one page; the caller must be able to see the take-off it belongs to */
export async function readTakeoffPage(
  db: Db,
  actor: SessionUser,
  takeoffId: string,
  input: AiTakeoffPageInput,
  reader: AiReader = claudeReader,
): Promise<AiTakeoffPage> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_TAKEOFF', parsed.error.issues[0]!.message);
  await assertCanViewTakeoff(db, actor, takeoffId);
  const result = await reader(parsed.data);
  return {
    drawingTitle: result.drawingTitle.slice(0, 300),
    scaleSeen: result.scaleSeen.slice(0, 100),
    warnings: result.warnings.map((w) => w.slice(0, 500)).slice(0, 20),
    // Keep what the take-off can store; anything without a usable quantity is dropped
    items: result.items
      .filter((i) => i.description.trim() && Number.isFinite(i.qty) && i.qty > 0 && i.qty < 1e9)
      .slice(0, 300)
      .map((i) => ({
        category: i.category.trim().slice(0, 200),
        description: i.description.trim().slice(0, 1000),
        kind: i.kind,
        unit: i.unit.trim().slice(0, 50),
        qty: Math.round(i.qty * 1000) / 1000,
        basis: i.basis.trim().slice(0, 400),
        confidence: i.confidence,
        scope: i.scope ?? 'project_total',
        perUnitOf: (i.perUnitOf ?? '').trim().slice(0, 200),
        location: (i.location ?? '').trim().slice(0, 200),
      })),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Joining the sheets into one BOQ. Each sheet is read on its own, so the list still holds partial
 * counts of a total written elsewhere and quantities for one typical pit or panel. One more call,
 * with the rows as text only, does what an estimator does at the end: multiply per-unit details by
 * how many there are, keep the total instead of its parts, and keep everything else as it is.
 * ---------------------------------------------------------------------------------------------- */

const CONSOLIDATE_SYSTEM = `You are a senior Thai quantity surveyor finishing a BOQ take-off. Rows were read sheet by sheet from one drawing set; each row has an id, the sheets it was found on, and a scope:
- project_total: a total for the whole job written on a sheet
- this_sheet: only what one sheet shows (one segment of a road, one floor)
- per_unit: quantity for ONE typical unit in a detail (perUnitOf names the unit)
and a location: the place on the job the quantity is for (empty for the whole job).

Repeats and places: a row found on several sheets (sheets column) was already checked to be one note read again; count it once. Two rows of the same material are the same work only when they are at the same place. The same material at different places (different location, segment, zone or station range) is not a repeat: never fold one into the other or keep only one of them. Keep each place as its own item, with the place in the description (e.g. "ท่อ HDPE Ø 0.30 ม. (ลานจอดรถ)"), unless a project_total row states the total that covers all those places.

Produce the final BOQ list:
1. Same work found as a project_total and as this_sheet parts: keep the total once; drop the parts (list them in sources). If no total exists, keep the this_sheet parts of different places as separate items named by their place; join two this_sheet rows only when they show the same place (the same segment drawn twice).
2. per_unit rows: multiply by how many of that unit the job has, taken from other rows (e.g. 90 pits × 1.35 ตร.ม. per pit), and write the multiplication in basis. Match the unit by its type and size (บ่อพัก คสล. 1 is not บ่อพัก คสล. 2). Take the count from a project_total count row first; add up this_sheet counts only when no total exists. For work repeated at a spacing ("ทุกระยะ 100 ม."), the count is the length of the route it runs along (a project_total length row) ÷ the spacing, rounded up, unless a row already counts the pieces. If no count can be found, keep the per-unit quantity, set confidence "low" and say in basis "ต่อ 1 … ยังไม่ทราบจำนวน".
   Never multiply a project_total row, and never multiply the same per-unit row twice.
3. The same work read twice with slightly different names or units is one item. A written project_total keeps its number exactly; a row that recalculates the same work (width × length) is a source of that item, not a second item. Different work on the same route (pavement area, kerb length, footpath area, line marking) stays as separate items.
   A per-metre row (perUnitOf "… ยาว 1 ม.") is multiplied by the length of that same work. If the only length found covers several types together (คันหิน รูปแบบที่ 1/รูปแบบที่ 2 ความยาวรวม 3,600 ม.) and the rows differ between those types, do not guess a split: keep the length item, keep those per-metre rows per metre with confidence "low", and say in basis "ต่อ 1 ม. ความยาวรวม … ม. ไม่แยกตามรูปแบบ".
3a. A scope summary row (basis says ขอบเขตงาน / วัตถุประสงค์) and drawing notes for the same work are one item. If their numbers differ, use the number written on the drawing sheets (the one found on more sheets), and put the other number in notes. Fold a row into a summary total only when it is clearly the same work (same name or the summary names it); work with another name stays its own item even when it looks related (ไหล่ทางปูหญ้า is not ทางเท้าทางเดินริมน้ำ).
4. Keep every other row as it is. Do not invent work or quantities that are not in the rows. Keep descriptions specific (size, spec) and in Thai; use a consistent Thai BOQ category for each item.
5. sources: every input id this item stands for, including the ones it replaced. Every input id should appear in exactly one item's sources or in dropped.
6. dropped: ids of rows that are not BOQ work at all (e.g. a whole building counted as "1 หลัง" when its parts are listed), with a short Thai reason.`;

const consolidatedSchema = z4.object({
  items: z4.array(
    z4.object({
      category: z4.string(),
      description: z4.string(),
      kind: z4.enum(['length', 'area', 'count', 'volume']),
      unit: z4.string(),
      qty: z4.number(),
      basis: z4.string().describe('Short Thai note; show any multiplication'),
      confidence: z4.enum(['high', 'medium', 'low']),
      sources: z4.array(z4.string()).describe('Input row ids this item stands for'),
    }),
  ),
  dropped: z4.array(z4.object({ id: z4.string(), reason: z4.string() })),
  notes: z4.array(z4.string()).describe('Thai notes for the estimator, e.g. counts that could not be found'),
});
export type AiConsolidated = z4.infer<typeof consolidatedSchema>;

const consolidateRowSchema = z.object({
  id: z.string().min(1).max(100),
  pages: z.array(z.number().int().min(1).max(99999)).min(1).max(500),
  category: z.string().max(200),
  description: z.string().min(1).max(1000),
  kind: z.enum(['length', 'area', 'count', 'volume']),
  unit: z.string().max(50),
  qty: z.number().positive().max(1e9),
  scope: z.enum(['project_total', 'this_sheet', 'per_unit']),
  perUnitOf: z.string().max(200),
  location: z.string().max(200).optional(),
  basis: z.string().max(500),
});
export type AiConsolidateRow = z.infer<typeof consolidateRowSchema>;
const consolidateInputSchema = z.object({ rows: z.array(consolidateRowSchema).min(2, 'ต้องมีอย่างน้อย 2 รายการจึงจะรวมได้').max(2000, 'รายการมากเกินไป กรุณาอ่านทีละช่วงหน้า'), hint: z.string().max(1000).optional() });

export type AiConsolidator = (rows: AiConsolidateRow[], hint?: string) => Promise<AiConsolidated>;

export const claudeConsolidator: AiConsolidator = async (rows, hint) => {
  if (!isAiTakeoffConfigured()) {
    throw new DomainError('AI_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า AI ถอดแบบ (ANTHROPIC_API_KEY) กรุณาแจ้งผู้ดูแลระบบ', 400);
  }
  const table = rows
    .map((r) => [r.id, r.pages.join(','), r.scope, r.perUnitOf, r.location ?? '', r.category, r.description, r.qty, r.unit, r.kind, r.basis].map((v) => String(v).replace(/[\t\n]+/g, ' ')).join('\t'))
    .join('\n');
  let response;
  try {
    // A long list comes back long; streaming keeps the request inside HTTP time limits
    response = await getClient()
      .beta.messages.stream({
        model: AI_TAKEOFF_MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high', format: betaZodOutputFormat(consolidatedSchema) },
        system: CONSOLIDATE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `${hint?.trim() ? `Note from the user: ${hint.trim()}\n\n` : ''}Rows (tab separated: id, sheets, scope, perUnitOf, location, category, description, qty, unit, kind, basis):\n${table}\n\nProduce the final BOQ list.`,
          },
        ],
      })
      .finalMessage();
  } catch (err) {
    console.error('AI take-off consolidation failed', err);
    if (err instanceof Anthropic.AuthenticationError) {
      throw new DomainError('AI_NOT_CONFIGURED', 'API key ของ AI ถอดแบบไม่ถูกต้อง กรุณาแจ้งผู้ดูแลระบบ', 400);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new DomainError('AI_BUSY', 'AI มีคิวเต็ม กรุณารอสักครู่แล้วลองใหม่', 400);
    }
    throw new DomainError('AI_FAILED', 'AI รวมรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 400);
  }
  if (response.stop_reason === 'refusal') {
    throw new DomainError('AI_REFUSED', 'AI ไม่สามารถรวมรายการชุดนี้ได้ กรุณาตรวจรายการเอง', 400);
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new DomainError('AI_FAILED', 'รายการมากเกินกว่าที่ AI รวมได้ในครั้งเดียว กรุณาอ่านทีละช่วงหน้าแล้วรวม', 400);
  }
  return response.parsed_output;
};

export interface ConsolidatedItem {
  category: string;
  description: string;
  kind: TakeoffKind;
  unit: string;
  qty: number;
  basis: string;
  confidence: 'high' | 'medium' | 'low';
  /** Input rows this item stands for */
  sources: string[];
}

/** Joins the rows read sheet by sheet into the final list; nothing is saved */
export async function consolidateTakeoff(
  db: Db,
  actor: SessionUser,
  takeoffId: string,
  input: { rows: AiConsolidateRow[]; hint?: string },
  consolidator: AiConsolidator = claudeConsolidator,
): Promise<{ items: ConsolidatedItem[]; dropped: { id: string; reason: string }[]; notes: string[]; unaccounted: string[] }> {
  const parsed = consolidateInputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_TAKEOFF', parsed.error.issues[0]!.message);
  await assertCanViewTakeoff(db, actor, takeoffId);
  const ids = new Set(parsed.data.rows.map((r) => r.id));
  const out = await consolidator(parsed.data.rows, parsed.data.hint);
  const items = out.items
    .filter((i) => i.description.trim() && Number.isFinite(i.qty) && i.qty > 0 && i.qty < 1e9)
    .slice(0, 1000)
    .map((i) => ({
      category: i.category.trim().slice(0, 200),
      description: i.description.trim().slice(0, 1000),
      kind: i.kind,
      unit: i.unit.trim().slice(0, 50),
      qty: Math.round(i.qty * 1000) / 1000,
      basis: i.basis.trim().slice(0, 400),
      confidence: i.confidence,
      sources: [...new Set(i.sources.filter((s) => ids.has(s)))],
    }));
  const dropped = out.dropped.filter((d) => ids.has(d.id)).map((d) => ({ id: d.id, reason: d.reason.trim().slice(0, 300) }));
  // Rows the AI left out without a word are shown, so nothing disappears silently
  const seen = new Set([...items.flatMap((i) => i.sources), ...dropped.map((d) => d.id)]);
  return {
    items,
    dropped,
    notes: out.notes.map((n) => n.slice(0, 500)).slice(0, 30),
    unaccounted: [...ids].filter((id) => !seen.has(id)),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Pricing what the company has never priced. Rates from earlier BOQs and POs come first
 * (services/takeoff-pricing); the items still missing a material or labour rate go here, as text
 * only, for an estimate of today's Thai market rate. Every rate is marked as an AI estimate.
 * ---------------------------------------------------------------------------------------------- */

const PRICE_SYSTEM = `You are a senior Thai quantity surveyor (ผู้ประมาณราคา) pricing a BOQ in Thailand for the current year.
For each item give the unit rate in Thai baht, before VAT, split the way a Thai BOQ is: ค่าวัสดุต่อหน่วย (material, including delivery to site and normal small consumables) and ค่าแรงต่อหน่วย (labour, including the contractor's normal tools).
- Use typical contractor prices for the Bangkok and central region; for government-style work think of ราคากลางงานก่อสร้าง (กรมบัญชีกลาง) and the current minimum wage based labour rates, not luxury or discount prices.
- The rate is per the item's own unit (ม., ตร.ม., ลบ.ม., ต้น, จุด, ชุด, กก. …). If the unit makes no sense for the work, still price per that unit and say so in basis.
- Price only what is asked: when needMaterial is false return 0 for materialRate, when needLabor is false return 0 for laborRate. Work that is labour only (รื้อถอน, ค่าแรง…) has materialRate 0.
- Use the specification in the name (size, thickness, strength, brand class). Do not invent extras that the name does not say.
- basis: a short Thai note of what the rate assumes (e.g. "คอนกรีต 240 ksc รวมค่าส่ง, ค่าแรงเทและแต่ง"). confidence: high for common standard work, medium for typical but variable, low when the description is vague.
Return every key you were given exactly once.`;

const priceSchema = z4.object({
  items: z4.array(
    z4.object({
      key: z4.string(),
      materialRate: z4.number().describe('Baht per unit before VAT, 0 when not asked or labour only'),
      laborRate: z4.number().describe('Baht per unit before VAT, 0 when not asked'),
      basis: z4.string(),
      confidence: z4.enum(['high', 'medium', 'low']),
    }),
  ),
});
export type AiPriceEstimate = z4.infer<typeof priceSchema>['items'][number];

export interface AiPriceRequest {
  key: string;
  category: string;
  description: string;
  unit: string;
  needMaterial: boolean;
  needLabor: boolean;
}

export type AiPriceEstimator = (items: AiPriceRequest[], hint?: string) => Promise<AiPriceEstimate[]>;

export const claudePriceEstimator: AiPriceEstimator = async (items, hint) => {
  if (!isAiTakeoffConfigured()) {
    throw new DomainError('AI_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า AI (ANTHROPIC_API_KEY) จึงประมาณราคาที่ไม่เคยมีไม่ได้ กรุณาแจ้งผู้ดูแลระบบ', 400);
  }
  const table = items
    .map((i) => [i.key, i.category, i.description, i.unit, i.needMaterial ? 'yes' : 'no', i.needLabor ? 'yes' : 'no'].map((v) => String(v).replace(/[\t\n]+/g, ' ')).join('\t'))
    .join('\n');
  let response;
  try {
    response = await getClient()
      .beta.messages.stream({
        model: AI_TAKEOFF_MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high', format: betaZodOutputFormat(priceSchema) },
        system: PRICE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `${hint?.trim() ? `Note from the user: ${hint.trim()}\n\n` : ''}Items (tab separated: key, category, description, unit, needMaterial, needLabor):\n${table}\n\nPrice every item.`,
          },
        ],
      })
      .finalMessage();
  } catch (err) {
    console.error('AI pricing failed', err);
    if (err instanceof Anthropic.AuthenticationError) {
      throw new DomainError('AI_NOT_CONFIGURED', 'API key ของ AI ไม่ถูกต้อง กรุณาแจ้งผู้ดูแลระบบ', 400);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new DomainError('AI_BUSY', 'AI มีคิวเต็ม กรุณารอสักครู่แล้วลองใหม่', 400);
    }
    throw new DomainError('AI_FAILED', 'AI ประมาณราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 400);
  }
  if (response.stop_reason === 'refusal') {
    throw new DomainError('AI_REFUSED', 'AI ไม่สามารถประมาณราคารายการชุดนี้ได้ กรุณากรอกราคาเอง', 400);
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new DomainError('AI_FAILED', 'รายการมากเกินกว่าที่ AI ประมาณราคาได้ในครั้งเดียว กรุณาเลือกน้อยลง', 400);
  }
  return response.parsed_output.items;
};
