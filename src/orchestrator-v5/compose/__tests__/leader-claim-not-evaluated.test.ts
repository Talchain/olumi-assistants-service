/**
 * S6 — `separation_unavailable` means NOT EVALUATED, not WITHHELD.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WIRE-WITNESSED DEFECT (two turns, quartet UI `cf61337c` · CEE `5f2e3fd` ·
 * PLoT `3a3bee5` · ISL `28fe0c9`, stale route `complete_stale / graph_changed`):
 *
 *   leader_claim: { permitted: false, withheld_reason: "separation_unavailable" }
 *   claim_safety.may_name_leading_option: true
 *   …while the prose named the leader: "the positioning lead".
 *
 * ⭐ THIS IS NOT #709/#737 REOPENED. Those two disagreed because one answered
 * "did this run's verdict withhold?" and the other "may this turn name a
 * leader on screen?". FOUR authorities now exist over "may we name the leading
 * option", and the ones in tonight's capture are A1 and A2 below.
 *
 *   A1  claim_safety.may_name_leading_option   (context/claim-safety-read.ts)
 *       Q: "Is this turn ENTITLED to name a leader?"  Constraint-verdict
 *       derived, persisted per-fact, fail-closed on read.
 *       ⚠ Rides the FLAG-GATED `_diagnostic_trace`, not the product contract.
 *
 *   A2  leader_claim.permitted                 (this module)
 *       Q: "Are BOTH halves PROVABLE ON THIS PAYLOAD?"  = entitled ∧ separates.
 *       Fail-CLOSED when the separation half is unreadable.
 *
 *   A3  UI canvas/state/analysisStateSelector.ts:671   — `wire.leader_claim
 *       .permitted && run_state.kind === 'complete_current'`, a THIRD conjunct.
 *   A4  UI lib/decisionVerdict.ts `hasLeadingOption`  — an independent UI
 *       derivation. A NAME TWIN: ResultsBody.tsx:369 passes
 *       `leaderClaimPermitted={…verdict?.hasLeadingOption === true}` — named
 *       after `leader_claim`, sourced from something else entirely.
 *
 * A3/A4 and the dark detector (`lib/coherence/crossSurfaceCoherence.ts` — the
 * emission was measured at `:872`; `:863` is the GUARD, and both are UI-repo
 * line numbers this CEE suite cannot verify, so bind to the emitted string,
 * which emits `withheld_leader_claim_with_named_conditional_winner` on exactly
 * this payload while `:408` records it is "NOT YET ENFORCED") are ROWED to a UI
 * lane. This file is the CEE half and is deliberately NON-BREAKING: it changes
 * no emitted value, so every current reader of `leader_claim` is unaffected.
 *
 * ⚠ WHAT THIS FILE DOES NOT CLAIM. It does not fix the disagreement. A1 and A2
 * answer different questions and MUST keep answering them — aligning their
 * defaults is precisely how #709/#737 was created. It names the concepts apart
 * so a consumer cannot read "we did not look" as "we looked and said no".
 *
 * MEASURED AT `5f2e3fd0`, executed against producer bytes, contrast control in
 * the same run (a body carrying `enrichment.robustness` reads non-null and
 * yields `permitted: true`):
 *   stale body (no analysis_result re-shipped) → rawRobustness = null
 *   + mayNameLeadingOption: true  → {"permitted":false,
 *                                    "withheld_reason":"separation_unavailable"}
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';

import {
  LEADER_CLAIM_REASON_KINDS,
  SEPARATION_SEPARATED,
  WITHHELD_CONSTRAINT_VERDICT,
  WITHHELD_NEAR_TIE,
  WITHHELD_SEPARATION_UNAVAILABLE,
  composeAnalysisStateV1,
  leaderClaimReasonKind,
  readRawRobustnessFromResponseBody,
  separationWasEvaluated,
} from '../analysis-state-v1.js';

/** A stale-route body: a PRIOR analysis is displayed, no `analysis_result` re-shipped. */
const STALE_BODY = {
  response_version: 2,
  assistant_text: 'the positioning lead',
  blocks: [],
  suggested_actions: [],
  insights: [],
};

/** CONTRAST: the same turn re-shipping its `analysis_result` with engine robustness. */
const FRESH_BODY = {
  response_version: 2,
  assistant_text: 'x',
  blocks: [
    {
      type: 'analysis_result',
      enrichment: { robustness: { level: 'high', near_tie: { is_tie: false } } },
    },
  ],
  suggested_actions: [],
  insights: [],
};

/** CONTRAST: engine says the options genuinely do not separate. */
const NEAR_TIE_BODY = {
  response_version: 2,
  assistant_text: 'x',
  blocks: [
    {
      type: 'analysis_result',
      enrichment: { robustness: { level: 'low', near_tie: { is_tie: true } } },
    },
  ],
  suggested_actions: [],
  insights: [],
};

const canonical = {
  status: 'complete',
  usableForProse: true,
  usableForChips: true,
  usableForFollowupContext: true,
  requiresRerun: false,
  blockedUnusable: false,
  contradictions: [],
  freshness: 'stale',
} as never;

function compose(body: unknown, mayNameLeadingOption: boolean) {
  return composeAnalysisStateV1({
    canonical,
    mayNameLeadingOption,
    rawRobustness: readRawRobustnessFromResponseBody(body),
  } as never) as unknown as { leader_claim: Record<string, unknown> };
}

describe('S6 — separation_unavailable is NOT EVALUATED, not WITHHELD', () => {
  // ── The precondition pin. Without this the section below is a tautology. ──
  describe('PRECONDITION — A1 and A2 return DIFFERENT facts on the payload under test', () => {
    it('the capture is reproduced: A1 says entitled, A2 says not permitted, on ONE payload', () => {
      const A1 = true; // claim_safety.may_name_leading_option, as captured
      const claim = compose(STALE_BODY, A1).leader_claim;
      const A2 = claim.permitted;

      // THE PIN: assert the two selectors DISAGREE here. If a future change
      // makes them agree, every consistency assertion below becomes vacuous
      // and this test must go red rather than quietly prove nothing.
      expect(A1, 'A1 — the turn IS entitled to name a leader').toBe(true);
      expect(A2, 'A2 — but the claim is not provable on this payload').toBe(false);
      expect(A1).not.toBe(A2);
      expect(claim.withheld_reason).toBe(WITHHELD_SEPARATION_UNAVAILABLE);
    });

    it('POSITIVE CONTROL — the probe can see a separation when one is on the payload', () => {
      expect(readRawRobustnessFromResponseBody(STALE_BODY)).toBeNull();
      expect(readRawRobustnessFromResponseBody(FRESH_BODY)).not.toBeNull();
    });

    it('DISCRIMINATION CONTROL — A1 and A2 AGREE on a payload that carries separation', () => {
      // Proves the disagreement above is a property of the STALE payload, not
      // a constant this file would report for any input (trap 20: a probe that
      // returns the same answer for every item is reporting on itself).
      const claim = compose(FRESH_BODY, true).leader_claim;
      expect(claim.permitted).toBe(true);
      expect('withheld_reason' in claim).toBe(false);
    });
  });

  // ── The fix: the two facts are nameable apart. ───────────────────────────
  /**
   * ⚠⚠ THESE CASES USED TO ASSERT `separationWasEvaluated(<code>)` ALONGSIDE THE
   * KIND, AND THAT PAIRING WAS THE DEFECT — corrected here rather than deleted.
   *
   * They read `separationWasEvaluated(WITHHELD_CONSTRAINT_VERDICT) === true`,
   * which encoded the false equivalence "withheld ⇒ we looked". The producer
   * chooses `!entitled` FIRST, so `constraint_verdict_withheld` is also emitted
   * on payloads where nothing was measured. `separationWasEvaluated` now reads
   * the PAYLOAD and no longer accepts a code, so those assertions have moved to
   * the payload section below, where the question can actually be answered.
   *
   * ⭐ Note that only ONE of the three went red on the signature change: the
   * other two asserted `false` and would have kept passing, because a string
   * handed to a payload-typed helper fails closed. Leaving them would have left
   * two tests passing for a reason unrelated to what they claim to check.
   */
  describe('the reason codes carry an explicit KIND', () => {
    it('separation_unavailable is NOT_EVALUATED — the product never looked', () => {
      expect(leaderClaimReasonKind(WITHHELD_SEPARATION_UNAVAILABLE)).toBe('not_evaluated');
    });

    it('the other two are WITHHELD — the product declined on a verdict', () => {
      for (const reason of [WITHHELD_CONSTRAINT_VERDICT, WITHHELD_NEAR_TIE]) {
        expect(leaderClaimReasonKind(reason), reason).toBe('withheld');
      }
    });

    it('an unknown code is NOT silently classified as either', () => {
      // A consumer must not be able to read a code this producer never minted
      // as a licence to name a leader, nor as a positive "we looked".
      expect(leaderClaimReasonKind('some_future_code')).toBe('unknown');
    });

    /**
     * ⭐ THE SEPARATION OF CONCERNS, PINNED. The kind answers "which half failed
     * first?"; the payload answers "was anything measured?". This asserts they
     * are genuinely different functions of different inputs — a code alone can
     * carry BOTH answers depending on the payload it rode in on.
     */
    it('the SAME code carries opposite evaluation facts depending on the payload', () => {
      const unmeasured = compose(STALE_BODY, false).leader_claim;
      const measured = compose(FRESH_BODY, false).leader_claim;

      expect(unmeasured.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
      expect(measured.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
      expect(separationWasEvaluated(unmeasured)).toBe(false);
      expect(separationWasEvaluated(measured)).toBe(true);
    });

    it('FAIL-CLOSED — a missing, non-object, or unminted separation is never "evaluated"', () => {
      expect(separationWasEvaluated(null)).toBe(false);
      expect(separationWasEvaluated(undefined)).toBe(false);
      expect(separationWasEvaluated({})).toBe(false);
      expect(separationWasEvaluated({ separation: 'not_a_minted_statement' })).toBe(false);
      // POSITIVE CONTROL — the probe can see a real statement.
      expect(separationWasEvaluated({ separation: SEPARATION_SEPARATED })).toBe(true);
    });

    /**
     * ⭐⭐ COMPLETENESS, DERIVED FROM THE MODULE NAMESPACE — because the
     * hand-written version could not fail.
     *
     * This test previously built `minted` as a LITERAL LIST of the three
     * imported constants and compared it to `Object.keys(...)`. Both sides then
     * move together only if a human remembers to edit both: mint a fourth
     * `WITHHELD_*` code and classify it nowhere, and this case still passed —
     * measured, 12/12 green under exactly that mutant. A trap-12 mirror inside
     * a test whose own comment cited trap 12d.
     *
     * The module's doc also claimed a fourth code would be "a type error at the
     * mint site". It is not: `LEADER_CLAIM_REASON_KINDS` is typed
     * `Record<string, …>` — an OPEN index signature — so `tsc` exits 0. Both
     * stated guarantees were false; the runtime was benign (unclassified →
     * `'unknown'` → fail-closed), the GUARANTEES were the defect.
     *
     * `minted` is now derived from the module's own exports, so the list cannot
     * drift from what the producer actually mints. Proven by the mutant pair
     * recorded in the PR body: passes at pristine, REDs when a fourth
     * `WITHHELD_*` constant is minted without classification.
     */
    it('COMPLETENESS — every minted code is classified into exactly one kind', async () => {
      const mod = await import('../analysis-state-v1.js');
      const minted = Object.entries(mod)
        .filter(([k, v]) => k.startsWith('WITHHELD_') && typeof v === 'string')
        .map(([, v]) => v as string);

      // The derivation must SEE something — an empty sweep would make every
      // assertion below vacuous (trap 13).
      expect(minted.length, 'the namespace sweep found no WITHHELD_* codes').toBeGreaterThan(0);
      expect(new Set(minted).size, 'duplicate code strings').toBe(minted.length);
      // The three known today, so a silent SHRINK is caught as well as a growth.
      expect(new Set(minted)).toEqual(
        new Set([WITHHELD_CONSTRAINT_VERDICT, WITHHELD_NEAR_TIE, WITHHELD_SEPARATION_UNAVAILABLE]),
      );

      for (const code of minted) {
        expect(
          LEADER_CLAIM_REASON_KINDS[code],
          `minted but unclassified: ${code}`,
        ).toMatch(/^(not_evaluated|withheld)$/);
      }
      // And nothing classified that is not minted.
      expect(Object.keys(LEADER_CLAIM_REASON_KINDS).sort()).toEqual([...minted].sort());
    });

    /**
     * ⭐ INHERITED PROTOTYPE KEYS. `LEADER_CLAIM_REASON_KINDS[reason]` is a bare
     * index read, so `'constructor'` resolves up the prototype chain and the
     * `?? 'unknown'` fallback never fires — the function returned a FUNCTION
     * where its signature promises a `LeaderClaimReasonKind`.
     *
     * Fail-closed held by luck (nothing equals `'withheld'`), which is why this
     * is low severity and still worth closing: the subsystem's own established
     * guard for exactly this lookup is
     * `Object.prototype.hasOwnProperty.call(...)` at
     * `orchestrator/context/constraint-feasibility.ts:937`, and new code
     * diverging from it is how one subsystem ends up with two answers to one
     * question.
     */
    it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
      'an inherited prototype key is UNKNOWN, not a prototype member: %s',
      (key) => {
        expect(leaderClaimReasonKind(key)).toBe('unknown');
      },
    );
  });

  // ── The distinction has to survive the real compose path, not just a map. ─
  describe('the kind is TRUE of the payloads that produce each code', () => {
    it('a stale payload yields a NOT_EVALUATED reason and OMITS separation', () => {
      const claim = compose(STALE_BODY, true).leader_claim;
      expect(leaderClaimReasonKind(String(claim.withheld_reason))).toBe('not_evaluated');
      // Absence is the producer's existing, deliberate signal for "not
      // computed". A `separation` value here would be the fabricated finding.
      expect('separation' in claim).toBe(false);
    });

    it('a near-tie payload yields a WITHHELD reason and STATES the separation', () => {
      const claim = compose(NEAR_TIE_BODY, true).leader_claim;
      expect(leaderClaimReasonKind(String(claim.withheld_reason))).toBe('withheld');
      expect(claim.separation).toBe('near_tie');
    });

    it('an unentitled turn yields a WITHHELD reason even when separation IS known', () => {
      const claim = compose(FRESH_BODY, false).leader_claim;
      expect(claim.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
      expect(leaderClaimReasonKind(String(claim.withheld_reason))).toBe('withheld');
    });

    /**
     * ⭐⭐ THE OMITTED CELL — `(STALE, false)`, i.e. NOT ENTITLED **and**
     * SEPARATION UNREADABLE. The corpus above drives `(STALE,true)`,
     * `(FRESH,true)`, `(NEAR_TIE,true)` and `(FRESH,false)`; this fourth
     * combination was never composed, and the unentitled case above
     * deliberately picks the FRESH body, where separation IS known.
     *
     * It is the cell where the reason code and the payload disagree. The
     * producer chooses `!entitled` FIRST, so this turn carries
     * `constraint_verdict_withheld` — a "we looked and declined" code — while
     * `rawRobustness` is null and nothing was measured. A helper keyed on the
     * REASON CODE therefore claims the separation was evaluated on a payload
     * that demonstrably never evaluated it: the same false-label defect this
     * file exists to correct, with the sign reversed.
     *
     * ⚠ The code string itself is CORRECT and must not change — `!entitled`
     * genuinely is the first failing half, and a consumer must not be told
     * "the options do not separate" about a turn withheld for an unrelated
     * reason. What must change is the helper that reads it.
     */
    it('NOT ENTITLED and separation UNREADABLE: the payload evaluated nothing, and the helper must not claim it did', () => {
      const claim = compose(STALE_BODY, false).leader_claim;

      // The reason code is unchanged and still correct for its own question.
      expect(claim.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
      expect(leaderClaimReasonKind(String(claim.withheld_reason))).toBe('withheld');

      // ⭐ THE PAYLOAD IS THE AUTHORITY ON WHETHER ANYTHING WAS MEASURED.
      // Absence of `separation` is the producer's own deliberate signal for
      // "not computed" (analysis-state-v1.ts, `ABSENCE IS DISTINCT`).
      expect('separation' in claim, 'nothing was measured on this payload').toBe(false);
      expect(
        separationWasEvaluated(claim),
        'the helper must answer from the payload, not from a code that cannot know',
      ).toBe(false);
    });

    /**
     * ⭐ THE OPPOSITE-DIRECTION TWIN (trap 22b). A helper that answered `false`
     * unconditionally would pass the case above and be worthless. Here the
     * separation genuinely WAS evaluated on an unentitled turn — same reason
     * code, opposite payload fact — and the helper must say so.
     */
    it('TWIN — not entitled but separation KNOWN: the same code, and the helper says EVALUATED', () => {
      const claim = compose(FRESH_BODY, false).leader_claim;

      expect(claim.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
      expect('separation' in claim, 'this payload DID compute a separation').toBe(true);
      expect(separationWasEvaluated(claim)).toBe(true);
    });

    it('an entitled turn with no separation is NOT EVALUATED — the code that means exactly that', () => {
      const claim = compose(STALE_BODY, true).leader_claim;

      expect(claim.withheld_reason).toBe(WITHHELD_SEPARATION_UNAVAILABLE);
      expect(separationWasEvaluated(claim)).toBe(false);
    });
  });

  // ── Non-breaking: the ruling requires current UI readers to be unaffected. ─
  describe('NON-BREAKING — no emitted value changed', () => {
    it('the three wire codes keep their exact strings', () => {
      expect(WITHHELD_CONSTRAINT_VERDICT).toBe('constraint_verdict_withheld');
      expect(WITHHELD_NEAR_TIE).toBe('options_do_not_separate');
      expect(WITHHELD_SEPARATION_UNAVAILABLE).toBe('separation_unavailable');
    });

    it('the emitted claim shape is unchanged for all three cells', () => {
      expect(compose(FRESH_BODY, true).leader_claim).toEqual({
        permitted: true,
        separation: 'separated',
      });
      expect(compose(NEAR_TIE_BODY, true).leader_claim).toEqual({
        permitted: false,
        withheld_reason: 'options_do_not_separate',
        separation: 'near_tie',
      });
      expect(compose(STALE_BODY, true).leader_claim).toEqual({
        permitted: false,
        withheld_reason: 'separation_unavailable',
      });
    });
  });
});
