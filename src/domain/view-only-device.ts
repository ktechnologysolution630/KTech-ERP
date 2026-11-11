/**
 * Terms of use: on an iPhone or iPad the system is for looking at documents only. Nothing may be
 * created, changed, approved, received, commented on or uploaded from one.
 */

/** Set by the browser itself once it finds it is an iPad that calls itself a Mac */
export const VIEW_ONLY_COOKIE = 'ktec_view_only';
export const VIEW_ONLY_PATH = '/view-only';
export const VIEW_ONLY_MESSAGE = 'iPad และ iPhone ใช้ดูเอกสารได้อย่างเดียว ไม่สามารถสร้าง แก้ไข หรืออนุมัติได้ (ยกเว้นเมนูการใช้รถ)';

/**
 * The one exception the owner allowed (2026-11-11): drivers use their phones to take a vehicle out,
 * send where it is and bring it back, so the vehicle pages stay writable on any device.
 */
export const ANY_DEVICE_PATH = '/vehicles';
export const isAnyDevicePath = (pathname: string) => pathname === ANY_DEVICE_PATH || pathname.startsWith(`${ANY_DEVICE_PATH}/`);

/** iPhone, iPod touch and iPad, in Safari or any other browser on them */
export function isAppleMobileUserAgent(userAgent: string | null | undefined): boolean {
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent ?? '');
}

/**
 * Asked in the browser. iPadOS asks for the desktop site by default and then says it is a Mac; only
 * its touch screen gives it away, and no Mac has one.
 */
export function isAppleMobileDevice(nav: { userAgent: string; platform?: string; maxTouchPoints?: number }): boolean {
  if (isAppleMobileUserAgent(nav.userAgent)) return true;
  const saysMac = nav.platform === 'MacIntel' || /\bMacintosh\b/.test(nav.userAgent);
  return saysMac && (nav.maxTouchPoints ?? 0) > 1;
}

/** Asked on the server, which sees only what the browser sent */
export function isViewOnlyRequest(userAgent: string | null | undefined, cookie: string | null | undefined): boolean {
  return isAppleMobileUserAgent(userAgent) || cookie === '1';
}

/** A page that exists only to write something: `/pr/new`, `/po/<id>/edit`, the receiving form */
export function isEditingPath(pathname: string): boolean {
  if (isAnyDevicePath(pathname)) return false;
  const parts = pathname.split('/').filter(Boolean);
  if (parts.includes('new') || parts.includes('edit')) return true;
  return parts[0] === 'receive' && parts.length > 1;
}
