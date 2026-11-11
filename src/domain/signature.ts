import { formatThaiDate } from './thai';

/** A drawn signature is a few KB; this leaves room for an uploaded one without storing photos */
export const SIGNATURE_MAX_BYTES = 200 * 1024;
const PNG_PREFIX = 'data:image/png;base64,';
/** The eight bytes every PNG starts with, in base64 */
const PNG_MAGIC = 'iVBORw0KGgo';

/** Why a picture cannot be kept as a signature, or null when it can */
export function signatureImageProblem(image: string): string | null {
  if (!image.startsWith(PNG_PREFIX)) return 'ลายเซ็นต้องเป็นรูป PNG';
  const body = image.slice(PNG_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body) || !body.startsWith(PNG_MAGIC)) return 'ไฟล์ลายเซ็นไม่ถูกต้อง';
  if (Math.floor((body.length * 3) / 4) > SIGNATURE_MAX_BYTES) return 'รูปลายเซ็นใหญ่เกินไป (ไม่เกิน 200 KB)';
  return null;
}

/** One signature line of a document */
export interface Signer {
  /** ผู้จัดทำ, ผู้อนุมัติ, … */
  label: string;
  /** Set once the person has acted in the system; a line nobody has signed stays blank */
  name?: string;
  image?: string | null;
  /** Already formatted for the page */
  date?: string;
}

export interface SignerPerson {
  name: string;
  image: string | null;
}

/**
 * The line for one role. It is signed only when `userId` is known, the step has happened and the
 * person is found; otherwise the blank line of the printed form is kept for a pen.
 */
export function signerLine(
  label: string,
  people: ReadonlyMap<string, SignerPerson>,
  userId: string | null | undefined,
  at: Date | string | null | undefined,
  done = true,
): Signer {
  const person = done && userId ? people.get(userId) : undefined;
  if (!person) return { label };
  return { label, name: person.name, image: person.image, date: at ? formatThaiDate(at) : undefined };
}
