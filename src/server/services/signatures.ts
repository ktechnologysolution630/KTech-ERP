import { eq, inArray } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { userSignatures, users, type SessionUser } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import { signatureImageProblem, type SignerPerson } from '@/domain/signature';

/** The signature the person has set on their own profile */
export async function getMySignature(db: Db, actor: SessionUser): Promise<{ image: string; updatedAt: Date } | null> {
  const [row] = await db.select().from(userSignatures).where(eq(userSignatures.userId, actor.id)).limit(1);
  return row ? { image: row.image, updatedAt: row.updatedAt } : null;
}

/** Sets or replaces the person's own signature; nobody can set someone else's */
export async function saveMySignature(db: Db, actor: SessionUser, image: string): Promise<void> {
  const problem = signatureImageProblem(image);
  if (problem) throw new DomainError('INVALID_SIGNATURE', problem);
  const updatedAt = new Date();
  await db.insert(userSignatures).values({ userId: actor.id, image, updatedAt }).onConflictDoUpdate({ target: userSignatures.userId, set: { image, updatedAt } });
}

export async function deleteMySignature(db: Db, actor: SessionUser): Promise<void> {
  await db.delete(userSignatures).where(eq(userSignatures.userId, actor.id));
}

/**
 * Name and signature of the people who acted on a document, by user id. Someone without a
 * signature is still returned, so their name can stand on the line.
 */
export async function signerPeople(db: Db, userIds: (string | null | undefined)[]): Promise<Map<string, SignerPerson>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name, image: userSignatures.image })
    .from(users)
    .leftJoin(userSignatures, eq(userSignatures.userId, users.id))
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, { name: r.name, image: r.image }]));
}
