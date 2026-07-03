import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { tryRunComparisonGate } from '../run-comparison-gate.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

// Self-contained fixtures (no shared integration mocks).
function envelope(options: Array<{ id: string; label: string; win: number }>, band?: string): V2RunResponseEnvelope {
  return {
    analysis_status: 'completed',
    results: options.map((o) => ({ option_id: o.id, option_label: o.label, win_probability: o.win })),
    ...(band ? { robustness_synthesis: { overall_assessment: band } } : {}),
  } as unknown as V2RunResponseEnvelope;
}

function runFact(env: V2RunResponseEnvelope): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: { enrichment: env, computed_at: '2026-06-06T00:00:00.000Z', graph_hash_at_run: 'h' },
  } as unknown as HandlerFact;
}

const PRIOR = runFact(envelope([{ id: 'a', label: 'Offshore', win: 0.62 }, { id: 'b', label: 'Onshore', win: 0.38 }], 'low'));
const CURRENT = runFact(envelope([{ id: 'b', label: 'Onshore', win: 0.55 }, { id: 'a', label: 'Offshore', win: 0.45 }], 'high'));
const TWO_RUNS = [CURRENT, PRIOR];

// Forbidden in user-facing copy (internal vocab / IDs / raw decimals).
const FORBIDDEN = /\b(node|edge|graph|winner|sensitivity|robustness|_meta|option_id|node_id)\b/i;
const RAW_DECIMAL = /\d\.\d/;

describe('tryRunComparisonGate', () => {
  it('compares two runs on "what changed?" when fresh', () => {
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: TWO_RUNS, freshness: 'fresh' });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('compared');
    expect(out.leading_option_changed).toBe(true);
    expect(out.assistant_text).toContain('leading option has changed');
    expect(out.assistant_text).toContain('Offshore');
    expect(out.assistant_text).toContain('Onshore');
    expect(out.assistant_text).toContain('narrowed');
    expect(out.assistant_text).toContain('percentage points');
    // copy safety
    expect(out.assistant_text).not.toMatch(FORBIDDEN);
    expect(out.assistant_text).not.toMatch(RAW_DECIMAL);
    expect(out.assistant_text).not.toContain('--');
  });

  it('matches "why did the result change?" too', () => {
    const out = tryRunComparisonGate({ message: 'Why did the result change?', priorFacts: TWO_RUNS, freshness: 'fresh' });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('compared');
  });

  it('leads with re-run guidance when the model is stale (edited after the latest run)', () => {
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: TWO_RUNS, freshness: 'stale' });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('stale');
    expect(out.assistant_text.toLowerCase()).toContain('re-run');
    expect(out.suggested_actions).toHaveLength(1);
    expect(out.suggested_actions[0].action_type).toBe('run_analysis');
    expect(out.assistant_text).not.toMatch(FORBIDDEN);
  });

  // T4 Slice 3 — freshness fail-closed. Before this slice, an `unknown`
  // verdict (legacy fact missing its run-time hash, or an unhashable current
  // graph) fell through to the same comparison path as `fresh`, returning a
  // confident two-run comparison on unverified currency. Merged policy
  // §1b/§1-parity/§5 require holding instead.
  it('FAIL-CLOSED: does NOT compare on unknown freshness — offers an unconfirmed re-run without claiming the model changed', () => {
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: TWO_RUNS, freshness: 'unknown' });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    // Never a comparison on unverified currency.
    expect(out.mode).toBe('unconfirmed');
    expect(out.mode).not.toBe('compared');
    // Offers a re-run…
    expect(out.assistant_text.toLowerCase()).toContain('re-run');
    expect(out.suggested_actions).toHaveLength(1);
    expect(out.suggested_actions[0].action_type).toBe('run_analysis');
    // …but must NOT assert the model changed (that is the stale-only claim;
    // on unknown we cannot know it — §1 authority parity).
    expect(out.assistant_text.toLowerCase()).not.toContain('has changed');
    expect(out.assistant_text.toLowerCase()).toContain("can't confirm");
    // No comparison content leaked.
    expect(out.assistant_text).not.toContain('leading option has changed');
    expect(out.leading_option_changed).toBeNull();
    // Copy safety.
    expect(out.assistant_text).not.toMatch(FORBIDDEN);
    expect(out.assistant_text).not.toMatch(RAW_DECIMAL);
  });

  it('FAIL-CLOSED: an absent/unavailable freshness authority (null / undefined) holds like unknown', () => {
    for (const freshness of [null, undefined] as const) {
      const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: TWO_RUNS, freshness });
      expect(out.matched).toBe(true);
      if (!out.matched) continue;
      expect(out.mode).toBe('unconfirmed');
      expect(out.assistant_text.toLowerCase()).not.toContain('has changed');
      expect(out.suggested_actions[0].action_type).toBe('run_analysis');
    }
  });

  it('unknown freshness holds even when only one run exists (no accidental insufficient_runs downgrade)', () => {
    // The fail-closed branch precedes the run-count check, so unknown never
    // reaches the fresh-only insufficient_runs path.
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: [CURRENT], freshness: 'unknown' });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('unconfirmed');
  });

  it('does not hijack a concrete edit / value-update message', () => {
    for (const message of ['Set pricing to 0.7', 'Change marketing channel to TikTok', 'Add a new constraint']) {
      const out = tryRunComparisonGate({ message, priorFacts: TWO_RUNS, freshness: 'fresh' });
      expect(out.matched).toBe(false);
      if (out.matched) continue;
      expect(out.reason).toBe('mutation_signal');
    }
  });

  it('declines non-comparison analytical questions', () => {
    const out = tryRunComparisonGate({ message: 'Explain the results', priorFacts: TWO_RUNS, freshness: 'fresh' });
    expect(out.matched).toBe(false);
    if (out.matched) return;
    expect(out.reason).toBe('not_what_changed');
  });

  it('declines (no_runs) when there is no analysis so the no-analysis guard can own it', () => {
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: [], freshness: 'none' });
    expect(out.matched).toBe(false);
    if (out.matched) return;
    expect(out.reason).toBe('no_runs');
  });

  it('returns insufficient_runs with exactly one run', () => {
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: [CURRENT], freshness: 'fresh' });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('insufficient_runs');
    expect(out.suggested_actions).toHaveLength(0);
  });

  it('rejects an empty message', () => {
    const out = tryRunComparisonGate({ message: '   ', priorFacts: TWO_RUNS, freshness: 'fresh' });
    expect(out.matched).toBe(false);
    if (out.matched) return;
    expect(out.reason).toBe('empty_message');
  });
});
