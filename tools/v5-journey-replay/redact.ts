/**
 * V5 replay harness — defense-in-depth secret redactor.
 *
 * Contract: the `OLUMI_REPLAY_API_KEY` (or any provided secret) must NEVER
 * appear in:
 *   - stdout / stderr (console.log, console.error)
 *   - the evidence pack markdown (`row.evidence`, `row.failing_contract`,
 *     header fields)
 *   - `Error.message` or `Error.stack` surfaced to the harness
 *   - any diagnostic serialisation of request/response objects
 *
 * Three layers apply this redactor (defense-in-depth):
 *   1. `postTurn` in `client.ts` rewraps fetch errors so undici internals
 *      cannot reflect request headers through `Error.stack`.
 *   2. The top-level catch in `index.ts` redacts before writing to the
 *      `evidence` field and before any console write.
 *   3. `evidence-writer.ts` applies the redactor a final time at markdown
 *      emission (belt-and-suspenders — catches any drift where a row was
 *      pushed without redaction).
 *
 * Implementation note: we use `split/join` rather than regex replacement
 * because API keys can contain regex metacharacters (`+`, `/`, `=`, `.`)
 * from base64url encoding. Regex-escaping is fragile; split/join is not.
 */

/**
 * Returns a function that redacts the given secret from any stringified
 * input. If `secret` is undefined or empty, the returned function is the
 * identity stringifier (no-op). Handles `Error` specifically by also
 * redacting `.stack`.
 */
export function createRedactor(secret: string | undefined): (input: unknown) => string {
  if (!secret || secret.length === 0) {
    return (input: unknown) => stringify(input);
  }
  return (input: unknown) => redactString(stringify(input), secret);
}

/**
 * Redacts every occurrence of `secret` in `s` with `[REDACTED]`. Uses
 * split/join — safe for secrets containing regex metacharacters.
 */
export function redactString(s: string, secret: string | undefined): string {
  if (!secret || secret.length === 0) return s;
  return s.split(secret).join('[REDACTED]');
}

/**
 * Stringify any value for log/evidence use. Errors get special handling
 * so `.stack` is captured (stack is the highest-risk surface for leaks —
 * undici versions have historically included request metadata).
 */
function stringify(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof Error) {
    const stack = input.stack ?? '';
    // Include stack so the redactor has a chance to scrub it.
    return stack.length > 0 ? stack : input.message;
  }
  if (input === null || input === undefined) return String(input);
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

/**
 * Sanitise an `Error`'s message + stack against a secret. Used by
 * `postTurn` to re-throw fetch errors with no leakage risk.
 */
export function sanitiseError(err: unknown, secret: string | undefined): Error {
  if (!(err instanceof Error)) {
    return new Error(redactString(String(err), secret));
  }
  const cleanMessage = redactString(err.message, secret);
  const sanitised = new Error(cleanMessage);
  if (err.stack) {
    sanitised.stack = redactString(err.stack, secret);
  }
  // Preserve the original name (e.g. `AbortError`) so callers can branch
  // on timeout vs. other failure classes.
  if (err.name) sanitised.name = err.name;
  return sanitised;
}
