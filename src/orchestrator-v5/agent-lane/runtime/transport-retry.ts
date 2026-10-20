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


/** Read the provider's typed reason, never infer billing from HTTP 429 or its prose. */
export function providerFailureOf(err: unknown): Record<string, unknown> {
  const e = err as { code?: unknown; type?: unknown; status?: unknown; headers?: Headers } | null | undefined;
  const capacity = [e?.code, e?.type].some(x => x === 'insufficient_quota' || x === 'credit_balance_exhausted');
  const limited = [e?.code, e?.type].some(x => x === 'rate_limit_exceeded');
  const retryAfter = e?.headers?.get('retry-after');
  const retryAfterMs = e?.headers?.get('retry-after-ms');
  return {
    error: capacity ? 'PROVIDER_CAPACITY' : 'UPSTREAM_ERROR',
    ...(capacity ? { retryable: false } : limited ? { retryable: true } : {}),
    ...(e?.code !== undefined || e?.type !== undefined || e?.status !== undefined ? {
      provider_error: { code: e.code ?? null, type: e.type ?? null, status: e.status ?? null },
    } : {}),
    ...(retryAfter == null ? {} : { retry_after: retryAfter }),
    ...(retryAfterMs == null ? {} : { retry_after_ms: retryAfterMs }),
  };
}
