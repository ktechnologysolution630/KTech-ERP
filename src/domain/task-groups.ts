/** A row of the project's main BOQ, enough to read its sections and sub-headings */
export interface BoqOutlineRow {
  isCategory: boolean;
  no: string;
  description: string;
  qty: string | number | null;
  materialRate: string | number | null;
  laborRate: string | number | null;
}

export interface TaskTitleOption {
  /** Shown in the picker, e.g. "1.11 งานโครงหลังคา" */
  label: string;
  /** Title the task gets */
  title: string;
}

export interface TaskGroupOption extends TaskTitleOption {
  /** หมวดงาน under this group: the BOQ sub-headings inside the section */
  categories: TaskTitleOption[];
}

const MAX_TITLE = 300;
const isWholeNumber = (no: string) => /^\d+(\.0*)?$/.test(no.trim());
const hasAmount = (v: string | number | null) => v !== null && v !== '' && Number(v) !== 0;
const labelOf = (no: string, title: string) => [no.trim(), title].filter(Boolean).join(' ');

/**
 * Reads the BOQ outline for the task form: sections (หมวด rows, or an unpriced heading numbered
 * with a whole number such as "4") become กลุ่มงาน, and the unpriced sub-headings inside each
 * section (such as "1.11 งานโครงหลังคา") become its หมวดงาน. Sheet order is kept; repeated names are dropped.
 */
export function boqTaskOutline(rows: BoqOutlineRow[]): TaskGroupOption[] {
  const groups: TaskGroupOption[] = [];
  const groupTitles = new Set<string>();
  let current: TaskGroupOption | null = null;
  for (const r of rows) {
    const title = r.description.trim().slice(0, MAX_TITLE);
    if (!title) continue;
    const heading = !hasAmount(r.qty) && !hasAmount(r.materialRate) && !hasAmount(r.laborRate);
    if (r.isCategory || (heading && isWholeNumber(r.no))) {
      if (groupTitles.has(title)) {
        current = groups.find((g) => g.title === title) ?? null;
        continue;
      }
      groupTitles.add(title);
      current = { label: labelOf(r.no, title), title, categories: [] };
      groups.push(current);
      continue;
    }
    if (heading && current && !/^\s*-/.test(r.description) && !current.categories.some((c) => c.title === title)) {
      current.categories.push({ label: labelOf(r.no, title), title });
    }
  }
  return groups;
}
