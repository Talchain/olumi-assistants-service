/**
 * The per-limit ask is MG's producer (`limitCheckAsks`). If it ever throws, the run result keeps every limit row — how
 * each limit was checked — and only the asks are lost. Companion to `limit-checks-carry-the-ask.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { StoredLimitVerdicts } from '../../../orchestrator/context/constraint-feasibility.js';

vi.mock('../limited-level-ask.js', () => ({ limitCheckAsks: () => { throw new Error('boom'); } }));

const FX = JSON.parse(readFileSync(new URL('./fixtures/pj-c10-063347Z-limits-estimate-only.json', import.meta.url), 'utf8')) as {
  graph: Record<string, unknown>; limit_verdicts: StoredLimitVerdicts;
};

describe('a throwing ask producer never costs the run its limit rows', () => {
  it('every row stays, with its sentence and without an ask', async () => {
    const { limitChecksForAgent } = await import('../limit-checks.js');
    const rows = limitChecksForAgent(FX.graph, FX.limit_verdicts)!;
    expect(rows.map((r) => r.constraint_id)).toEqual(FX.limit_verdicts.per_limit.map((r) => r.constraint_id));
    for (const r of rows) {
      // B6 (AIQ 5916187873): the served options resting on Olumi's figures are named, never "checked against" them.
      expect(r.say).toMatch(/it isn’t shown: /);
      // Only the throwing producer's asks are lost. The per-option questions (R-c's link size, B6's arm) come from the
      // per-option withhold, which did not throw, so they alone remain.
      if (r.constraint_id === 'agent-lane:monthly_churn:<=') expect(r.ask).toBe('What is ‘Monthly churn’ today? How much does ‘Pro plan price’ change ‘Monthly churn’?');
      else expect(r.ask).toBe('What’s each option’s likely range for ‘Total investment’?');
    }
  });
});

describe('a throwing per-option withhold never costs the run its limit rows', () => {
  it('every row stays, with its level sentence; only the per-option words and link-size asks are lost', async () => {
    vi.resetModules();
    vi.doMock('../../../orchestrator/context/placeholder-parts.js', async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      placeholderPartsFinding: () => { throw new Error('boom'); },
    }));
    const { limitChecksForAgent } = await import('../limit-checks.js');
    const rows = limitChecksForAgent(FX.graph, FX.limit_verdicts)!;
    expect(rows.map((r) => r.constraint_id)).toEqual(FX.limit_verdicts.per_limit.map((r) => r.constraint_id));
    for (const r of rows) {
      expect(r.say).toBe(`‘${r.limit}’ was checked, but only against Olumi’s estimates, not figures you gave.`);
      expect(r).not.toHaveProperty('withheld_for');
    }
    vi.doUnmock('../../../orchestrator/context/placeholder-parts.js');
  });
});
