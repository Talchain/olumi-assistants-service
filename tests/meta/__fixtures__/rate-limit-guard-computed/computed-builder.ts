/**
 * FIXTURE — evasion E2: a COMPUTED key `{ [BUILDER_KEY]: … }`.
 *
 * Same class as E1 and equally invisible to a `ts.isPropertyAssignment` walk
 * that reads only identifier/string keys. The plugin is "@fastify/rate-limit";
 * the builder returns the pre-fix plain object.
 *
 * A CONFORMING builder sits alongside it so the blinding controls cannot fire —
 * the guard must catch this on the per-file contradiction alone.
 */

declare const rateLimit: unknown;
declare const app: { register: (plugin: unknown, opts: unknown) => void };

const BUILDER_KEY = 'errorResponseBuilder';

app.register(rateLimit, {
  max: 1,
  [BUILDER_KEY]: () => ({
    statusCode: 429,
    code: 'RATE_LIMITED',
    message: 'Too many requests',
  }),
});
