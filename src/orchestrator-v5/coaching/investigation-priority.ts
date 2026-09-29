/**
 * ⭐ THE QUESTION THIS MODULE ANSWERS — and it is deliberately not the one next
 * door.
 *
 *   MAY THE COACH TELL THIS USER WHICH FACTOR IS WORTH INVESTIGATING FIRST,
 *   AND WHAT DID THE SCIENCE ACTUALLY SAY?
 *
 * It does NOT answer "which factor moves the result most". That is INFLUENCE
 * (`top_drivers`, sensitivity, elasticity) and it is a different question with
 * a different answer. A factor can dominate the outcome and be worthless to
 * investigate — if you already know its value, learning it again buys nothing.
 * Conflating the two is this estate's signature defect (CLAUDE.md trap 21: two
 * questions under one name), and on 3 Sep 2026 it reached a user.
 *
 * ── THE MEASURED DEFECT ────────────────────────────────────────────────────
 * Founder session, scenario `7826c742`, CEE `f4c8f501`, 13:46–13:48Z
 * (`olumi-programme-docs` `artefacts/manual-test-2026-09-03/`). The product
 * told the user that validating ICP clarity was
 *
 *   "the single highest-value check before acting on this result"
 *
 * while, in the very payload that produced it:
 *
 *   · every `factor_sensitivity[].value_of_information` was **0** (six of six);
 *   · `factor_evppi` carried ONE row, `status: "below_resolution"`, i.e. the
 *     producer's Strong–Oakley estimate did not clear that factor's own
 *     permutation-noise floor;
 *   · `evpi_present` was false in the UI's own diagnostic.
 *
 * ICP clarity was `influence_rank: 1`. The sentence is an INFLUENCE ranking
 * wearing the words of an INFORMATION-VALUE ranking.
 *
 * ── WHY THE EXISTING GUARDS COULD NOT SEE IT ───────────────────────────────
 * They are pointed at a different channel, and this is the load-bearing part —
 * a guard aimed at the wrong bytes is CLAUDE.md trap 22(b) and it reads green
 * for ever.
 *
 *   · `format-analysis-for-context.ts`'s `value_of_information` section reads
 *     `enrichment.m1_coaching.evidence_gaps[]` (via
 *     `deriveEvidenceGapsFromEnrichment`). The debug bundle's own shape
 *     validator records `presence.m1_coaching = false` for this run, so that
 *     channel was EMPTY and the pack fell to `VOI_NOT_SCORED_NOTE` — "no
 *     value-of-information scores are available for this analysis".
 *     That sentence is FALSE about the analysis: `factor_evppi` and
 *     `decision_evpi` were both present. It is true only about the one channel
 *     the projection happened to read. One name, two questions, again.
 *   · `selectFactorEvppiPriority` DOES read the EVPPI channel, and for this
 *     exact enrichment answers `not_selected: 'all_below_resolution'` — the
 *     precisely correct verdict. But every one of its consumers is a
 *     DETERMINISTIC composer (`phase3-blocks`, `chip-generator`,
 *     `post-analysis-advice-gate`, `lens-selector`). Swept at `f4c8f501` with
 *     a contrast control: zero of them is the ContextPack.
 *
 * So the science knew, the blocks knew, the chips knew — and **the model that
 * authors the conversational coaching was never told.** This module is the
 * missing consumer. It adds no new science and re-derives nothing: it is a
 * projection of the SAME `select-factor-evppi` authority into the one surface
 * that could not see it.
 *
 * ── WHY A LICENCE AND NOT A POSTCHECK ──────────────────────────────────────
 * The obvious alternative is a phrase filter over the model's prose. It was
 * considered and rejected: "is this sentence an investigation-priority claim?"
 * is a predicate over natural language, and CLAUDE.md trap 22f records four
 * consecutive rounds of exactly that shape oscillating on one estate predicate
 * before anyone stopped. A filter also cannot help the model get it RIGHT — it
 * can only delete a good answer along with a bad one, which is the regression
 * `typed-intent-directive.ts` exists to warn about.
 *
 * A licence, by contrast, is a FACT the model can reason from, it is derived,
 * and its correctness is a property of the enrichment rather than of English.
 *
 * ── THE ERROR DIRECTION, STATED ────────────────────────────────────────────
 * Every refusal reason that is not literally "the producer named a factor"
 * resolves to a state that WITHHOLDS the claim. Before a named selection
 * reaches the coach, projectAnalysis also checks current canonical factor
 * membership and the existing option-control authority.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  pickLatestFactorEvppiPriorityGuidance,
  selectFactorEvppiPriorityGuidance,
  type FactorEvppiPriorityGuidanceDecision,
} from './select-factor-evppi.js';

/**
 * What this analysis's own information-value science says about investigation
 * priority. Four states, because they license four different sentences — and
 * collapsing any pair of them would be the "align the defaults" mistake that
 * trap 21 is about.
 *
 * `not_assessed` is deliberately SEPARATE from `below_resolution`: "we did not
 * look" and "we looked and found nothing above the noise" are different claims,
 * and only the second entitles the product to say the science has an answer.
 */
export type InvestigationPriorityLicence =
  | {
      /** The producer ranked a factor and it cleared its own noise floor. */
      readonly kind: 'named';
      /** Internal identity retained for current-model eligibility, not prose. */
      readonly factorId: string;
      /** The exact same-run factor label, safety-checked upstream. */
      readonly factorLabel: string;
      /** Existing selector's exact-factor, safety-checked action, if present. */
      readonly specificAction: string | null;
    }
  | {
      /** The assessed EVPPI rows did not clear their resolution floors. */
      readonly kind: 'below_resolution';
    }
  | {
      /** A ranking exists but is not trustworthy enough to name one factor. */
      readonly kind: 'incomplete';
    }
  | {
      /** No per-factor EVPPI estimate reached this analysis. */
      readonly kind: 'not_assessed';
    };

/**
 * The prohibition, shared by the three states that cannot name a priority.
 *
 * It names the CONFUSION rather than banning a vocabulary, because banning
 * words leaves the same claim reachable through synonyms — the founder's
 * session said "highest-value check", which no ban on "value of information"
 * would have caught.
 */
const INFLUENCE_IS_NOT_INFORMATION_VALUE =
  'Influence is how much a factor moves the result; information value is how much ' +
  'resolving it would be worth. They are different questions. You may still say which ' +
  'factors influence the result most — you may not turn that into an investigation ' +
  'ranking or a highest-value check on the basis of influence alone.';

/**
 * The model-facing notes.
 *
 * There is deliberately NO note for `not_assessed`: see
 * {@link investigationPriorityNote} for why that state adds nothing, and note
 * that a constant defined for an unreachable state is a guard that cannot
 * fire — the shape this estate keeps shipping.
 *
 * No EVPPI magnitude is emitted (the optional evidence action may use counts),
 * and each one states what the science DID, not merely what the product will
 * not say — a bare prohibition leaves the model with an unanswered question and
 * the influence ranking as the only ranking in the pack, which is precisely how
 * the 3 Sep session went wrong.
 */
export const INVESTIGATION_PRIORITY_BELOW_RESOLUTION_NOTE =
  'The per-factor EVPPI channel DID estimate information value for the assessed factors; ' +
  'none of those estimates cleared the resolution of the run. This channel therefore ' +
  'does not name a priority. This is not a verdict on unassessed factors or other ' +
  'evidence-gap guidance. ' +
  INFLUENCE_IS_NOT_INFORMATION_VALUE;

export const INVESTIGATION_PRIORITY_INCOMPLETE_NOTE =
  'The per-factor EVPPI channel cannot license a current investigable factor: its ' +
  'ranking, identity, or eligibility is incomplete. Do not promote a surviving entry ' +
  'or substitute another factor. This does not invalidate separate evidence-gap guidance. ' +
  INFLUENCE_IS_NOT_INFORMATION_VALUE;

/**
 * The one state that GRANTS the claim. It is narrow on purpose: the producer
 * named exactly one factor, so the product may name exactly that one.
 */
export function investigationPriorityNamedNote(factorLabel: string, specificAction: string | null = null): string {
  return (
    `The per-factor EVPPI estimate ranks "${factorLabel}" first among its assessed factors. ` +
    'When describing this channel\'s priority, name that factor ' +
    'and no other — in particular do not substitute whichever factor has the largest ' +
    'influence on the result, which is a different question.' +
    // The verdict is never budget-dropped. An optional long action is omitted,
    // not truncated into different advice, so it cannot exhaust that budget.
    (specificAction === null || specificAction.length > 512
      ? '' : ` Suggested evidence action for this factor: ${specificAction}`)
  );
}

/**
 * Translate the EVPPI authority's decision into the licence.
 *
 * Every refusal reason is enumerated rather than defaulted, so a new reason
 * added to `select-factor-evppi.ts` fails the build here instead of silently
 * inheriting whichever state happened to be the fallback. That is the whole
 * point of the exhaustive switch: the compiler is the drift guard, not a
 * comment (CLAUDE.md trap 12).
 */
export function licenceFromEvppiGuidance(
  decision: FactorEvppiPriorityGuidanceDecision,
): InvestigationPriorityLicence {
  if (decision.outcome === 'selected') {
    return { kind: 'named', factorId: decision.factorId, factorLabel: decision.factorLabel, specificAction: decision.specificAction };
  }
  switch (decision.reason) {
    case 'absent':
      return { kind: 'not_assessed' };
    case 'all_below_resolution':
      return { kind: 'below_resolution' };
    case 'producer_partial':
    case 'transport_contract_mismatch':
    case 'warning_carrier_unreadable':
    case 'unreadable_before_priority':
    case 'duplicate_before_priority':
    case 'priority_not_eligible':
    case 'factor_sensitivity_absent':
    case 'factor_sensitivity_duplicate':
    case 'factor_label_unreadable':
      return { kind: 'incomplete' };
    default: {
      // Unreachable while the union is exhaustive; if a reason is added
      // without a case here this line stops compiling.
      const exhaustive: never = decision.reason;
      void exhaustive;
      return { kind: 'incomplete' };
    }
  }
}

/**
 * The model-facing sentence for a licence, or `null` when there is nothing
 * this module can honestly add.
 *
 * No EVPPI channel adds no EVPPI note. Evidence-gap and factor-sensitivity
 * signals retain their own, independently scoped disclosures.
 */
export function investigationPriorityNote(
  licence: InvestigationPriorityLicence,
): string | null {
  switch (licence.kind) {
    case 'named':
      return investigationPriorityNamedNote(licence.factorLabel, licence.specificAction);
    case 'below_resolution':
      return INVESTIGATION_PRIORITY_BELOW_RESOLUTION_NOTE;
    case 'incomplete':
      return INVESTIGATION_PRIORITY_INCOMPLETE_NOTE;
    case 'not_assessed':
      return null;
    default: {
      const exhaustive: never = licence;
      void exhaustive;
      return null;
    }
  }
}

/**
 * Has the per-factor EVPPI channel supplied a verdict? Not a statement about
 * every information-value channel in the analysis.
 */
export function hasFactorEvppiAssessment(
  licence: InvestigationPriorityLicence | null | undefined,
): boolean {
  return licence != null && licence.kind !== 'not_assessed';
}

/** Retain the producer's first selection or withhold it; never rerank survivors. */
export function eligibleInvestigationPriority(
  licence: InvestigationPriorityLicence,
  currentFactorIds: ReadonlySet<string> | undefined,
  controlledFactorIds: ReadonlySet<string> | undefined,
): InvestigationPriorityLicence {
  if (licence.kind !== 'named') return licence;
  if (currentFactorIds === undefined || controlledFactorIds === undefined ||
      !currentFactorIds.has(licence.factorId) || controlledFactorIds.has(licence.factorId)) {
    return { kind: 'incomplete' };
  }
  return licence;
}

/**
 * The licence for a raw enrichment blob. Thin, and exported because the
 * acceptance corpus drives real captured enrichment through the same path the
 * assembler uses rather than through a hand-built decision object.
 */
export function investigationPriorityFromEnrichment(
  enrichment: unknown,
): InvestigationPriorityLicence {
  return licenceFromEvppiGuidance(selectFactorEvppiPriorityGuidance(enrichment));
}

/**
 * The licence for the newest freshness-aligned analysis fact.
 *
 * `null` in the underlying selector means there is no analysis fact at all — no
 * analysis section is projected on such a turn, so there is nothing to license
 * and this returns `null` rather than inventing `not_assessed`. Absence of a
 * licence and a licence saying "nothing was assessed" are different claims and
 * are kept apart here for the same reason the four states are.
 */
export function pickInvestigationPriorityLicence(
  priorFacts: readonly HandlerFact[],
): InvestigationPriorityLicence | null {
  const guidance = pickLatestFactorEvppiPriorityGuidance(priorFacts);
  return guidance === null ? null : licenceFromEvppiGuidance(guidance);
}
