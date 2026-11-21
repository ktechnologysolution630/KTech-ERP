/** The company logo shipped with the app (public/logo.png); a logo URL set in the company settings takes its place */
export const LOGO_URL = '/logo.png';
/** Printed under the Thai company name on documents; the Thai name and address come from settings */
export const COMPANY_NAME_EN = 'K TECHNOLOGY SOLUTION CO., LTD.';

/** The logo a page or document shows: the one set in the company settings, else the shipped one */
export const logoOf = (settingsLogoUrl: string | null | undefined): string => settingsLogoUrl || LOGO_URL;

/**
 * The company name without its legal suffix ("CO., LTD.", "LIMITED", "PUBLIC COMPANY LIMITED", "LTD." ...),
 * for the sidebar brand where space is short; documents keep the full legal name
 */
export const shortCompanyName = (name: string): string =>
  name
    .trim()
    .replace(/[\s,]*(?:public\s+)?(?:co(?:mpany)?\.?\s*,?\s*)?(?:ltd\.?|limited)\.?$/i, '')
    .trim() || name.trim();
