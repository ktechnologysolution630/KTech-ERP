import { redirect } from 'next/navigation';
import { DomainError } from '@/domain/errors';

/**
 * In production Next.js hides the message of an error thrown by a server action, so a refusal such as
 * "this PO already has goods received" reached the user as a bare "Application error" page. These helpers
 * catch the refusal (a DomainError, whose message is written for users) and hand its Thai message back.
 * Anything else is unexpected and still thrown.
 */

/** For a callback a client component awaits: the refusal's message, or undefined when the work went through */
export async function messageOnRefusal(work: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await work();
    return undefined;
  } catch (err) {
    if (err instanceof DomainError) return err.message;
    throw err;
  }
}

/** For a plain <form action>: on a refusal, back to `path` with the message in ?error=, which the page shows */
export async function returnOnRefusal(path: string, work: () => Promise<unknown>): Promise<void> {
  const message = await messageOnRefusal(work);
  if (message !== undefined) redirect(withErrorParam(path, message));
}

export function withErrorParam(path: string, message: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`;
}
