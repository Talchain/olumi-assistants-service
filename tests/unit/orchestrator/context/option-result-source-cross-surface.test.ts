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
  selectDeclaredWinner,
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

});

// ============================================================================
// Round-5 (Doctrine D-W) — FULL winner-consistency MATRIX. Under D-W EVERY
// surface honours the DECLARED winner (leading_option_id) when it carries a
// usable win_probability, else the highest-usable option. So on EVERY cell of
// {thin-current, both-present-conflicting} × {leader=highest, leader=OTHER,
// leader=null}, ALL FOUR surfaces (enricher, headline, compact, state) name the
// SAME option + probability.
//
// RED pre-round-5: on the leader=OTHER cells, compact + state named the
// highest-probability option (opt-a) while the enricher/headline named the
// declared leader (opt-b) — a cross-surface identity split. Now they all name
// the leader.
// ============================================================================

// THIN-CURRENT: option_comparison carries id/label but NO win_probability;
// results[] carries it. Walked-to source for every selector = results[].
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

const LABEL_OF: Record<string, string> = { 'opt-a': 'Option A', 'opt-b': 'Option B' };

interface MatrixCell {
  readonly name: string;
  readonly envelope: () => Record<string, unknown>;
  readonly leader: string | null;
  // Under D-W ALL FOUR surfaces name this option + probability.
  readonly winnerId: string;
  readonly winnerProb: number;
}

const MATRIX: readonly MatrixCell[] = [
  // Thin-current (walked source = results; highest = opt-a @ 0.66).
  { name: 'thin-current, leader=highest (opt-a)', envelope: thinCurrentEnvelope, leader: 'opt-a', winnerId: 'opt-a', winnerProb: 0.66 },
  { name: 'thin-current, leader=OTHER (opt-b)', envelope: thinCurrentEnvelope, leader: 'opt-b', winnerId: 'opt-b', winnerProb: 0.34 },
  { name: 'thin-current, leader=null', envelope: thinCurrentEnvelope, leader: null, winnerId: 'opt-a', winnerProb: 0.66 },
  // Both-present-conflicting (walked source = current option_comparison; highest = opt-a @ 0.72).
  { name: 'both-conflicting, leader=highest (opt-a)', envelope: conflictingEnvelope, leader: 'opt-a', winnerId: 'opt-a', winnerProb: 0.72 },
  { name: 'both-conflicting, leader=OTHER (opt-b)', envelope: conflictingEnvelope, leader: 'opt-b', winnerId: 'opt-b', winnerProb: 0.28 },
  { name: 'both-conflicting, leader=null', envelope: conflictingEnvelope, leader: null, winnerId: 'opt-a', winnerProb: 0.72 },
];

describe('D-W — winner-consistency matrix (ALL FOUR surfaces name the declared winner)', () => {
  for (const cell of MATRIX) {
    it(cell.name, () => {
      const env = cell.envelope();

      // 1. enricher (already leader-aware). Never a phantom 0% winner.
      const invoke = buildInvokeInputForTests('We must decide on pricing.', env, cell.leader);
      expect(invoke).not.toBeNull();
      expect(invoke!.winner.id).toBe(cell.winnerId);
      expect(invoke!.winner.win_probability).toBe(cell.winnerProb);
      expect(invoke!.winner.win_probability).toBeGreaterThan(0);

      // 2. headline (already leader-aware): names the SAME option.
      const headline = buildAnalysisResultHeadline({
        enrichment: env,
        leading_option_id: cell.leader ?? '',
        status_kind: 'ok',
      });
      expect(headline).not.toBeNull();
      expect(headline!.startsWith(LABEL_OF[cell.winnerId]!)).toBe(true);

      // 3. compact — NOW leader-aware (D-W). RED pre-round-5 on leader=OTHER
      //    (named the highest-probability opt-a instead of the declared opt-b).
      const compact = compactAnalysis(env as unknown as V2RunResponseEnvelope, undefined, cell.leader);
      expect(compact).not.toBeNull();
      expect(compact!.winner.option_id).toBe(cell.winnerId);
      expect(compact!.winner.win_probability).toBe(cell.winnerProb);

      // 4. state — NOW leader-aware (D-W). Its candidate source carries the
      //    declared winner, and the shared selector names it.
      const stateWinner = selectDeclaredWinner(env, cell.leader);
      expect(stateWinner).not.toBeNull();
      expect(stateWinner!.optionId).toBe(cell.winnerId);
      expect(stateWinner!.winProbability).toBe(cell.winnerProb);
      const candidates = getOptionResultCandidates(env as unknown as V2RunResponseEnvelope, cell.leader);
      const winnerEntry = candidates.find(
        (c) => (c as Record<string, unknown>).option_id === cell.winnerId,
      ) as Record<string, unknown>;
      expect(winnerEntry).toBeDefined();
      expect(winnerEntry.win_probability).toBe(cell.winnerProb);

      // All four coincide EXACTLY (identity + probability) — the D-W invariant.
      expect(compact!.winner.option_id).toBe(invoke!.winner.id);
      expect(compact!.winner.win_probability).toBe(invoke!.winner.win_probability);
      expect(stateWinner!.optionId).toBe(invoke!.winner.id);
    });
  }
});
