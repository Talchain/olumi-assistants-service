/**
 * FIXTURE — not product code, not collected by vitest.
 *
 * The DEFECT the guard exists to catch: an "@fastify/rate-limit"
 * errorResponseBuilder returning a PLAIN OBJECT. The plugin throws this value;
 * a non-Error reaches the app's custom setErrorHandler as an unknown type and
 * is answered 500 INTERNAL. Note it carries `statusCode: 429` — the exact
 * pre-fix shape, which typechecks clean and which lint cannot see.
 *
 * The guard MUST flag this file. If it ever stops doing so, the guard has
 * become vacuous and the meta test goes RED.
 */

declare const rateLimit: unknown;
declare const app: { register: (plugin: unknown, opts: unknown) => void };

app.register(rateLimit, {
  max: 1,
  errorResponseBuilder: () => ({
    statusCode: 429,
    schema: 'error.v1',
    code: 'RATE_LIMITED',
    message: 'Too many requests',
    details: { retry_after_seconds: 60 },
  }),
});
