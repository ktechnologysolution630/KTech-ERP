/** The company logo shipped with the app (public/logo.png); a logo URL set in the company settings takes its place */
export const LOGO_URL = '/logo.png';
/** Printed under the Thai company name on documents; the Thai name and address come from settings */
export const COMPANY_NAME_EN = 'Ktechnology Solution';

/** The logo a page or document shows: the one set in the company settings, else the shipped one */
export const logoOf = (settingsLogoUrl: string | null | undefined): string => settingsLogoUrl || LOGO_URL;
