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

});

// ============================================================================
// Round-4 MAJOR-A — FULL winner-consistency MATRIX across all four selectors.
//
// {thin-current, both-present-conflicting} × {leader=highest, leader=OTHER,
// leader=null}. Every selector WALKS past a source without a usable
// win_probability (shared predicate), so NONE emits a phantom 0% winner. The
// leader-honouring pair (enricher + headline) name the declared leader with its
// REAL probability from the walked-to source; the highest-probability pair
// (compact + state) name the highest option — coinciding when leader=highest or
// leader=null. RED pre-fix: the enricher's leader-present branch broke at the
// thin source[0] and emitted the leader @ 0% (production path), disagreeing with
// the walking headline/compact/state.
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
  // enricher + headline (leader-honouring) expectations.
  readonly leaderWinnerId: string;
  readonly leaderWinnerProb: number;
  // compact + state (highest-probability) expectations.
  readonly highestWinnerId: string;
  readonly highestWinnerProb: number;
  /**
   * Doctrine D-W (ROADMAP 2.52): the DECLARED leader trails the raw-odds
   * argmax by a NON-marginal gap (> 10pp), so `buildAnalysisResultHeadline`
   * suppresses the user-facing one-liner to the neutral locked-template floor
   * (null) rather than assert a false "currently leads" for an option that is
   * behind on raw odds. The enricher (coaching context) still names the
   * declared leader; only the user-facing headline goes silent. See the D-W
   * builder test in analysis-result-headline.test.ts ("leader trails by a
   * NON-marginal gap → neutral floor"). Absent ⇒ headline names the leader.
   */
  readonly headlineNeutralFloor?: boolean;
}

const MATRIX: readonly MatrixCell[] = [
  // Thin-current (walked source = results; highest = opt-a @ 0.66).
  { name: 'thin-current, leader=highest (opt-a)', envelope: thinCurrentEnvelope, leader: 'opt-a',
    leaderWinnerId: 'opt-a', leaderWinnerProb: 0.66, highestWinnerId: 'opt-a', highestWinnerProb: 0.66 },
  { name: 'thin-current, leader=OTHER (opt-b)', envelope: thinCurrentEnvelope, leader: 'opt-b',
    leaderWinnerId: 'opt-b', leaderWinnerProb: 0.34, highestWinnerId: 'opt-a', highestWinnerProb: 0.66,
    // opt-b @ 0.34 trails the opt-a argmax @ 0.66 by 32pp (non-marginal) → D-W floor.
    headlineNeutralFloor: true },
  { name: 'thin-current, leader=null', envelope: thinCurrentEnvelope, leader: null,
    leaderWinnerId: 'opt-a', leaderWinnerProb: 0.66, highestWinnerId: 'opt-a', highestWinnerProb: 0.66 },
  // Both-present-conflicting (walked source = current option_comparison; highest = opt-a @ 0.72).
  { name: 'both-conflicting, leader=highest (opt-a)', envelope: conflictingEnvelope, leader: 'opt-a',
    leaderWinnerId: 'opt-a', leaderWinnerProb: 0.72, highestWinnerId: 'opt-a', highestWinnerProb: 0.72 },
  { name: 'both-conflicting, leader=OTHER (opt-b)', envelope: conflictingEnvelope, leader: 'opt-b',
    leaderWinnerId: 'opt-b', leaderWinnerProb: 0.28, highestWinnerId: 'opt-a', highestWinnerProb: 0.72,
    // opt-b @ 0.28 trails the opt-a argmax @ 0.72 by 44pp (non-marginal) → D-W floor.
    headlineNeutralFloor: true },
  { name: 'both-conflicting, leader=null', envelope: conflictingEnvelope, leader: null,
    leaderWinnerId: 'opt-a', leaderWinnerProb: 0.72, highestWinnerId: 'opt-a', highestWinnerProb: 0.72 },
];

describe('MAJOR-A — winner-consistency matrix (no phantom 0%, no cross-selector divergence)', () => {
  for (const cell of MATRIX) {
    it(cell.name, () => {
      const env = cell.envelope();

      // enricher (leader-honouring, production path). RED pre-fix on the
      // thin-current leader-present cells: winner @ 0% instead of the real prob.
      const invoke = buildInvokeInputForTests('We must decide on pricing.', env, cell.leader);
      expect(invoke).not.toBeNull();
      expect(invoke!.winner.id).toBe(cell.leaderWinnerId);
      expect(invoke!.winner.win_probability).toBe(cell.leaderWinnerProb);
      expect(invoke!.winner.win_probability).toBeGreaterThan(0); // never a phantom winner

      // headline (leader-honouring): names the SAME option as the enricher —
      // EXCEPT where Doctrine D-W (ROADMAP 2.52) suppresses it. When the
      // declared leader trails the raw-odds argmax by a NON-marginal gap
      // (> 10pp), the user-facing headline must NOT claim the trailing option
      // "currently leads"; it falls to the neutral locked-template floor
      // (null). The enricher above still names the declared leader for the
      // coaching context — only the user-facing headline goes silent. (Ratified
      // + covered by the D-W builder test in analysis-result-headline.test.ts,
      // "leader trails by a NON-marginal gap → neutral floor".)
      const headline = buildAnalysisResultHeadline({
        enrichment: env,
        leading_option_id: cell.leader ?? '',
        status_kind: 'ok',
      });
      if (cell.headlineNeutralFloor) {
        expect(headline).toBeNull();
      } else {
        expect(headline).not.toBeNull();
        expect(headline!.startsWith(LABEL_OF[cell.leaderWinnerId]!)).toBe(true);
      }

      // compact (highest-probability): real prob, never phantom 0%.
      const compact = compactAnalysis(env as unknown as V2RunResponseEnvelope);
      expect(compact).not.toBeNull();
      expect(compact!.winner.option_id).toBe(cell.highestWinnerId);
      expect(compact!.winner.win_probability).toBe(cell.highestWinnerProb);

      // state (highest-probability): its candidate source is the walked-to one.
      const candidates = getOptionResultCandidates(env as unknown as V2RunResponseEnvelope);
      expect(winnerOf(candidates)).toBe(cell.highestWinnerId);
      const highestEntry = candidates.find(
        (c) => (c as Record<string, unknown>).option_id === cell.highestWinnerId,
      ) as Record<string, unknown>;
      expect(highestEntry.win_probability).toBe(cell.highestWinnerProb);

      // When the leader IS the highest (or absent), all four coincide exactly.
      if (cell.leaderWinnerId === cell.highestWinnerId) {
        expect(invoke!.winner.id).toBe(compact!.winner.option_id);
        expect(invoke!.winner.win_probability).toBe(compact!.winner.win_probability);
      }
    });
  }
});
