/** The company logo shipped with the app (public/logo.png); a logo URL set in the company settings takes its place */
export const LOGO_URL = '/logo.png';
/** Printed under the Thai company name on documents; the Thai name and address come from settings */
export const COMPANY_NAME_EN = 'Ktechnology Solution';

/** The tax branch as a document prints it: 00000 is the head office */
export function branchLabel(branch: string | null | undefined): string {
  return !branch || branch === '00000' ? 'สำนักงานใหญ่' : `สาขา ${branch}`;
}

/** The logo a page or document shows: the one set in the company settings, else the shipped one */
export const logoOf = (settingsLogoUrl: string | null | undefined): string => settingsLogoUrl || LOGO_URL;
