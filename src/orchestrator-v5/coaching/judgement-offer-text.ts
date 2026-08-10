/**
 * ROADMAP 2.692 slice 2 — the two judgement-lens offers' TEXT and their
 * COMPOSABILITY tests, extracted to a PURE LEAF exactly as
 * `fragile-edge-offer-text.ts` prescribes: one function, two callers (the
 * selector's 2.1024 eligibility stage and the block mint), so the eligibility
 * test and the composition cannot disagree about what is composable.
 *
 * COPY LICENCE: the sentences are design 2.692 §4's evidence sentences (the
 * licensed claims — OQ-3's copy deck), restructured only so the NAMING clause
 * leads the body: the body is truncated at {@link COACHING_BLOCK_BODY_MAX} and
 * a naming sentence placed last is the first thing truncation eats (measured on
 * the fragile-edge card — it silently lost the second endpoint label).
 *   T1: licensed by the `edge_adjudication` fact + its closed verdict enum.
 *   T2: licensed by `validation.status === 'contested'` + the empty
 *       adjudication join.
 * No verdict language, no magnitudes, no "recommended option" — the target is
 * always an ISSUE (2.692 §4.3). `dsk_provenance` is deliberately ABSENT: neither
 * trigger is a bundle trigger, and claiming provenance these rules do not have
 * would be a false label (trap 14; the three core lenses set the precedent).
 *
 * COMPOSABILITY: endpoint labels are user/producer-authored and unbounded, so
 * each offer's gate is that its naming sentence alone survives the body cap.
 * There is NO dispatch-regex leg: v1 ships no action chip on these lenses (the
 * follow-through is conversational for T1 and the Model tab's contested cards
 * for T2), so there is no acceptance prompt to veto — and no inert chip to ship.
 */

import { COACHING_BLOCK_BODY_MAX } from './fragile-edge-offer-text.js';

// ── T1: override_stress_test ("Stress-test the value you set") ───────────────

export function composeOverrideNaming(fromLabel: string, toLabel: string): string {
  return `You overrode the estimate for the link from ${fromLabel} to ${toLabel}.`;
}

/** Naming sentence first, the lens's licensed tail second. */
export function composeOverrideBody(base: string, fromLabel: string, toLabel: string): string {
  return `${composeOverrideNaming(fromLabel, toLabel)} ${base}`;
}

export function isOverrideOfferComposable(fromLabel: string, toLabel: string): boolean {
  return composeOverrideNaming(fromLabel, toLabel).length <= COACHING_BLOCK_BODY_MAX;
}

// ── T2: disagreement_resolution ("Resolve this disagreement") ────────────────

export function composeDisagreementNaming(fromLabel: string, toLabel: string): string {
  return `The two drafting passes disagreed about the link from ${fromLabel} to ${toLabel}, and it hasn't been settled.`;
}

export function composeDisagreementBody(
  base: string,
  fromLabel: string,
  toLabel: string,
): string {
  return `${composeDisagreementNaming(fromLabel, toLabel)} ${base}`;
}

export function isDisagreementOfferComposable(fromLabel: string, toLabel: string): boolean {
  return composeDisagreementNaming(fromLabel, toLabel).length <= COACHING_BLOCK_BODY_MAX;
}
