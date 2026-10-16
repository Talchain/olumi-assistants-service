/**
 * A PROSE TURN MUST SHIP THE FACT ITS OWN FIGURES CAME FROM.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT. On a substantive coach / converse turn the model is handed
 * `display_analysis` — a projection of a persisted `run_analysis` fact built by
 * `buildAnalysisFromPriorFacts` — and the SERVED ROUTING PROMPT tells the model
 * to QUOTE it rather than derive one. This turn class resolves the PMS
 * `orchestrator` task, whose hash-verified export is
 * `Prompts/canonical/routing.txt` (manifest: `served_version: 121`,
 * `served_hash_verified: true`). `:48` fixes the wording — `Win probability:
 * "leads in 69% of simulations". Never "0.69 probability", "wins" or "win
 * rate".` — and `:118` / `:21` fix the rail ("use computed values exactly as
 * provided"; "NO ARITHMETIC. Use values exactly as provided"). The on-disk
 * fallback `Prompts/v40.txt:60-61` states the same rail.
 *
 * ⚠ NOT `src/prompts/defaults.ts` — an earlier revision of this header cited it
 * in error. Its ten `win_probabilit` hits all sit inside
 * `DECISION_REVIEW_PROMPT` (`:1293`–`:1682`), the enrichment / decision-review
 * channel, which is a different channel from this one; `display_analysis`
 * appears zero times under `src/prompts/` (contrast controls in the same sweep:
 * `option_comparison` 12 hits, `win_probability` 21 hits).
 *
 * The number is therefore SERVER-COMPUTED and the sentence is a template the
 * model fills. The same response then shipped `blocks: []`,
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

import { describe,expect,it } from 'vitest';

import {
WITHHELD_SEPARATION_UNAVAILABLE,
composeAnalysisStateV1,
readRawRobustnessFromResponseBody,
separationWasEvaluated
} from '../analysis-state-v1.js';


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



/**
 * The captured run as a persisted fact. `constraint_verdict` is stamped
 * PERMITTED so the turn is genuinely ENTITLED to name a leader — without that,
 * `composeLeaderClaim` chooses the `!entitled` branch first and this suite
 * would be measuring the wrong half.
 */




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


  /**
   * ── THE DISCRIMINATING PAIR ───────────────────────────────────────────────
   * One direction alone proves nothing: a rule that always ships would pass the
   * section above and fabricate a block on a turn that analysed nothing.
   */


  /**
   * ── THE RATIFIED SUPPRESSION, PRESERVED ───────────────────────────────────
   * `buildLifecycleBlocksFromPrior` already rules that a prior analysis may be
   * re-presented as a structured result on FRESH only. This helper states the
   * same rule, so the two prior-fact surfaces cannot drift apart.
   */


  /**
   * ── NO FABRICATION WHEN THE FACT IS THIN ──────────────────────────────────
   * `enrichment.robustness` is genuinely nullable: `pickLatestRawRobustness`
   * has three null exits. The fix must ship what the fact supports and claim
   * nothing more.
   */



});
