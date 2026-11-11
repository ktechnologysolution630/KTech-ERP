import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { isAppleMobileDevice, isAppleMobileUserAgent, isEditingPath, isViewOnlyRequest } from '@/domain/view-only-device';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1';
const IPAD_MOBILE = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
// What an iPad sends by default, and what a real Mac sends: the same thing
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';

describe('which devices may only look', () => {
  test('an iPhone or iPad is known by what its browser says, whichever browser it is', () => {
    for (const ua of [IPHONE, IPHONE_CHROME, IPAD_MOBILE]) expect(isAppleMobileUserAgent(ua)).toBe(true);
    for (const ua of [MAC_SAFARI, WINDOWS, ANDROID, '', null, undefined]) expect(isAppleMobileUserAgent(ua)).toBe(false);
  });

  test('an iPad calling itself a Mac is given away by its touch screen', () => {
    expect(isAppleMobileDevice({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobileDevice({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    // A real Mac has no touch screen; a Windows touch laptop and an Android phone are not Apple's
    expect(isAppleMobileDevice({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobileDevice({ userAgent: MAC_SAFARI, platform: 'MacIntel' })).toBe(false);
    expect(isAppleMobileDevice({ userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 10 })).toBe(false);
    expect(isAppleMobileDevice({ userAgent: ANDROID, platform: 'Linux armv81', maxTouchPoints: 5 })).toBe(false);
  });

  test('the server goes by the browser name, or by the mark the browser left', () => {
    expect(isViewOnlyRequest(IPHONE, undefined)).toBe(true);
    expect(isViewOnlyRequest(MAC_SAFARI, '1')).toBe(true);
    expect(isViewOnlyRequest(MAC_SAFARI, undefined)).toBe(false);
    expect(isViewOnlyRequest(WINDOWS, '')).toBe(false);
    expect(isViewOnlyRequest(WINDOWS, '0')).toBe(false);
    expect(isViewOnlyRequest(null, null)).toBe(false);
  });

  test('pages made only for writing are not opened', () => {
    for (const p of ['/pr/new', '/po/new', '/po/8f1c/edit', '/sales/quotations/new', '/ar/invoices/new', '/receive/8f1c']) expect(isEditingPath(p)).toBe(true);
    for (const p of ['/pr', '/pr/8f1c', '/po/8f1c', '/receive', '/inbox', '/news', '/projects/8f1c/boq', '/']) expect(isEditingPath(p)).toBe(false);
  });
});

describe('every action that writes refuses a view-only device', () => {
  /** The only actions an iPhone or iPad may run: they read, tick the person's own notifications as seen, or only move to another page */
  const READ_ONLY = [
    'finishReceiptRedirectAction',
    'listMyNotificationsAction', 'markAllMyNotificationsReadAction', 'markMyNotificationReadAction',
    'loadCalendarAction', 'loadCashflowAction', 'loadChatAction', 'loadCostPerformanceAction', 'loadDailyReportAction', 'loadDailyReportsAction',
    'loadDefectsAction', 'loadFilesAction', 'loadForecastAction', 'loadInspectionsAction', 'loadPeriodicReportAction', 'loadTeamAction',
    'loadVoBoqAction', 'loadVoDocumentAction',
  ];
  const appDir = join(process.cwd(), 'src/app/(app)');
  const sources = (readdirSync(appDir, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: f.replace(/\\/g, '/'), text: readFileSync(join(appDir, f), 'utf8') }));

  /** Each exported action with the code that belongs to it, up to the next top-level declaration */
  const actions = sources
    .filter((s) => /^'use server';/.test(s.text))
    .flatMap((s) =>
      s.text
        .split(/^(?=export |async function |function )/m)
        .map((block) => ({ file: s.file, name: /^export async function (\w+)/.exec(block)?.[1], block }))
        .filter((a): a is { file: string; name: string; block: string } => !!a.name),
    );

  test('an action asks for a writer, directly or through the file\'s own helper, unless it is on the read-only list', () => {
    expect(actions.length).toBeGreaterThan(140);
    const helperWrites = (file: string) => /async function ctx\(\) \{\s*return \{ actor: await requireWriter\(\)/.test(sources.find((s) => s.file === file)!.text);
    const guarded = (a: (typeof actions)[number]) => a.block.includes('requireWriter()') || (a.block.includes('await ctx()') && helperWrites(a.file));
    const open = actions.filter((a) => !guarded(a)).map((a) => a.name).sort();
    expect(open).toEqual([...READ_ONLY].sort());
  });

  test('the read-only actions never go through the writer check, so looking still works', () => {
    const blocked = actions.filter((a) => READ_ONLY.includes(a.name) && (a.block.includes('requireWriter()') || a.block.includes('await ctx()')));
    expect(blocked.map((a) => a.name)).toEqual([]);
  });

  test('an action written inside a page hands over to a guarded action', () => {
    const inline = sources.filter((s) => !/^'use server';/.test(s.text)).flatMap((s) => [...s.text.matchAll(/'use server';([\s\S]{0,400}?)\}\}/g)].map((m) => ({ file: s.file, body: m[1]! })));
    expect(inline.length).toBeGreaterThan(20);
    const names = new Set(actions.filter((a) => !READ_ONLY.includes(a.name)).map((a) => a.name));
    const unguarded = inline.filter((i) => ![...i.body.matchAll(/await (\w+Action)\(/g)].some((m) => names.has(m[1]!)));
    expect(unguarded.map((i) => i.file)).toEqual([]);
  });
});
