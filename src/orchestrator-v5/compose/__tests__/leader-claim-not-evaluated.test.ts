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
 * A3/A4 and the dark detector (`lib/coherence/crossSurfaceCoherence.ts:863`,
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
  describe('the reason codes carry an explicit KIND', () => {
    it('separation_unavailable is NOT_EVALUATED — the product never looked', () => {
      expect(leaderClaimReasonKind(WITHHELD_SEPARATION_UNAVAILABLE)).toBe('not_evaluated');
      expect(separationWasEvaluated(WITHHELD_SEPARATION_UNAVAILABLE)).toBe(false);
    });

    it('the other two are WITHHELD — the product looked and declined', () => {
      for (const reason of [WITHHELD_CONSTRAINT_VERDICT, WITHHELD_NEAR_TIE]) {
        expect(leaderClaimReasonKind(reason), reason).toBe('withheld');
        expect(separationWasEvaluated(reason), reason).toBe(true);
      }
    });

    it('an unknown code is NOT silently classified as either', () => {
      // A consumer must not be able to read a code this producer never minted
      // as a licence to name a leader, nor as a positive "we looked".
      expect(leaderClaimReasonKind('some_future_code')).toBe('unknown');
      expect(separationWasEvaluated('some_future_code')).toBe(false);
    });

    it('COMPLETENESS — every minted code is classified into exactly one kind', () => {
      // Derived from the producer's own code list, so minting a fourth code
      // without classifying it fails HERE rather than reaching a consumer as
      // an unclassified reason (trap 12d: derivation moves the risk, so the
      // corpus below is the other half).
      const minted = [
        WITHHELD_CONSTRAINT_VERDICT,
        WITHHELD_NEAR_TIE,
        WITHHELD_SEPARATION_UNAVAILABLE,
      ];
      expect(minted).toHaveLength(3);
      expect(new Set(minted).size).toBe(3);
      for (const code of minted) {
        expect(LEADER_CLAIM_REASON_KINDS[code], code).toMatch(/^(not_evaluated|withheld)$/);
      }
      expect(Object.keys(LEADER_CLAIM_REASON_KINDS).sort()).toEqual([...minted].sort());
    });
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
