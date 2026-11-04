/** Set by the proxy on every page request, so a page that finds the session expired knows where to come back to. */
export const RETURN_PATH_HEADER = 'x-return-path';

/** Only a path on this site may be returned to after login; anything else would make the login page an open redirect. */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null;
  // Browsers treat a backslash as a slash and drop tabs and newlines, which would turn these into another site's address
  if (/[\\\u0000-\u001f]/.test(raw)) return null;
  return raw.startsWith('/login') ? null : raw;
}

export const loginUrlFor = (returnPath: string | null | undefined): string => {
  const safe = safeReturnPath(returnPath);
  return safe && safe !== '/' ? `/login?next=${encodeURIComponent(safe)}` : '/login';
};
