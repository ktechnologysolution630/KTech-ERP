import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { isEditingPath, isMobileDevice, isMobileUserAgent, isViewOnlyRequest } from '@/domain/view-only-device';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1';
const IPAD_MOBILE = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
// What an iPad sends by default, and what a real Mac sends: the same thing
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';
const SAMSUNG_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const SAMSUNG_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const XIAOMI = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; 2211133C Build/TKQ1.220905.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.127 Mobile Safari/537.36 XiaoMi/MiuiBrowser/17.4.80';
const HUAWEI = 'Mozilla/5.0 (Linux; Android 12; HarmonyOS; NOH-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 Mobile Safari/537.36';
const KINDLE = 'Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.4.1 like Chrome/120.0.6099.230 Safari/537.36';
// An Android tablet asking for the desktop site
const LINUX_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const CHROMEBOOK = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

describe('which devices may only look and approve', () => {
  test('phones and tablets of every make are known by what their browser says', () => {
    for (const ua of [IPHONE, IPHONE_CHROME, IPAD_MOBILE, ANDROID, SAMSUNG_PHONE, SAMSUNG_TABLET, XIAOMI, HUAWEI, KINDLE]) expect(isMobileUserAgent(ua)).toBe(true);
    for (const ua of [MAC_SAFARI, WINDOWS, LINUX_DESKTOP, CHROMEBOOK, '', null, undefined]) expect(isMobileUserAgent(ua)).toBe(false);
  });

  test('a tablet calling itself a computer is given away by a touch screen with no mouse or touchpad', () => {
    expect(isMobileDevice({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isMobileDevice({ userAgent: LINUX_DESKTOP, platform: 'Linux x86_64', maxTouchPoints: 10, hasFinePointer: false })).toBe(true);
    expect(isMobileDevice({ userAgent: ANDROID, platform: 'Linux armv81', maxTouchPoints: 5, hasFinePointer: false })).toBe(true);
    // A notebook: a real Mac, a touch-screen Windows notebook with its touchpad, a Chromebook, a desktop
    expect(isMobileDevice({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0, hasFinePointer: true })).toBe(false);
    expect(isMobileDevice({ userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 10, hasFinePointer: true })).toBe(false);
    expect(isMobileDevice({ userAgent: CHROMEBOOK, platform: 'Linux x86_64', maxTouchPoints: 10, hasFinePointer: true })).toBe(false);
    expect(isMobileDevice({ userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 0, hasFinePointer: true })).toBe(false);
    // Unknown pointer: a computer is given the benefit of the doubt
    expect(isMobileDevice({ userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 10 })).toBe(false);
  });

  test('the server goes by the browser name, or by the mark the browser left', () => {
    expect(isViewOnlyRequest(IPHONE, undefined)).toBe(true);
    expect(isViewOnlyRequest(SAMSUNG_TABLET, undefined)).toBe(true);
    expect(isViewOnlyRequest(MAC_SAFARI, '1')).toBe(true);
    expect(isViewOnlyRequest(MAC_SAFARI, undefined)).toBe(false);
    expect(isViewOnlyRequest(WINDOWS, '')).toBe(false);
    expect(isViewOnlyRequest(WINDOWS, '0')).toBe(false);
    expect(isViewOnlyRequest(null, null)).toBe(false);
  });

  test('pages made only for writing are not opened', () => {
    for (const p of ['/pr/new', '/po/new', '/po/8f1c/edit', '/sales/quotations/new', '/ar/invoices/new', '/receive/8f1c']) expect(isEditingPath(p)).toBe(true);
    for (const p of ['/pr', '/pr/8f1c', '/po/8f1c', '/receive', '/inbox', '/news', '/projects/8f1c/boq', '/', '/vehicles/new', '/vehicles/8f1c']) expect(isEditingPath(p)).toBe(false);
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
    'loadFleetLiveAction', 'loadTripRouteAction',
  ];
  /** The vehicle menu: written from any device, phones included, by the owner's decision of 2026-11-11 */
  const ANY_DEVICE_DIR = 'vehicles/';
  /**
   * Approving and refusing: what a phone or tablet may do besides looking (owner, 2026-11-11). The PRV
   * and milestone actions also hold other steps, which they keep behind the writer check themselves.
   */
  const DECISIONS = [
    'approvePrAction', 'rejectPrAction', 'approvePoAction', 'rejectPoAction', 'approveCloseShortAction', 'rejectCloseShortAction',
    'approvePvAction', 'rejectPvAction', 'decideAdvanceAction', 'decideReceiptSubstituteAction', 'decideApprovalAction',
    'decideBoqOverrunAction', 'decideVoAction', 'decideStockAdjustAction', 'transitionPrvAction', 'advanceMilestoneAction',
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
    const anyDeviceHelper = (file: string) => /async function ctx\(\) \{\s*return \{ actor: await requireUserOnAnyDevice\(\)/.test(sources.find((s) => s.file === file)!.text);
    const vehicleAction = (a: (typeof actions)[number]) => a.file.startsWith(ANY_DEVICE_DIR) && (a.block.includes('requireUserOnAnyDevice()') || (a.block.includes('await ctx()') && anyDeviceHelper(a.file)));
    const decision = (a: (typeof actions)[number]) => DECISIONS.includes(a.name) && (a.block.includes('requireDecider()') || a.block.includes('await decideCtx()'));
    const guarded = (a: (typeof actions)[number]) =>
      (a.block.includes('requireWriter()') && !a.block.includes('requireDecider()')) || (a.block.includes('await ctx()') && helperWrites(a.file)) || vehicleAction(a) || decision(a);
    const open = actions.filter((a) => !guarded(a)).map((a) => a.name).sort();
    expect(open).toEqual([...READ_ONLY].sort());
  });

  test('only approving and refusing are let through on a phone, and each of them is', () => {
    const deciders = actions.filter((a) => a.block.includes('requireDecider()') || a.block.includes('await decideCtx()')).map((a) => a.name).sort();
    expect(deciders).toEqual([...DECISIONS].sort());
    // A PRV is sent from a computer; a phone only checks, approves or refuses it
    const prv = actions.find((a) => a.name === 'transitionPrvAction')!;
    expect(prv.block).toMatch(/action === 'submit' \? await requireWriter\(\) : await requireDecider\(\)/);
    // A milestone is claimed and paid from a computer; a phone only approves it
    const milestone = actions.find((a) => a.name === 'advanceMilestoneAction')!;
    expect(milestone.block).toMatch(/approvalOnly/);
  });

  test('only the vehicle menu may write from any device', () => {
    const outside = sources.filter((s) => !s.file.startsWith(ANY_DEVICE_DIR) && s.text.includes('requireUserOnAnyDevice'));
    expect(outside.map((s) => s.file)).toEqual([]);
    expect(actions.filter((a) => a.file.startsWith(ANY_DEVICE_DIR)).length).toBeGreaterThan(5);
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
