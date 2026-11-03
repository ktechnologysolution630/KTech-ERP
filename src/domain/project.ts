export const PROJECT_STATUSES = [
  'PLANNING',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: 'วางแผน',
  IN_PROGRESS: 'กำลังดำเนินการ',
  ON_HOLD: 'พักงาน',
  COMPLETED: 'เสร็จสิ้น',
  CANCELLED: 'ยกเลิก',
};

/**
 * Ready-made cover photos (Unsplash, hotlinked). The server only accepts these exact URLs
 * besides uploaded files, so a cover can never point at an arbitrary external site.
 */
export const PROJECT_COVER_PRESETS = [
  'photo-1504307651254-35680f356dfd',
  'photo-1531834685032-c34bf0d84c77',
  'photo-1429497419816-9ca5cfb4571a',
  'photo-1508450859948-4e04fabaa4ea',
  'photo-1517089596392-fb9a9033e05b',
  'photo-1503387762-592deb58ef4e',
].map((id) => `https://images.unsplash.com/${id}?q=80&w=1200&auto=format&fit=crop`);

/** Closed projects are hidden from the default project list; handover/warranty need COMPLETED. */
export function isProjectClosed(status: ProjectStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}
