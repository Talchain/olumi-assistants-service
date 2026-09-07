/**
 * A PROSE TURN MUST SHIP THE FACT ITS OWN FIGURES CAME FROM.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT. On a substantive coach / converse turn the model is handed
 * `display_analysis` — a projection of a persisted `run_analysis` fact built by
 * `buildAnalysisFromPriorFacts` — and the served prompt tells the model to
 * QUOTE it rather than derive one (`prompts/defaults.ts`: `pre-computed — trust
 * these, do not recalculate`; `state the winner's OWN win_probability`; only
 * decimal→percentage permitted). The number is SERVER-COMPUTED and the sentence
 * is a template the model fills. The same response then shipped `blocks: []`,
 * because `composeDirectAnswerResponse` — the composer every coach / converse
 * turn uses — consults no facts and emits whatever `blocks` its caller passes,
 * and every caller passed nothing.
 *
 * So the block was not suppressed by a rule on this turn class. It was
 * STRUCTURALLY UNREACHABLE: `buildBlocksFromFacts` is reached only from
 * `composeToolCallResponse`.
 *
 * ⭐ WHAT THE FIXTURE MAKES VISIBLE, and it is sharper than "a field is
 * missing". The captured run is a NEAR TIE (`near_tie.is_tie: true`,
 * `gap: 0.0389` against a `0.1` threshold). With no block on the payload the
 * turn's `leader_claim` reads `separation_unavailable` — the producer's code
 * for **WE DID NOT LOOK**. With the block shipped it reads
 * `options_do_not_separate` + `separation: 'near_tie'` — **WE LOOKED, AND THEY
 * TIE**. Those are opposite epistemic statements, and the product was making
 * the wrong one about a run it had in fact analysed.
 *
 * THE CORPUS IS A LIVE CAPTURE, NOT A FIXTURE THIS AUTHOR WROTE: the same
 * `fixtures/analysis-result-live-2026-09-03.json` the confinement acceptance
 * suite uses, copied verbatim from a real staging run. A self-authored fixture
 * would encode this author's model of the producer rather than the producer
 * (parent CLAUDE.md trap 16-inverse), and the whole claim here is about what a
 * real run actually contains.
 *
 * ⚠ WHAT THIS SUITE DELIBERATELY DOES NOT ASSERT. It does not assert that the
 * three leader-naming authorities agree. They answer three different questions
 * and must keep answering them — #709/#737 was created by reconciling exactly
 * such defaults. It asserts only that the THIRD one ("can a consumer of THIS
 * payload verify both halves?") becomes ANSWERABLE, which is the opposite of
 * making it agree with the other two.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  WITHHELD_NEAR_TIE,
  WITHHELD_SEPARATION_UNAVAILABLE,
  composeAnalysisStateV1,
  readRawRobustnessFromResponseBody,
  separationWasEvaluated,
} from '../analysis-state-v1.js';
import { asRunAnalysisFact, buildProseGroundingBlocks } from '../prose-grounding-block.js';
import type { FreshnessDerivation } from '../../context/freshness.js';

/** See the confinement acceptance suite for why this is read from disk. */
const capture = JSON.parse(
  readFileSync(
    new URL('./fixtures/analysis-result-live-2026-09-03.json', import.meta.url),
    'utf-8',
  ),
) as {
  readonly summary: string;
  readonly leading_option_id: string;
  readonly win_probabilities: Record<string, number>;
  readonly enrichment: Record<string, unknown>;
};

const GRAPH_HASH = 'gh_live_20260903_b1run1';

/**
 * The captured run as a persisted fact. `constraint_verdict` is stamped
 * PERMITTED so the turn is genuinely ENTITLED to name a leader — without that,
 * `composeLeaderClaim` chooses the `!entitled` branch first and this suite
 * would be measuring the wrong half.
 */
function capturedFact(overrides?: { readonly enrichment?: unknown }): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      leading_option_id: capture.leading_option_id,
      summary: capture.summary,
      win_probabilities: capture.win_probabilities,
      graph_hash_at_run: GRAPH_HASH,
      computed_at: '2026-09-03T00:00:00.000Z',
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
      enrichment:
        overrides !== undefined && 'enrichment' in overrides
          ? overrides.enrichment
          : capture.enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

function freshnessOf(verdict: FreshnessDerivation['freshness']): FreshnessDerivation {
  return { freshness: verdict } as unknown as FreshnessDerivation;
}

const canonical = {
  status: 'complete',
  usableForProse: true,
  usableForChips: true,
  usableForFollowupContext: true,
  requiresRerun: false,
  blockedUnusable: false,
  contradictions: [],
  freshness: 'fresh',
} as never;

/** The turn's composed body, as `readRawRobustnessFromResponseBody` will see it. */
function bodyWith(blocks: readonly unknown[]): unknown {
  return {
    response_version: 2,
    // The sentence the routing prompt's rendering rule produces.
    assistant_text: 'It leads in 51% of simulated runs.',
    blocks,
    suggested_actions: [],
    insights: [],
  };
}

function leaderClaimFor(blocks: readonly unknown[]): Record<string, unknown> {
  const state = composeAnalysisStateV1({
    canonical,
    mayNameLeadingOption: true,
    rawRobustness: readRawRobustnessFromResponseBody(bodyWith(blocks)),
  } as never) as unknown as { leader_claim: Record<string, unknown> };
  return state.leader_claim;
}

const FRESH_INPUT = { sourceFact: capturedFact(), freshness: freshnessOf('fresh') };

describe('a prose turn ships the run fact its own figures came from', () => {
  /**
   * ── THE PRECONDITION PIN ──────────────────────────────────────────────────
   * Without this the section below is a tautology: every assertion about the
   * fix "closing" something is only meaningful if the defect is reproduced
   * here, on this fixture, in this run.
   */
  describe('PRECONDITION — the defect is reproduced on this payload', () => {
    it('the pristine turn shipped no block, so the claim says WE DID NOT LOOK', () => {
      const claim = leaderClaimFor([]);
      expect(claim.permitted).toBe(false);
      expect(claim.withheld_reason).toBe(WITHHELD_SEPARATION_UNAVAILABLE);
      // ABSENCE IS DISTINCT — no separation statement was computed at all.
      expect('separation' in claim).toBe(false);
      expect(separationWasEvaluated(claim)).toBe(false);
    });

    it('POSITIVE CONTROL — the reader can see a separation when one is present', () => {
      expect(readRawRobustnessFromResponseBody(bodyWith([]))).toBeNull();
      expect(
        readRawRobustnessFromResponseBody(bodyWith(buildProseGroundingBlocks(FRESH_INPUT))),
      ).not.toBeNull();
    });

    it('the captured run really is a near tie — the fixture can discriminate', () => {
      // Binds by IDENTITY to the captured values, not to a value predicate some
      // other run could satisfy. If the capture is ever replaced by one that is
      // not a near tie, this REDs rather than quietly proving something else.
      const robustness = (capture.enrichment as { robustness: Record<string, unknown> })
        .robustness;
      expect((robustness.near_tie as { is_tie: boolean }).is_tie).toBe(true);
      expect(robustness.level).toBe('very_low');
    });
  });

  /**
   * ── THE FIX ───────────────────────────────────────────────────────────────
   */
  describe('the third question becomes ANSWERABLE', () => {
    it('shipping the block turns "we did not look" into "we looked, and they tie"', () => {
      const claim = leaderClaimFor(buildProseGroundingBlocks(FRESH_INPUT));

      // The verdict is still NOT permitted — the options genuinely do not
      // separate. The fix does not manufacture a permission; it replaces an
      // absence of evidence with the evidence.
      expect(claim.permitted).toBe(false);
      expect(claim.withheld_reason).toBe(WITHHELD_NEAR_TIE);
      expect(claim.separation).toBe('near_tie');
      expect(separationWasEvaluated(claim)).toBe(true);
    });

    it('the shipped block carries the win probabilities the prose quoted', () => {
      const blocks = buildProseGroundingBlocks(FRESH_INPUT) as readonly Record<
        string,
        unknown
      >[];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe('analysis_result');
      // IDENTITY binding: the captured leading option and its captured
      // probability, not "some numeric field is present".
      expect(blocks[0]!.win_probabilities).toEqual(capture.win_probabilities);
      expect(blocks[0]!.leading_option_id).toBe(capture.leading_option_id);
    });
  });

  /**
   * ── THE DISCRIMINATING PAIR ───────────────────────────────────────────────
   * One direction alone proves nothing: a rule that always ships would pass the
   * section above and fabricate a block on a turn that analysed nothing.
   */
  describe('DISCRIMINATION — it does not over-ship', () => {
    it('a turn with NO run fact ships no block, and gains no fabricated one', () => {
      expect(
        buildProseGroundingBlocks({ sourceFact: null, freshness: freshnessOf('fresh') }),
      ).toEqual([]);
    });

    it('a turn with a fact ships exactly one — the pair, in one run', () => {
      expect(
        buildProseGroundingBlocks({ sourceFact: null, freshness: freshnessOf('fresh') }),
      ).toHaveLength(0);
      expect(buildProseGroundingBlocks(FRESH_INPUT)).toHaveLength(1);
    });

    it('no fact ⇒ the claim still reads NOT EVALUATED, never a fabricated tie', () => {
      const claim = leaderClaimFor(
        buildProseGroundingBlocks({ sourceFact: null, freshness: freshnessOf('fresh') }),
      );
      expect(claim.withheld_reason).toBe(WITHHELD_SEPARATION_UNAVAILABLE);
      expect('separation' in claim).toBe(false);
    });
  });

  /**
   * ── THE RATIFIED SUPPRESSION, PRESERVED ───────────────────────────────────
   * `buildLifecycleBlocksFromPrior` already rules that a prior analysis may be
   * re-presented as a structured result on FRESH only. This helper states the
   * same rule, so the two prior-fact surfaces cannot drift apart.
   */
  describe('non-fresh verdicts suppress the block, exactly as the prior-fact path does', () => {
    it.each(['stale', 'unknown', 'none'] as const)(
      '%s ships no block',
      (verdict) => {
        expect(
          buildProseGroundingBlocks({
            sourceFact: capturedFact(),
            freshness: freshnessOf(verdict),
          }),
        ).toEqual([]);
      },
    );

    it('an ABSENT derivation fails closed, matching the flip-point licence', () => {
      expect(
        buildProseGroundingBlocks({ sourceFact: capturedFact(), freshness: null }),
      ).toEqual([]);
    });
  });

  /**
   * ── NO FABRICATION WHEN THE FACT IS THIN ──────────────────────────────────
   * `enrichment.robustness` is genuinely nullable: `pickLatestRawRobustness`
   * has three null exits. The fix must ship what the fact supports and claim
   * nothing more.
   */
  describe('a fact carrying no robustness produces no separation claim', () => {
    it.each([
      ['no enrichment object at all', undefined],
      ['enrichment present, robustness absent', { option_comparison: [] }],
      ['robustness present but empty of signals', { robustness: {} }],
      ['robustness with a blank level and no tie', { robustness: { level: '   ' } }],
    ])('%s → block ships, claim stays NOT EVALUATED', (_label, enrichment) => {
      const blocks = buildProseGroundingBlocks({
        sourceFact: capturedFact({ enrichment }),
        freshness: freshnessOf('fresh'),
      });
      // The block still ships — it is a statement about the analysis result,
      // not about robustness.
      expect(blocks).toHaveLength(1);
      // …but nothing is invented about separation.
      const claim = leaderClaimFor(blocks);
      expect(claim.withheld_reason).toBe(WITHHELD_SEPARATION_UNAVAILABLE);
      expect(separationWasEvaluated(claim)).toBe(false);
    });
  });

  describe('asRunAnalysisFact narrows by the discriminant, not by shape', () => {
    it('passes a run_analysis fact through and rejects every other fact type', () => {
      const fact = capturedFact();
      expect(asRunAnalysisFact(fact)).toBe(fact);
      expect(asRunAnalysisFact(null)).toBeNull();
      expect(asRunAnalysisFact(undefined)).toBeNull();
      // A fact carrying an identical-looking `result` but a different
      // discriminant must NOT be admitted — binding by identity, not by shape.
      expect(
        asRunAnalysisFact({
          ...(fact as unknown as Record<string, unknown>),
          fact_type: 'set_factor_value',
        } as never),
      ).toBeNull();
    });
  });
});
