/**
 * Lane A — ONE shared status-aware option selector.
 *
 * PR #582 gated CEE's DIRECT-receipt leader (`selectLeadingOptionId` in
 * run-analysis.ts) on the per-option ISL `status`, delegating to the single
 * `isRecommendableOption` predicate. Codex #4 found THREE further,
 * status-BLIND winner/runner-up selectors that never saw that predicate, so
 * the coaching context the LLM reads could still crown a FAILED option even
 * while the user-facing fact (the direct receipt) correctly did not:
 *
 *   1. analysis-compact.ts   `compactAnalysis`  — sorts by win_probability and
 *      crowns the top, status-blind; feeds `summary.winner` + `margin`.
 *   2. context-pack-assembler.ts `projectAnalysis` — re-selects leading/runner
 *      -up, but `OptionSummary` DROPPED `status` upstream so it structurally
 *      COULD NOT gate on it.
 *   3. decision-review-enricher.ts `selectWinner`/`selectRunnerUp` — gate on a
 *      usable win_probability but never on status.
 *
 * Codex's exact repro: option B (`status:'error'`, win 0.90) versus option A
 * (`status:'computed'`, win 0.40). Every path must select A, never the failed
 * B — mirroring the #582 direct receipt.
 *
 * These paths all now route their status eligibility through the ONE existing
 * `isRecommendableOption` predicate (imported, never re-minted — the recorded
 * twin-defect class). This suite is the RED-first repro + the all-computed
 * golden (byte-identical outputs when nothing is errored).
 */

import { describe, it, expect } from 'vitest';

import { compactAnalysis } from '../../../../orchestrator/context/analysis-compact.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { projectAnalysis } from '../../../context/context-pack-assembler.js';
import type { AnalysisResponseSummaryWithSignals } from '../../../context/analysis-signals.js';
import { buildInvokeInputForTests } from '../../../coaching/decision-review-enricher.js';

// --- Codex #4 repro: a FAILED option carries the top win_probability --------
// B (error, 0.90) must never beat A (computed, 0.40). C (computed, 0.30) is the
// legitimate runner-up so `margin` has a recommendable second place to measure.
function reproEnvelope(): V2RunResponseEnvelope {
  return {
    analysis_status: 'ok',
    option_comparison: [
      { option_id: 'A', option_label: 'Option A', win_probability: 0.4, status: 'computed', outcome_mean: 10 },
      { option_id: 'B', option_label: 'Option B', win_probability: 0.9, status: 'error', outcome_mean: 20 },
      { option_id: 'C', option_label: 'Option C', win_probability: 0.3, status: 'computed', outcome_mean: 5 },
    ],
  } as unknown as V2RunResponseEnvelope;
}

// All-computed control: identical shape, B is now computed. Nothing is filtered
// out, so every selector must behave EXACTLY as it did before the status gate.
function allComputedEnvelope(): V2RunResponseEnvelope {
  return {
    analysis_status: 'ok',
    option_comparison: [
      { option_id: 'A', option_label: 'Option A', win_probability: 0.4, status: 'computed', outcome_mean: 10 },
      { option_id: 'B', option_label: 'Option B', win_probability: 0.9, status: 'computed', outcome_mean: 20 },
      { option_id: 'C', option_label: 'Option C', win_probability: 0.3, status: 'computed', outcome_mean: 5 },
    ],
  } as unknown as V2RunResponseEnvelope;
}

// Legacy shape: NO per-option status at all. Absent status is recommendable, so
// this must also behave exactly as the pre-gate code did (highest wins).
function statuslessEnvelope(): V2RunResponseEnvelope {
  return {
    analysis_status: 'ok',
    option_comparison: [
      { option_id: 'A', option_label: 'Option A', win_probability: 0.4, outcome_mean: 10 },
      { option_id: 'B', option_label: 'Option B', win_probability: 0.9, outcome_mean: 20 },
      { option_id: 'C', option_label: 'Option C', win_probability: 0.3, outcome_mean: 5 },
    ],
  } as unknown as V2RunResponseEnvelope;
}

describe('shared status-aware winner — site 1: compactAnalysis', () => {
  it('does NOT crown a failed option even when it carries the top win_probability', () => {
    const summary = compactAnalysis(reproEnvelope());
    expect(summary).not.toBeNull();
    expect(summary!.winner.option_id).toBe('A');
    expect(summary!.winner.win_probability).toBe(0.4);
  });

  it('measures margin against the recommendable runner-up, not the failed option', () => {
    const summary = compactAnalysis(reproEnvelope());
    // A (0.40) over C (0.30) — B (0.90, error) is excluded from the margin.
    expect(summary!.margin).toBeCloseTo(0.1, 10);
  });

  it('retains per-option status on OptionSummary (additive projection field)', () => {
    const summary = compactAnalysis(reproEnvelope());
    const b = summary!.options.find((o) => o.option_id === 'B');
    expect(b?.status).toBe('error');
    const a = summary!.options.find((o) => o.option_id === 'A');
    expect(a?.status).toBe('computed');
  });

  it('GOLDEN — all-computed set is unchanged: highest win_probability wins', () => {
    const summary = compactAnalysis(allComputedEnvelope());
    expect(summary!.winner.option_id).toBe('B');
    expect(summary!.margin).toBeCloseTo(0.5, 10); // B 0.90 - A 0.40
  });

  it('GOLDEN — status-less legacy shape is unchanged: highest win_probability wins', () => {
    const summary = compactAnalysis(statuslessEnvelope());
    expect(summary!.winner.option_id).toBe('B');
  });
});

describe('shared status-aware winner — site 2: projectAnalysis (context pack)', () => {
  it('does NOT surface a failed option as the leading coaching option', () => {
    const summary = compactAnalysis(reproEnvelope()) as AnalysisResponseSummaryWithSignals;
    const pack = projectAnalysis(summary, null);
    expect(pack).not.toBeNull();
    expect(pack!.leading_option?.label).toBe('Option A');
    expect(pack!.runner_up?.label).toBe('Option C');
  });

  it('GOLDEN — all-computed set is unchanged: highest win_probability leads', () => {
    const summary = compactAnalysis(allComputedEnvelope()) as AnalysisResponseSummaryWithSignals;
    const pack = projectAnalysis(summary, null);
    expect(pack!.leading_option?.label).toBe('Option B');
  });
});

describe('shared status-aware winner — site 3: decision-review enricher', () => {
  it('null leader — picks the highest RECOMMENDABLE option, not the failed top', () => {
    const input = buildInvokeInputForTests('brief', reproEnvelope() as unknown as Record<string, unknown>, null);
    expect(input).not.toBeNull();
    expect(input!.winner.id).toBe('A');
    expect(input!.runner_up?.id).toBe('C');
  });

  it('declared recommendable leader is honoured', () => {
    const input = buildInvokeInputForTests('brief', reproEnvelope() as unknown as Record<string, unknown>, 'A');
    expect(input!.winner.id).toBe('A');
  });

  it('a FAILED option declared as leader is never crowned (honest no_winner)', () => {
    const input = buildInvokeInputForTests('brief', reproEnvelope() as unknown as Record<string, unknown>, 'B');
    expect(input).toBeNull();
  });

  it('GOLDEN — all-computed set is unchanged: highest win_probability wins', () => {
    const input = buildInvokeInputForTests('brief', allComputedEnvelope() as unknown as Record<string, unknown>, null);
    expect(input!.winner.id).toBe('B');
    expect(input!.runner_up?.id).toBe('A');
  });
});
