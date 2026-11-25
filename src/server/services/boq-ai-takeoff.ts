import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z as z4 } from 'zod/v4';
import { z } from 'zod';
import { type Db } from '@/db/client';
import { type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { assertCanViewTakeoff } from './boq-takeoff';

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
  kind: z4.enum(['length', 'area', 'count']).describe('How the item would be measured on the drawing'),
  unit: z4.string().describe('Thai BOQ unit, e.g. ม., ตร.ม., ลบ.ม., จุด, ชุด, ต้น, ตัว, กก.'),
  qty: z4.number().describe('Quantity in the unit, before waste'),
  basis: z4.string().describe('Short Thai note of how the quantity was worked out (dimensions read, counts, formula)'),
  confidence: z4.enum(['high', 'medium', 'low']),
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
- Floors/ceilings/roof: area in ตร.ม. Concrete: volume in ลบ.ม. when sizes are given.
- Do not invent items the sheet does not show. Do not double count the same item. If the sheet is a cover, index or a detail with nothing to measure, return no items and explain in warnings.
- Write description, unit, basis and warnings in Thai. Keep basis short and show the numbers used, e.g. "แกน A-D 12.00 ม. × แกน 1-4 9.00 ม. หักบันได 2.4 ตร.ม."
- confidence: high when the quantity comes straight from written dimensions or a schedule; medium when you combined several readings; low when you scaled or assumed.`;

export interface AiTakeoffPageInput {
  page: number;
  /** JPEG, base64 without the data: prefix */
  imageBase64: string;
  /** Paper size of the PDF page in millimetres */
  paperMm: { w: number; h: number };
  /** What the user set for this page in the take-off, e.g. "1:100" */
  scaleLabel?: string;
  /** Free text from the user, e.g. "แบบสถาปัตย์ ชั้น 1 ผนังสูง 3 ม." */
  hint?: string;
}

const inputSchema = z.object({
  page: z.number().int().min(1).max(99999),
  imageBase64: z
    .string()
    .min(100, 'ไม่พบภาพของหน้าแบบ')
    .max(MAX_IMAGE_BASE64, 'ภาพหน้าแบบใหญ่เกินไป')
    .regex(/^[A-Za-z0-9+/=]+$/, 'ภาพหน้าแบบไม่ถูกต้อง'),
  paperMm: z.object({ w: z.number().positive().max(10000), h: z.number().positive().max(10000) }),
  scaleLabel: z.string().max(100).optional(),
  hint: z.string().max(1000).optional(),
});

/** What the call to Claude looks like, so tests can stand in for it */
export type AiReader = (input: AiTakeoffPageInput) => Promise<AiTakeoffPage>;

export const isAiTakeoffConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;

export const claudeReader: AiReader = async (input) => {
  if (!isAiTakeoffConfigured()) {
    throw new DomainError('AI_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า AI ถอดแบบ (ANTHROPIC_API_KEY) กรุณาแจ้งผู้ดูแลระบบ', 400);
  }
  client ??= new Anthropic({ timeout: 5 * 60 * 1000, maxRetries: 2 });
  const facts = [
    `Sheet: page ${input.page} of the PDF.`,
    `Paper size: ${Math.round(input.paperMm.w)} × ${Math.round(input.paperMm.h)} mm (the image shows the whole page).`,
    input.scaleLabel ? `Scale the user set for this page: ${input.scaleLabel}.` : 'The user has not set a scale for this page; read it from the drawing.',
    input.hint?.trim() ? `Note from the user: ${input.hint.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  let response;
  try {
    response = await client.beta.messages.parse({
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
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.imageBase64 } },
            { type: 'text', text: `${facts}\n\nDo the take-off for this sheet.` },
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
      })),
  };
}
