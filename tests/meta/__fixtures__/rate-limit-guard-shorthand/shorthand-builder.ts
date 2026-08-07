/**
 * FIXTURE — evasion E1: a SHORTHAND property `{ errorResponseBuilder }`.
 *
 * Idiomatic TypeScript, and invisible to an AST walk that only handles
 * `ts.isPropertyAssignment`. The plugin is "@fastify/rate-limit"; the builder
 * here returns the pre-fix plain object, so trusting this file would ship the
 * original 500-instead-of-429 defect.
 *
 * This directory also contains a CONFORMING builder on purpose: with a healthy
 * site present the totals look fine and the blinding controls cannot fire, which
 * is exactly the real-world shape (nine good sites, one evasive). The guard must
 * still report this file UNVERIFIABLE.
 */

declare const rateLimit: unknown;
declare const app: { register: (plugin: unknown, opts: unknown) => void };

const errorResponseBuilder = () => ({
  statusCode: 429,
  code: 'RATE_LIMITED',
  message: 'Too many requests',
});

app.register(rateLimit, { max: 1, errorResponseBuilder });
