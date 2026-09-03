/**
 * CAN THIS EDIT MOVE THE OPTION COMPARISON? — the one derivation both
 * edit-time surfaces read.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THE SCOPE IS NARROWER THAN "IS THIS FACTOR AT ZERO", AND THE DIFFERENCE
 * IS LOAD-BEARING (CLAUDE.md trap #21 — write down the question each authority
 * answers before combining them).
 *
 *   `zeroEffectReasonFor` (`coaching/zero-effect-factors.ts`) answers
 *     "did the last analysis SCORE this factor at zero?"
 *   That licenses refusing a CAUSAL sentence about a movement already
 *   observed: a factor scored at zero in the run being described cannot be why
 *   the run moved.
 *
 *   THIS MODULE answers
 *     "will editing this factor's value move the comparison?"
 *   which is a claim about the FUTURE, and a measured zero does not support
 *   it. `sensitivity_score: 0` is a LOCAL derivative at the old operating
 *   point; a genuinely non-linear factor can be flat there and steep at the
 *   new value. Telling such a user "changing this will not move the
 *   comparison" would be a fabrication in the opposite direction.
 *
 * So only the two STRUCTURAL grounds count as inert here:
 *   - every option supplies its own value (derived from the graph), or
 *   - the producer named `intervention_override` as the zero's cause (derived
 *     from the analysis).
 * Both say the baseline is never read AT ANY VALUE. A bare measured zero does
 * NOT, and is deliberately excluded.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ TWO INDEPENDENT WITNESSES — and that is the completeness check each of
 * them needs from outside itself. The graph read fires before any analysis
 * exists and when the last one is stale; the producer read fires when the
 * graph shape is one this repo's enumeration does not reach. A guard derived
 * only from the graph proves the graph agrees with itself.
 *
 * ⚠ UNIONED FOR THE POSITIVE, BUT NOT WHERE THEY DISAGREE. They read the graph
 * at DIFFERENT TIMES — the structural one NOW, the producer one as of the last
 * analysis — so a mutation in between can make them contradict each other. In
 * that one cell this module claims NOTHING rather than picking a winner; the
 * argument, and the harm each alternative would do, are at the exit itself.
 * Calling the combination a plain union was the earlier reading and it made
 * the ordering look deliberate when nothing argued it.
 *
 * PURE AND TOTAL.
 */

import { baselineOverrideReach } from '../context/baseline-override-reach.js';

import { collectZeroEffectFactors, zeroEffectReasonFor } from './zero-effect-factors.js';

/**
 * On what evidence the verdict rests. Typed rather than commented so a test —
 * or triage — can tell the two witnesses apart, and so a future reader can see
 * at a glance which one is firing on the live path.
 */
export type EditComparisonReachBasis =
  | 'every_option_overrides'
  | 'producer_intervention_override'
  | 'both';

export type EditComparisonReach =
  /** The factor's value is a baseline every option replaces. An edit cannot move the comparison. */
  | { readonly kind: 'inert'; readonly basis: EditComparisonReachBasis }
  /** At least one option consumes this factor's own value. An edit can move the comparison. */
  | { readonly kind: 'reaches' }
  /** Not derivable. Claim nothing in either direction. */
  | { readonly kind: 'unknown' };

/**
 * @param graph                     the RAW turn graph, or null/undefined when
 *                                  unavailable on this path.
 * @param priorAnalysisEnrichment   `result.enrichment` of the newest analysis
 *                                  the user has been shown, or null.
 * @param factorId                  the STRUCTURAL id of the edited factor.
 */
export function deriveEditComparisonReach(input: {
  readonly graph: unknown;
  readonly priorAnalysisEnrichment: unknown;
  readonly factorId: string;
}): EditComparisonReach {
  const structural = baselineOverrideReach(input.graph, input.factorId);
  const producerReason = zeroEffectReasonFor(
    collectZeroEffectFactors(input.priorAnalysisEnrichment),
    input.factorId,
  );
  const producerSaysOverridden = producerReason === 'intervention_override';

  if (structural.kind === 'replaced_by_every_option') {
    return {
      kind: 'inert',
      basis: producerSaysOverridden ? 'both' : 'every_option_overrides',
    };
  }
  // ⭐⭐⭐ THE DISAGREEMENT CELL — DECIDED DELIBERATELY, AND IT USED TO BE
  // DECIDED BY ACCIDENT OF ORDERING.
  //
  // Six cells; five are obvious. The sixth is
  //   structural = `reaches_comparison`  ×  producer = `intervention_override`
  // and it previously resolved to `inert`, because the producer check sat
  // above the structural positive. That was wrong, and the comment that stood
  // here ("THE STRUCTURAL VERDICT WINS THE NEGATIVE") described behaviour the
  // code did not have.
  //
  // ⚠ THE TWO WITNESSES ARE FROM DIFFERENT TIMES, BY DESIGN. The caller passes
  // `result.mutatedGraph` (the post-mutation graph, NOW) and
  // `newestSuccessfulAnalysisEnrichment(prior_facts)` (whenever the last run
  // happened) — see `tools/handlers/set-factor-value.ts`. So the producer's
  // `intervention_override` is a statement about the graph AS IT STOOD AT THE
  // LAST ANALYSIS, and `reaches_comparison` is a positive enumeration over the
  // graph as it stands now. Any mutation in between that leaves one option not
  // overriding the factor reaches this cell — an `edit_graph`, an intervention
  // removed, or `add_option` adding an option that carries no intervention on
  // it. It is not a hypothetical.
  //
  // ⛔ WHY NOT `reaches`, AND WHY NOT `inert`. Neither witness can be trusted
  // to win here, and that is the honest reading of the header's own argument
  // for unioning them:
  //   · `inert` asserts, through `BASELINE_REPLACED_BY_OPTIONS_NARRATIVE`,
  //     that "every option here sets its own value for this factor" — a
  //     sentence the CURRENT graph has just positively refuted — and it also
  //     suppresses the staleness narrative, so the user is told the edit is
  //     inert AND not told to re-run. This module's header names that
  //     direction: "or, far worse, tell a user their edit is inert when it is
  //     not."
  //   · `reaches` would rest on the graph enumeration being complete on every
  //     graph shape, which is the very assumption the producer witness exists
  //     to cover for. Preferring it here would quietly retire that witness.
  //
  // So the cell claims NOTHING. `unknown` costs the coaching sentence on a
  // genuinely ambiguous turn and lets the caller fall through to the staleness
  // narrative, which is TRUE on this turn regardless of which witness is
  // right: an analysis exists (the producer verdict came from it) and the
  // graph has changed since.
  if (producerSaysOverridden) {
    return structural.kind === 'reaches_comparison'
      ? { kind: 'unknown' }
      : { kind: 'inert', basis: 'producer_intervention_override' };
  }
  // ⭐ ONLY THE STRUCTURAL WITNESS CAN EVER RETURN `reaches`.
  // `reaches_comparison` means an option was enumerated that does NOT override
  // this factor — a positive observation. The producer read has no equivalent:
  // the absence of a `zero_reason` is not a statement that the factor is live
  // (the entry may be missing, the analysis stale, the envelope thin), so it
  // can never contribute a `reaches`.
  if (structural.kind === 'reaches_comparison') return { kind: 'reaches' };
  return { kind: 'unknown' };
}
