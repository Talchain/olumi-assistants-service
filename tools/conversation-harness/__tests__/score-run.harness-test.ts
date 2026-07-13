/**
 * Self-test for score-run.ts token accounting (FIX-2). Unlike the pure dim
 * self-tests, this imports score-run.ts, which imports the REAL src/ guard
 * modules (pure regex) — so it needs node_modules present (bootstrap-worktree).
 * The module-level CLI entrypoint is isMain-guarded, so importing it here does
 * not run the scorer or throw on a missing RUN_DIR.
 *
 * NOT collected by the root required gate (the .harness-test.ts suffix does not
 * match `**.{test,spec}.*`). Run with:
 *   pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, expect, it } from 'vitest';
import { buildScoredRow, llmTokenTotals } from '../scorer/score-run.js';
import { opsFromRows } from '../scorer/ab-verdict.js';
import { rowFromWire } from '../scorer/dims.js';

/** Build the ScoredRow the same way score-run's loader does. */
function scored(llmCalls: unknown[]) {
  const wire = { assistant_text: 'The analysis is complete.', _diagnostic_trace: { llm_calls: llmCalls } };
  const row = rowFromWire('T1', wire, { http_status: 200 });
  return buildScoredRow('T1', wire, '', row, []);
}

describe('llmTokenTotals (FIX-2 null-honest tokens)', () => {
  it('is null/null when there are no llm_calls', () => {
    expect(llmTokenTotals([])).toEqual({ input: null, output: null });
  });

  it('is null when llm_calls EXIST but carry NO usage figures (aborted/streamed/routing)', () => {
    const usageless = [
      { role: 'generation', model: 'sonnet', latency_ms: 900 },
      { role: 'routing', model: 'haiku', latency_ms: 20 },
    ];
    expect(llmTokenTotals(usageless)).toEqual({ input: null, output: null });
  });

  it('keeps a real 0 when usage IS present and zero (distinguished from missing)', () => {
    expect(llmTokenTotals([{ role: 'routing', input_tokens: 0, output_tokens: 0 }])).toEqual({ input: 0, output: 0 });
  });

  it('sums flat token fields', () => {
    const calls = [
      { input_tokens: 1000, output_tokens: 200 },
      { input_tokens: 500, output_tokens: 50 },
    ];
    expect(llmTokenTotals(calls)).toEqual({ input: 1500, output: 250 });
  });

  it('reads token fields nested under a usage object', () => {
    expect(llmTokenTotals([{ usage: { input_tokens: 300, output_tokens: 40 } }])).toEqual({ input: 300, output: 40 });
  });

  it('sums only the usage-bearing calls when mixed with usageless ones', () => {
    const mixed = [{ input_tokens: 100, output_tokens: 20 }, { role: 'routing', latency_ms: 5 }];
    expect(llmTokenTotals(mixed)).toEqual({ input: 100, output: 20 });
  });
});

describe('buildScoredRow token fields flow into the OPS cost comparison (FIX-2)', () => {
  it('present-but-usageless llm_calls -> llm_tokens null AND excluded from opsFromRows totalTokens', () => {
    const r = scored([
      { role: 'generation', model: 'sonnet', latency_ms: 900 },
      { role: 'routing', model: 'haiku', latency_ms: 20 },
    ]);
    // The bug: these summed to 0 (a number) and made an arm with MISSING token
    // data rank cheaper. Null-honest now.
    expect(r.llm_tokens_in).toBeNull();
    expect(r.llm_tokens_out).toBeNull();
    expect(opsFromRows([r]).totalTokens).toBeNull();
  });

  it('real usage -> numeric tokens counted by opsFromRows', () => {
    const r = scored([{ input_tokens: 1200, output_tokens: 300 }]);
    expect(r.llm_tokens_in).toBe(1200);
    expect(r.llm_tokens_out).toBe(300);
    expect(opsFromRows([r]).totalTokens).toBe(1500);
  });

  it('genuine zero usage -> 0 is a real measurement, counted (not excluded)', () => {
    const r = scored([{ role: 'routing', input_tokens: 0, output_tokens: 0 }]);
    expect(r.llm_tokens_in).toBe(0);
    expect(opsFromRows([r]).totalTokens).toBe(0);
  });
});
