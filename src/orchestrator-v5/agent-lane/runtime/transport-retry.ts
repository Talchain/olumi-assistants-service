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
    onRetry?.(label, String(err));
    return call();
  }
}

