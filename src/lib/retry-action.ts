/**
 * Runs a server action, trying again when the call itself fails (no answer, or an answer that is
 * not from the app, as when the host is still waking the server). A refusal from the app is a
 * normal result and is returned at once. Only for actions that are safe to send twice: the second
 * try of one that did go through is refused by the app's own state checks.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: { tries?: number; waitMs?: number; onRetry?: (attempt: number) => void } = {}): Promise<T> {
  const tries = opts.tries ?? 4;
  const waitMs = opts.waitMs ?? 5000;
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt === tries) break;
      opts.onRetry?.(attempt);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw last;
}
