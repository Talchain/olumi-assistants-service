/**
 * FIXTURE — not product code, not collected by vitest.
 *
 * Positive-control input for the derived guard in
 * tests/meta/rate-limit-builders-return-error.test.ts: a CONFORMING
 * "@fastify/rate-limit" errorResponseBuilder. The guard must NOT flag this file.
 *
 * Deliberately dependency-free (locally declared stand-ins) so the fixture can
 * never drift with the real plugin's types; the guard is a syntactic check and
 * reads these bytes exactly as it reads src/.
 */

declare const rateLimit: unknown;
declare const app: { register: (plugin: unknown, opts: unknown) => void };

class FixtureRateLimitedError extends Error {
  readonly statusCode = 429;
}

app.register(rateLimit, {
  max: 1,
  errorResponseBuilder: () => new FixtureRateLimitedError('Rate limit exceeded'),
});
