/**
 * P1 HONESTY (ROADMAP 2.1237) — a degraded read was reported as "no analysis".
 *
 * `decideNoOpRecovery` answered "has this decision been analysed?" with a RAW
 * `priorFacts.some(...)`, and that branch sits BEFORE the ambiguous fallback.
 * So when the facts read came back degraded — empty because it FAILED, not
 * because nothing is there — the recovery took `analytical_none` and told the
 * user:
 *
 *   "I haven't changed the model. Run analysis first and I'll walk you
 *    through the result."
 *
 * That is a claim about their history, and we did not have the evidence for
 * it. Worse, the honest verdict was sitting RIGHT BESIDE the predicate in the
 * same input object: `freshness: 'unknown'`, which the freshness authority
 * emits precisely when it could not determine the answer. The recovery simply
 * did not read it.
 *
 * ⭐ THE DISTINCTION THAT MATTERS, and the reason the fix is not "suppress on
 * empty facts": `freshness: 'none'` and `freshness: 'unknown'` are DIFFERENT
 * FACTS and must not collapse. `'none'` means we looked and there is no
 * successful run — `analytical_none` is then TRUE and stays. `'unknown'`
 * means we could not look. Only the second is a lie.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { decideNoOpRecovery } from '../edit-graph-dispatch.js';

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';

function runAnalysisFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Option A leads.',
      win_probabilities: { opt_a: 0.55, opt_b: 0.45 },
      graph_hash_at_run: 'abc123',
      computed_at: '2026-05-09T10:00:00.000Z',
    },
  };
}

const ANALYTICAL = 'What drove this result?';

describe('G — a DEGRADED read must not claim the user has never analysed', () => {
  it('freshness "unknown" + empty facts does NOT take analytical_none', () => {
    const r = decideNoOpRecovery({
      message: ANALYTICAL,
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'unknown',
      graphReady: true,
    });
    // The whole defect in one assertion.
    expect(r.branch).not.toBe('analytical_none');
  });

  it('it says it CANNOT CONFIRM, and never asserts the absence', () => {
    const r = decideNoOpRecovery({
      message: ANALYTICAL,
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'unknown',
      graphReady: true,
    });
    expect(r.assistantText).not.toBeNull();
    // Bound by identity to the sentence that was the lie: the copy must not
    // instruct the user to run analysis "first", which presumes none has.
    expect(r.assistantText).not.toContain('Run analysis first');
    expect(r.assistantText!.toLowerCase()).toContain("can't confirm");
    expect(r.assistantText).toContain("haven't changed the model");
  });

  it('the honest copy still obeys the module copy contract', () => {
    const r = decideNoOpRecovery({
      message: ANALYTICAL,
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'unknown',
      graphReady: true,
    });
    expect(r.assistantText).not.toMatch(/validator|dispatcher|\bpatch\b|\bschema\b|tool\s+call/i);
    expect(r.assistantText).not.toMatch(/\bwinner|\brecommend|—/i);
    // No internal freshness vocabulary either.
    expect(r.assistantText!.toLowerCase()).not.toContain('degraded');
    expect(r.assistantText!.toLowerCase()).not.toContain('freshness');
  });

  it('offers a way forward when the graph is ready, and none when it is not', () => {
    // Mirrors `analytical_none`'s existing gating exactly: a run_analysis chip
    // that would fail on click is worse than no chip.
    const ready = decideNoOpRecovery({
      message: ANALYTICAL,
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'unknown',
      graphReady: true,
    });
    expect(ready.suggestedActions).toHaveLength(1);
    expect(ready.suggestedActions[0]?.action_type).toBe('run_analysis');

    const notReady = decideNoOpRecovery({
      message: ANALYTICAL,
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'unknown',
      graphReady: false,
    });
    expect(notReady.suggestedActions).toHaveLength(0);
  });
});

describe('G — DISCRIMINATING PAIR: the healthy paths are untouched', () => {
  it('CONTROL — freshness "none" (we LOOKED and there is none) still says analytical_none', () => {
    // ⭐ THE LOAD-BEARING CONTROL. `none` and `unknown` must not collapse: a
    // fix that suppressed on empty facts alone would take this branch out too,
    // and the product would stop telling a genuinely-new user to run their
    // first analysis. That is the opposite harm, and it is exactly the
    // one-directional trade CLAUDE.md trap 22b warns about.
    const r = decideNoOpRecovery({
      message: ANALYTICAL,
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'none',
      graphReady: true,
    });
    expect(r.branch).toBe('analytical_none');
    expect(r.assistantText).toContain('Run analysis first');
  });

  it('CONTROL — a healthy read with a real prior fact is unchanged (fresh)', () => {
    const r = decideNoOpRecovery({
      message: ANALYTICAL,
      priorFacts: [runAnalysisFact()] as readonly HandlerFact[],
      freshness: 'fresh',
      graphReady: true,
    });
    expect(r.branch).toBe('analytical_fresh');
    expect(r.has_run_analysis_fact).toBe(true);
  });

  it('CONTROL — a healthy read with a real prior fact is unchanged (stale)', () => {
    const r = decideNoOpRecovery({
      message: ANALYTICAL,
      priorFacts: [runAnalysisFact()] as readonly HandlerFact[],
      freshness: 'stale',
      graphReady: true,
    });
    expect(r.branch).toBe('analytical_stale');
  });

  it('CONTROL — freshness "unknown" WITH a real prior fact still defers to ambiguous', () => {
    // Pre-existing behaviour, deliberately preserved: we have a fact but
    // cannot prove its freshness, so the V4 copy is left alone. The fix must
    // not have swallowed this into the new branch.
    const r = decideNoOpRecovery({
      message: ANALYTICAL,
      priorFacts: [runAnalysisFact()] as readonly HandlerFact[],
      freshness: 'unknown',
      graphReady: true,
    });
    expect(r.branch).toBe('ambiguous');
    expect(r.assistantText).toBeNull();
  });

  it('CONTROL — a non-analytical message on an unknown read is untouched', () => {
    // The new branch sits inside the analytical-intent arm. A plain edit
    // request must not acquire freshness copy it never had.
    const r = decideNoOpRecovery({
      message: 'Change the hiring cost to 50000.',
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'unknown',
      graphReady: true,
    });
    expect(r.branch).not.toBe('analytical_none');
    expect(r.branch).not.toBe('analytical_indeterminate');
  });
});
