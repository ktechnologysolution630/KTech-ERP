import { describe, expect, test } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { seedBasics } from '../helpers/fixtures';
import { PROJECT_COVER_PRESETS } from '@/domain/project';
import { getProjectDetail, setProjectCover } from '@/server/services/master';

const png = (bytes: number, type = 'image/png') => new File([new Uint8Array(bytes)], 'site.png', { type });

describe('project cover photo', () => {
  test('preset, upload and remove; only whitelisted presets and valid images', async () => {
    const db = await createTestDb();
    const f = await seedBasics(db);

    await setProjectCover(db, f.users.owner, f.projectA, { kind: 'preset', url: PROJECT_COVER_PRESETS[1] });
    expect((await getProjectDetail(db, f.users.owner, f.projectA)).coverImageUrl).toBe(PROJECT_COVER_PRESETS[1]);

    const uploaded = await setProjectCover(db, f.users.owner, f.projectA, { kind: 'upload', file: png(1024) });
    expect(uploaded).not.toBe(PROJECT_COVER_PRESETS[1]);
    expect((await getProjectDetail(db, f.users.owner, f.projectA)).coverImageUrl).toBe(uploaded);

    await setProjectCover(db, f.users.owner, f.projectA, { kind: 'remove' });
    expect((await getProjectDetail(db, f.users.owner, f.projectA)).coverImageUrl).toBe('');

    await expect(
      setProjectCover(db, f.users.owner, f.projectA, { kind: 'preset', url: 'https://evil.example/x.png' }),
    ).rejects.toMatchObject({ code: 'INVALID_PROJECT' });
    await expect(
      setProjectCover(db, f.users.owner, f.projectA, { kind: 'upload', file: png(10, 'application/pdf') }),
    ).rejects.toMatchObject({ code: 'INVALID_PROJECT' });
    await expect(
      setProjectCover(db, f.users.owner, f.projectA, { kind: 'upload', file: png(4 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ code: 'INVALID_PROJECT' });
    // Site staff can view the project but not change it
    await expect(
      setProjectCover(db, f.users.foreman, f.projectA, { kind: 'preset', url: PROJECT_COVER_PRESETS[0] }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
