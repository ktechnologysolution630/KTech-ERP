/** The company logo shipped with the app (public/logo.png); a logo URL set in the company settings takes its place */
export const LOGO_URL = '/logo.png';

/** The logo a page or document shows: the one set in the company settings, else the shipped one */
export const logoOf = (settingsLogoUrl: string | null | undefined): string => settingsLogoUrl || LOGO_URL;
