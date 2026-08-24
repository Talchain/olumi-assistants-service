/**
 * Decision Records — the ELICITATION-BLINDNESS marker (ROADMAP 2.757).
 *
 * PURE. No I/O, no clock, no env. One question, answered from the facts the
 * capture path actually holds:
 *
 *   "Was the belief on this record stated INDEPENDENTLY of the analysis and
 *    of any other participant's position?"
 *
 * ── WHY THIS FIELD EXISTS ──────────────────────────────────────────────────
 * A confidence stated once the analysis is on screen is ANCHORED, and an
 * anchored number may be recorded and scored for personal calibration but must
 * never be blended into a group aggregate as if it were an independent
 * estimate. Row 2.757's whole point is that eligibility must be a RECORDED
 * FACT at capture time: nobody downstream can reconstruct what a user could
 * see. This module is that fact.
 *
 * ── WHY THREE VALUES AND NOT A BOOLEAN ─────────────────────────────────────
 * A boolean conflates "we know this was not blind" with "we could not tell",
 * which recreates the exact ambiguity the marker exists to prevent — CLAUDE.md
 * trap 21 (two different questions under one name). `unknown` is therefore a
 * FIRST-CLASS value, distinct from `not_blind`, and it is what an honest path
 * returns when it cannot establish either.
 *
 * ⭐ BLINDNESS IS EARNED, NEVER ASSUMED. `blind` is a POSITIVE claim about the
 * capture path and is returned only when that path PROVES the belief was
 * withheld from both the siblings' positions and the model's own number. A
 * path that cannot prove it gets `unknown`, never `blind`. This asymmetry is
 * deliberate: a false `not_blind` costs one usable data point, a false `blind`
 * silently corrupts an aggregate.
 */

/** The closed vocabulary. Mirrors the `@talchain/schemas` enum this field
 *  needs (see the PR's schema-pricing note) — keep the two in lockstep. */
export const DECISION_RECORD_ELICITED_BLIND_VALUES = [
  'blind',
  'not_blind',
  'unknown',
] as const;

export type ElicitedBlind = (typeof DECISION_RECORD_ELICITED_BLIND_VALUES)[number];

/**
 * What each capture path can present as evidence. A DISCRIMINATED UNION rather
 * than a bag of optional booleans, so a new capture path cannot be added
 * without stating, at the type level, what it can prove.
 */
export type ElicitationConditions =
  /**
   * The ambient commit-seam auto-capture (`capture.ts`). The confidence it
   * records IS the analysis's own win probability — it is not a human
   * elicitation at all, and it is not independent of the analysis by
   * construction. Hence `not_blind`, and there is nothing to be uncertain
   * about. (Whose number it is stays on `confidence_source`; these are two
   * different questions and are deliberately not collapsed into one field.)
   */
  | { readonly path: 'ambient_auto_capture' }
  /**
   * The "Record the decision" modal (`user-commit.ts`). The route REFUSES
   * with 409 `no_analysed_graph` unless CEE already holds a completed
   * non-noop run_analysis fact for the scenario, so a produced analysis is a
   * SERVER-ENFORCED PRECONDITION of every record written here. That is a fact
   * about the capture path, not an inference about screen state — which is
   * precisely the distinction row 2.757 asks for.
   */
  | {
      readonly path: 'user_commit';
      /** True iff an analysis anchor was actually established for this write. */
      readonly analysisAnchored: boolean;
    }
  /**
   * A collab blind-elicitation round (`src/collab/**`). INV-A makes blindness
   * a property of the QUERY SHAPE — `assembleOpenPacket` may only reach
   * `listOwnEvents`, so it never holds a sibling row to leak. This is the ONLY
   * path that can honestly earn `blind`.
   *
   * ⚠ SCOPE, STATED HONESTLY: no production caller constructs this arm at the
   * commit this shipped on. Collab elicitation events do not become decision
   * records yet — that consumer is exactly what row 2.757 says the marker must
   * ship BEFORE. The arm is the typed home the wiring lane must fill in, so
   * that the day blind beliefs do reach this store they are distinguishable
   * from the post-analysis population WITHOUT any retrospective inference.
   */
  | {
      readonly path: 'blind_elicitation_round';
      /** Siblings' positions provably withheld from the respondent. */
      readonly siblingPositionsWithheld: boolean;
      /** The model's own number provably withheld from the respondent. */
      readonly modelPositionWithheld: boolean;
    };

/**
 * Derive the marker. Total over the union — every path states what it proved.
 */
export function deriveElicitedBlind(conditions: ElicitationConditions): ElicitedBlind {
  switch (conditions.path) {
    case 'ambient_auto_capture':
      return 'not_blind';

    case 'user_commit':
      // No anchor ⇒ the precondition that makes this path knowable did not
      // hold, so we cannot establish EITHER answer. `unknown`, never a
      // defaulted `not_blind` — a default is not a measurement.
      return conditions.analysisAnchored ? 'not_blind' : 'unknown';

    case 'blind_elicitation_round':
      // Both withholdings are required. Either one unproven and the round
      // cannot certify independence — and an uncertifiable round is `unknown`,
      // not `not_blind`: we genuinely do not know what the respondent saw.
      return conditions.siblingPositionsWithheld && conditions.modelPositionWithheld
        ? 'blind'
        : 'unknown';
  }
}
