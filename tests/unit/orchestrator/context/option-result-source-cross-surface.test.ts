/**
 * M1 (Codex r2 pre-merge review) — cross-surface winner agreement.
 *
 * Winner derivation was duplicated across FOUR surfaces, each re-implementing
 * source precedence. The decompose-hardening PR flipped only two to
 * current-first (the decision-review enricher + analysis-result-headline),
 * leaving analysis-compact.getResultsArray and analysis-state
 * .getOptionResultCandidates LEGACY-first. On a both-present-conflicting
 * envelope that split the winner: review/headline named the current leader
 * while the coach context-pack / explanations / chips named the stale legacy
 * one.
 *
 * RED-first: against the pre-fix code compactAnalysis + getOptionResultCandidates
 * read the legacy `results` array (where Option B leads at 0.59), so they named
 * Option B while the enricher/headline named Option A. These assertions pin all
 * four surfaces to the SAME current-first winner (Option A, 0.72) via the
 * single shared source reader.
 */

import { describe, it, expect } from 'vitest';

import {
  readOptionResultSources,
  winnerOptionResultSource,
} from '../../../../src/orchestrator/context/option-result-source.js';
import { compactAnalysis } from '../../../../src/orchestrator/context/analysis-compact.js';
import { getOptionResultCandidates } from '../../../../src/orchestrator/analysis-state.js';
import { buildInvokeInputForTests } from '../../../../src/orchestrator-v5/coaching/decision-review-enricher.js';
import { buildAnalysisResultHeadline } from '../../../../src/orchestrator-v5/coaching/analysis-result-headline.js';
import type { V2RunResponseEnvelope } from '../../../../src/orchestrator/types.js';

// A both-present-conflicting envelope: the CURRENT `option_comparison` crowns
// Option A (0.72); the STALE legacy `results` copy crowns Option B (0.59).
// PLoT declares Option A the leader (`leading_option_id`).
function conflictingEnvelope(): Record<string, unknown> {
  return {
    leading_option_id: 'opt-a',
    option_comparison: [
      { option_id: 'opt-a', option_label: 'Option A', win_probability: 0.72, outcome: { mean: 100 } },
      { option_id: 'opt-b', option_label: 'Option B', win_probability: 0.28, outcome: { mean: 90 } },
    ],
    results: [
      { option_id: 'opt-a', option_label: 'Option A', win_probability: 0.41, outcome: { mean: 100 } },
      { option_id: 'opt-b', option_label: 'Option B', win_probability: 0.59, outcome: { mean: 90 } },
    ],
  };
}

/** Highest-win_probability option_id in a candidate array (the derived winner). */
function winnerOf(candidates: ReadonlyArray<unknown>): string | null {
  let best: string | null = null;
  let bestProb = -Infinity;
  for (const raw of candidates) {
    const r = raw as Record<string, unknown>;
    const p = typeof r.win_probability === 'number' ? r.win_probability : null;
    const id = typeof r.option_id === 'string' ? r.option_id : null;
    if (p !== null && id !== null && p > bestProb) {
      best = id;
      bestProb = p;
    }
  }
  return best;
}

describe('M1 — single-sourced current-first winner across all four surfaces', () => {
  it('the shared reader returns the CURRENT option_comparison first', () => {
    const sources = readOptionResultSources(conflictingEnvelope());
    expect(sources.length).toBe(2);
    // sources[0] is the current option_comparison (Option A at 0.72).
    expect(sources[0]![0]!.win_probability).toBe(0.72);
    // Both sources carry win_probability, so the walking winner source is the
    // current option_comparison (fresh beats stale).
    expect(winnerOptionResultSource(conflictingEnvelope())[0]!.win_probability).toBe(0.72);
  });

  it('all four surfaces name Option A (current), never the stale legacy Option B', () => {
    const env = conflictingEnvelope();

    // 1. analysis-compact.getResultsArray → compactAnalysis winner.
    const compact = compactAnalysis(env as unknown as V2RunResponseEnvelope);
    expect(compact).not.toBeNull();
    expect(compact!.winner.option_id).toBe('opt-a');
    expect(compact!.winner.win_probability).toBe(0.72);

    // 2. analysis-state.getOptionResultCandidates → derived winner.
    const candidates = getOptionResultCandidates(env as unknown as V2RunResponseEnvelope);
    expect(winnerOf(candidates)).toBe('opt-a');
    // The candidate array is the CURRENT one (Option A carries 0.72, not 0.41).
    const optA = candidates.find((c) => (c as Record<string, unknown>).option_id === 'opt-a') as Record<string, unknown>;
    expect(optA.win_probability).toBe(0.72);

    // 3. decision-review enricher.buildInvokeInput winner.
    const invoke = buildInvokeInputForTests('We must decide on pricing.', env, 'opt-a');
    expect(invoke).not.toBeNull();
    expect(invoke!.winner.id).toBe('opt-a');
    expect(invoke!.winner.win_probability).toBe(0.72);

    // 4. analysis-result-headline.resolveWinner (via the deterministic headline).
    const headline = buildAnalysisResultHeadline({
      enrichment: env,
      leading_option_id: 'opt-a',
      status_kind: 'ok',
    });
    expect(headline).not.toBeNull();
    expect(headline!.startsWith('Option A')).toBe(true);
    expect(headline!.startsWith('Option B')).toBe(false);
  });

  // Round-3 MAJOR-1: a THIN-CURRENT envelope. The current `option_comparison`
  // has entries with id/label but NO win_probability, while the legacy
  // `results` carries it. All four winner surfaces must WALK past the thin
  // current source and land on results[] (Option A, 0.66) — a plain
  // first-non-empty read kept the thin source and coerced compact/state to a 0%
  // winner (the exact M1-target envelope class the earlier fixup regressed).
  function thinCurrentEnvelope(): Record<string, unknown> {
    return {
      option_comparison: [
        { option_id: 'opt-a', option_label: 'Option A' },
        { option_id: 'opt-b', option_label: 'Option B' },
      ],
      results: [
        { option_id: 'opt-a', option_label: 'Option A', win_probability: 0.66, outcome: { mean: 100 } },
        { option_id: 'opt-b', option_label: 'Option B', win_probability: 0.34, outcome: { mean: 90 } },
      ],
    };
  }

  it('thin-current: the shared winner source WALKS to results[] (0.66), not the thin option_comparison', () => {
    const src = winnerOptionResultSource(thinCurrentEnvelope());
    expect(winnerOf(src)).toBe('opt-a');
    const optA = src.find((c) => c.option_id === 'opt-a') as Record<string, unknown>;
    expect(optA.win_probability).toBe(0.66);
  });

  it('thin-current: all four surfaces name results[] Option A at 0.66 (compact + state must not regress to 0%)', () => {
    const env = thinCurrentEnvelope();

    // 1. analysis-compact — pre-fix kept the thin option_comparison and emitted
    //    a 0% winner; must now walk to results[] (0.66).
    const compact = compactAnalysis(env as unknown as V2RunResponseEnvelope);
    expect(compact).not.toBeNull();
    expect(compact!.winner.option_id).toBe('opt-a');
    expect(compact!.winner.win_probability).toBe(0.66);

    // 2. analysis-state — pre-fix returned the thin source (no usable winner).
    const candidates = getOptionResultCandidates(env as unknown as V2RunResponseEnvelope);
    expect(winnerOf(candidates)).toBe('opt-a');
    const optA = candidates.find((c) => (c as Record<string, unknown>).option_id === 'opt-a') as Record<string, unknown>;
    expect(optA.win_probability).toBe(0.66);

    // 3. decision-review enricher (already walked — regression guard).
    const invoke = buildInvokeInputForTests('brief', env, null);
    expect(invoke).not.toBeNull();
    expect(invoke!.winner.id).toBe('opt-a');
    expect(invoke!.winner.win_probability).toBe(0.66);

    // 4. analysis-result-headline (already walked — regression guard).
    const headline = buildAnalysisResultHeadline({
      enrichment: env,
      leading_option_id: '',
      status_kind: 'ok',
    });
    expect(headline).not.toBeNull();
    expect(headline!.startsWith('Option A')).toBe(true);
  });
});
