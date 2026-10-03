/**
 * Shared sensitivity → prose-fragment translator.
 *
 * Converts a raw sensitivity coefficient into a sentence-fragment naming
 * WHAT the factor moves. Composes after a driver label — "..., which
 * {fragment}." or "Today it {fragment}." — so the result reads as "Cost
 * moderately weakens the option that came out highest." rather than the
 * more abstract "Cost has a moderate negative influence."
 *
 * ⭐⭐ WHAT THIS RETIRED, AND WHY IT IS THE SAME DEFECT AS `favours`.
 *
 * PAUL'S RULING, 21 Sep 2026, VERBATIM: "It's not a leading option. It's the
 * option from the causal analysis that either is most likely to happen or, if
 * we can provide this, is most likely to achieve the user's goal. We are a
 * reasoning enhancement tool, not a causal analysis tool. We are giving them
 * information to improve their critical and creative thinking, not
 * recommending options."
 *
 * Every band here used to end in **"the lead"** — a league-table noun with NO
 * STATED REFERENT (the lead at what? over whom? measured how?). It is the same
 * defect class as "sits in second place", which the sibling lane replaced with
 * "came out highest less often". MEASURED on the enriched fixture before this
 * change, `explain_results` emitted:
 *
 *     "The result appears to be driven by 'Delivery risk', which moderately
 *      strengthens the lead."
 *
 * — i.e. the product was emitting a phrase its OWN leader-claim alarm carries a
 * pattern for (`compose/leading-option-egress-guard.ts`'s `the_lead`).
 *
 * ⛔ THE REFERENT COMES FROM THE SINGLE OWNER, NOT FROM A LITERAL HERE.
 * `compose/goal-referenced-result-phrasing.ts` owns the result verb, and
 * `LEADER_CLAIM_PATTERNS`'s `came_out_highest` entry is DERIVED from it. Taking
 * {@link RESULT_STANDING_SUBJECT} from that module means the emitter and the
 * detector move together by construction: a copy change here CANNOT walk out
 * from under the alarm, which is exactly how a withheld leader reaches the user
 * through stored history (CLAUDE.md trap 12 — derive, don't mirror).
 *
 * ⚠ AND WHY A DEFINITE DESCRIPTION RATHER THAN A PRONOUN. "how often that
 * option came out highest" was measured against the real composed reply and
 * rejected: in `explain_results` the sentence immediately before this clause
 * names the RUNNER-UP, so "that option" binds to the wrong option by adjacency
 * and inverts the claim.
 *
 * Single source of truth for sensitivity-direction vocabulary. Used by:
 *   - the deterministic fallback composers for `explain_results` /
 *     `what_would_flip` handlers (`tools/handlers/explanation-fallback.ts`)
 *   - the post-analysis advice gate's enriched composers
 *     (`routing/post-analysis-advice-gate.ts`)
 *
 * Bands (single source of truth: `format/influence-bands.ts`), where SUBJECT
 * is {@link RESULT_STANDING_SUBJECT} = "the option that came out highest":
 *   |v| < 0.05         → "has little effect on SUBJECT"       (NEAR_ZERO)
 *   |v| in [0.05, 0.3) → "slightly {strengthens|weakens} SUBJECT"
 *   |v| in [0.3, 0.7)  → "moderately ..."
 *   |v| in [0.7, 0.95) → "strongly ..."
 *   |v| ≥ 0.95         → "very strongly ..."
 *
 * Vocabulary differs from `influencePhrase` by design: that helper
 * composes nouns ("moderate positive influence") for the display-safe
 * projection, while this fragment composes adverbs paired with the
 * standing-framing verbs the surrounding prose uses ("moderately
 * strengthens the option that came out highest"). The lowest band uses
 * "slightly" rather than "weakly" — "weakly weakens" reads awkwardly in
 * English.
 *
 * Telemetry (where it exists) retains the raw number; this helper only
 * governs USER-FACING prose.
 */

import { RESULT_STANDING_SUBJECT } from '../compose/goal-referenced-result-phrasing.js';
import {
  bandFromMagnitude,
  NEAR_ZERO_INFLUENCE_THRESHOLD,
} from './influence-bands.js';

/**
 * DGAI #341 claim guard: may a driver with this magnitude be NAMED in a
 * superlative driver claim ("would shift this result the most", "driven
 * mainly by", "the strongest sensitivity is on")?
 *
 * A finite magnitude below {@link NEAR_ZERO_INFLUENCE_THRESHOLD} renders as
 * "has little effect on …" via {@link formatSensitivityDirection} —
 * pairing that band with a "most/strongest" claim is a self-contradiction
 * (the live #341 wire: "Movement on X would shift this result the most.
 * Today it has little effect on the lead."). Such drivers are OMITTED from
 * those sentences, never renamed to a weaker candidate.
 *
 * An ABSENT / non-numeric value returns true: with no magnitude there is no
 * materiality verdict, and legacy driver shapes without values must keep
 * their (label-only) claims. The two functions share the same threshold so
 * the claim gate and the rendered band can never disagree.
 */
export function hasMaterialInfluence(value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return true;
  return Math.abs(value) >= NEAR_ZERO_INFLUENCE_THRESHOLD;
}

export function formatSensitivityDirection(value: number): string {
  if (!Number.isFinite(value)) return `has little effect on ${RESULT_STANDING_SUBJECT}`;
  const absV = Math.abs(value);
  if (absV < NEAR_ZERO_INFLUENCE_THRESHOLD)
    return `has little effect on ${RESULT_STANDING_SUBJECT}`;
  const band = bandFromMagnitude(absV);
  const adverb =
    band === 'weak'
      ? 'slightly'
      : band === 'moderate'
        ? 'moderately'
        : band === 'strong'
          ? 'strongly'
          : 'very strongly';
  const direction = value < 0 ? 'weakens' : 'strengthens';
  return `${adverb} ${direction} ${RESULT_STANDING_SUBJECT}`;
}
