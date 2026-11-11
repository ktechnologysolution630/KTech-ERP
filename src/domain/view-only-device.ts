/**
 * Terms of use (owner, 2026-11-11): on a phone or tablet of any make the system is for looking at
 * documents and approving them. Nothing may be created, changed, deleted, received, commented on or
 * uploaded from one; that is done on a notebook or desktop computer.
 */

/** Set by the browser itself once it finds it is a phone or tablet that calls itself a computer */
export const VIEW_ONLY_COOKIE = 'ktec_view_only';
export const VIEW_ONLY_PATH = '/view-only';
export const VIEW_ONLY_MESSAGE = 'มือถือและแท็บเล็ตใช้ดูและอนุมัติเอกสารได้เท่านั้น การสร้างหรือแก้ไขเอกสารต้องทำบนโน้ตบุ๊กหรือคอมพิวเตอร์ (ยกเว้นเมนูการใช้รถ)';

/**
 * The one exception the owner allowed: drivers use their phones to take a vehicle out, send where it
 * is and bring it back, so the vehicle pages stay writable on any device.
 */
export const ANY_DEVICE_PATH = '/vehicles';
export const isAnyDevicePath = (pathname: string) => pathname === ANY_DEVICE_PATH || pathname.startsWith(`${ANY_DEVICE_PATH}/`);

/**
 * Phones and tablets as their browsers name themselves: iPhone, iPad, Android of every make (Samsung,
 * Xiaomi, OPPO, Huawei…), Kindle, and the rest. A Chromebook ("CrOS") is a notebook and is not matched.
 */
const MOBILE_UA = /\b(iPhone|iPad|iPod|Android|Mobile|Tablet|Silk|Kindle|KF[A-Z]{2,4}|PlayBook|BlackBerry|BB10|Opera Mini|IEMobile|Windows Phone|webOS|HarmonyOS)\b/i;

export function isMobileUserAgent(userAgent: string | null | undefined): boolean {
  return MOBILE_UA.test(userAgent ?? '');
}

export interface DeviceSignals {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** Whether any pointing device can aim finely: a mouse or touchpad. Phones and tablets have none. */
  hasFinePointer?: boolean;
}

/**
 * Asked in the browser, which knows more than its name. An iPad and an Android tablet ask for the
 * desktop site by default and then call themselves a Mac or a Linux PC; what gives them away is a
 * touch screen with no mouse or touchpad. A touch-screen notebook has its touchpad, so it stays a computer.
 */
export function isMobileDevice(d: DeviceSignals): boolean {
  if (isMobileUserAgent(d.userAgent)) return true;
  const touch = (d.maxTouchPoints ?? 0) > 1;
  if (!touch) return false;
  const saysMac = d.platform === 'MacIntel' || /\bMacintosh\b/.test(d.userAgent);
  // No Mac has a touch screen
  if (saysMac) return true;
  return d.hasFinePointer === false;
}

/** Asked on the server, which sees only what the browser sent */
export function isViewOnlyRequest(userAgent: string | null | undefined, cookie: string | null | undefined): boolean {
  return isMobileUserAgent(userAgent) || cookie === '1';
}

/** A page that exists only to write something: `/pr/new`, `/po/<id>/edit`, the receiving form */
export function isEditingPath(pathname: string): boolean {
  if (isAnyDevicePath(pathname)) return false;
  const parts = pathname.split('/').filter(Boolean);
  if (parts.includes('new') || parts.includes('edit')) return true;
  return parts[0] === 'receive' && parts.length > 1;
}
