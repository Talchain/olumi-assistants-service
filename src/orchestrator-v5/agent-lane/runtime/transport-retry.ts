/**
 * One retry, and only for a TRANSPORT failure.
 *
 * ⛔ MEASURED, NOT PRECAUTIONARY. In a six-turn head-to-head one turn died with
 * `TypeError: fetch failed` after 196 ms — a connection-level failure to the
 * model API — and the route answered 502. The user's turn was simply lost, and
 * a 1-in-6 loss rate makes any journey witness a coin toss.
 *
 * ⛔ IT MUST NOT RETRY AN HTTP ERROR. A 4xx is a decision the API made about
 * the request and repeating it changes nothing; a 5xx may already have been
 * charged. Only a thrown `fetch` rejection — no response at all — is retried,
 * exactly once, so a genuine outage still fails fast and honestly.
 */
export async function onceMoreOnTransportFailure<T>(
  label: string,
  call: () => Promise<T>,
  onRetry?: (label: string, err: string) => void,
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    // An HTTP status we raised ourselves is a real answer; do not repeat it.
    if (String(err).startsWith('Error: openai_')) throw err;
    // A deadline WE set (AbortSignal.timeout) is a decision, not a transport failure: repeating it doubles the wait.
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw err;
    onRetry?.(label, String(err));
    return call();
  }
}


/** The provider's own type and code for a capacity or credit refusal (OpenAI's error body, as served 18 and 19 Oct). */
const PROVIDER_CAPACITY = new Set(['insufficient_quota', 'credit_balance_exhausted', 'rate_limit_exceeded']);

/**
 * The provider refused this turn for capacity or credits, so a retry now cannot help (DL-3 20 Oct: Paul was told "Please
 * retry" three times on an account with no credits). Read from the provider's typed refusal only: HTTP 429 on a call the
 * route made itself (the `openai_` status above), or the SDK error's `type`/`code` (a streamed `error` event has no status).
 */
export function isProviderCapacityRefusal(err: unknown): boolean {
  if (String(err).startsWith('Error: openai_429')) return true;
  if (!(err instanceof Error)) return false;
  const { code, type } = err as Error & { code?: unknown; type?: unknown };
  return PROVIDER_CAPACITY.has(String(code)) || PROVIDER_CAPACITY.has(String(type));
}
