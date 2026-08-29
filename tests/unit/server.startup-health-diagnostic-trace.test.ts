/**
 * Startup-health honesty guard for `diagnostic_trace` (ISSUE-9020).
 *
 * THE DEFECT. `src/server.ts` computed the LOGGED value as
 *
 *     process.env.CEE_DIAGNOSTIC_TRACE_ENABLED !== undefined
 *       ? config.features.diagnosticTraceEnabled
 *       : nodeEnv !== 'production'
 *
 * while the gate the code actually consults is
 * `config.features.diagnosticTraceEnabled`, which defaults FALSE. With the
 * variable unset on any non-production deploy — staging's posture — the
 * startup health summary printed `diagnostic_trace: true` while the trace was
 * off. A log that reports a capability as ON when it is OFF is a broken alarm:
 * it costs whoever trusts it hours before they think to doubt it.
 *
 * WHY A STATIC GUARD. Booting Fastify is far too heavy for a unit test (the
 * same reasoning as `prompts.boot-snapshot-side-effect.test.ts`, which guards
 * a neighbouring line of this file the same way). Two assertions, one live and
 * one static:
 *
 *   1. The config default is genuinely `false` with the variable unset — the
 *      fact that made the old expression a lie. If this ever flips, the
 *      premise below needs re-deriving rather than inheriting.
 *   2. The summary's value is read from the config gate, and the startup
 *      summary does not re-derive it from `process.env` or from `nodeEnv`.
 *
 * Deliberately brittle: re-introducing ANY second source of truth for this
 * value REDs, which is the whole point of removing the first one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

const SERVER_SRC = readFileSync(pathResolve(process.cwd(), 'src', 'server.ts'), 'utf-8');

/**
 * The `log.info({ ... }, 'Startup health summary')` object literal, plus the
 * few lines above it where the logged value is computed. Bounded so the guard
 * cannot pass by finding a matching phrase elsewhere in a 1,000-line file.
 */
function startupHealthRegion(): string {
  const anchor = SERVER_SRC.indexOf("event: 'config.startup_health'");
  expect(anchor, 'startup health summary log not found in src/server.ts').toBeGreaterThan(-1);
  const end = SERVER_SRC.indexOf("'Startup health summary'", anchor);
  expect(end, 'startup health summary message not found in src/server.ts').toBeGreaterThan(anchor);
  // Include the ~15 lines preceding the log call, where the value is computed.
  const start = SERVER_SRC.lastIndexOf('const diagnosticTraceEnabled', anchor);
  expect(start, 'diagnosticTraceEnabled is no longer computed above the summary').toBeGreaterThan(-1);
  return SERVER_SRC.slice(start, end);
}

describe('startup health summary — diagnostic_trace reports the real gate (ISSUE-9020)', () => {
  it('the real gate defaults to false when the env var is unset', async () => {
    // The premise the guard rests on, derived rather than asserted from
    // memory: if this default ever became true, the old expression would have
    // been accidentally correct and this guard would need re-deriving.
    const previous = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    try {
      const { config } = await import('../../src/config/index.js');
      expect(config.features.diagnosticTraceEnabled).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
      else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = previous;
    }
  });

  it('logs the config gate itself', () => {
    const region = startupHealthRegion();
    expect(region).toContain('config.features.diagnosticTraceEnabled');
    expect(region).toContain('diagnostic_trace: diagnosticTraceEnabled');
  });

  it('does not re-derive the logged value from the environment or from nodeEnv', () => {
    const region = startupHealthRegion();
    // Comments in this region legitimately QUOTE the old expression to explain
    // what was wrong, so strip them before asserting on the code.
    const code = region
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
      .join('\n');
    // The two sources that made the log disagree with the gate.
    expect(code).not.toContain('CEE_DIAGNOSTIC_TRACE_ENABLED');
    expect(code).not.toContain('nodeEnv');
  });
});
