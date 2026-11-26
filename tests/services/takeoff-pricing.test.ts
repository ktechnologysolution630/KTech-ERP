import { describe, expect, test, vi } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { createTakeoff } from '@/server/services/boq-takeoff';
import { saveProjectMainBoq } from '@/server/services/boq';
import { priceTakeoffItems } from '@/server/services/takeoff-pricing';
import type { AiPriceEstimator } from '@/server/services/boq-ai-takeoff';

const boqInput = {
  baseUpdatedAt: null,
  revision: 0,
  estimateDate: null,
  projectTitle: '',
  location: '',
  owner: '',
  workDetail: '',
  estimator: '',
  overheadPercent: 0,
  discountAmount: 0,
  vatPercent: 7,
  remarks: '',
  lines: [
    { isCategory: true, isBold: true, no: '1', description: 'งานโครงสร้าง', qty: '' as const, unit: '', materialRate: '' as const, laborRate: '' as const, note: '' },
    { isCategory: false, isBold: false, no: '1.1', description: 'พื้น ค.ส.ล. หนา 10 ซม.', qty: 50, unit: 'ตร.ม.', materialRate: 420, laborRate: 150, note: '' },
    { isCategory: false, isBold: false, no: '1.2', description: 'เสาเข็มตอก I-18', qty: 10, unit: 'ต้น', materialRate: 3_500, laborRate: 800, note: '' },
  ],
};

const fakeAi: AiPriceEstimator = async (items) => items.map((i) => ({ key: i.key, materialRate: i.needMaterial ? 111 : 0, laborRate: i.needLabor ? 22 : 0, basis: 'ราคาตลาด', confidence: 'medium' as const }));

describe('pricing a take-off', () => {
  test('uses earlier BOQ rates first and asks the AI only for what is missing', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await saveProjectMainBoq(db, f.users.pm, f.projectA, boqInput);
    const { id } = await createTakeoff(db, f.users.pm, { name: 'อาคาร B', projectId: f.projectA });
    const ai = vi.fn(fakeAi);
    const res = await priceTakeoffItems(
      db,
      f.users.pm,
      id,
      {
        useAi: true,
        items: [
          { key: 'a', category: '', description: 'พื้นคอนกรีตเสริมเหล็ก หนา 0.10 ม.', unit: 'ตารางเมตร' },
          { key: 'b', category: '', description: 'พื้น คสล. หนา 15 ซม.', unit: 'ตร.ม.' },
          { key: 'c', category: '', description: 'รื้อถอนผนังเดิม', unit: 'ตร.ม.' },
        ],
      },
      ai,
    );
    const [a, b, c] = res.items;
    expect([a!.materialRate, a!.laborRate, a!.materialFrom?.source]).toEqual([420, 150, 'boq']);
    // A 15 cm slab is not the 10 cm one: the AI prices it
    expect([b!.materialRate, b!.laborRate, b!.materialFrom?.source]).toEqual([111, 22, 'ai']);
    // Demolition is labour only
    expect([c!.materialRate, c!.laborRate]).toEqual([null, 22]);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(ai.mock.calls[0]![0].map((x) => x.key)).toEqual(['b', 'c']);
  });

  test('keeps history prices when the AI fails, and does not show prices of projects the user cannot see', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);
    await saveProjectMainBoq(db, f.users.pm, f.projectA, boqInput);
    const { id } = await createTakeoff(db, f.users.otherForeman, { name: 'ของฉัน', projectId: null });
    const failing: AiPriceEstimator = async () => {
      const { DomainError } = await import('@/domain/errors');
      throw new DomainError('AI_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า AI', 400);
    };
    const res = await priceTakeoffItems(db, f.users.otherForeman, id, { useAi: true, items: [{ key: 'p', category: '', description: 'เสาเข็มตอก I-18', unit: 'ต้น' }] }, failing);
    expect(res.aiError).toContain('ยังไม่ได้ตั้งค่า AI');
    expect(res.items[0]!.materialRate).toBeNull();
  });
});
