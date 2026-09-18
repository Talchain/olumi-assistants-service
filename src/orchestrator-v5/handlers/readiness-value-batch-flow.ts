/**
 * ⭐ THE COMPOSITION: readiness gap -> estimates -> reviewed proposal -> one chip.
 *
 * `readiness-value-batch` holds the validator, the assembler, the offer and the
 * atomic apply. `readiness-value-estimator` holds the producer. Neither knows
 * about the other, deliberately — the estimator carries no adapter dependency
 * and the batch module carries no model dependency. This is the one place that
 * knows both, and it is the seam a caller wires.
 *
 * ⚠ WHY A SEPARATE MODULE RATHER THAN A FUNCTION IN EITHER. Putting it in the
 * batch module would give a pure validator a network dependency; putting it in
 * the estimator would make the producer import the assembler it feeds. Both
 * directions create an import cycle risk the moment either grows a second
 * caller. A composition seam is the shape that keeps the two halves separately
 * testable, which is the property the mutants in each rely on.
 *
 * ⛔ IT DOES NOT WRITE. `executeValueBatch` is the only writer, and it re-derives
 * membership from the CURRENT graph at apply time and refuses on
 * `membership_moved`. So an offer built here against a graph that has since
 * changed is rejected at the point of application rather than applied to a model
 * the user did not review. That check is the reason this function may be
 * optimistic about staleness.
 */

import {
  selectValueBatchMembership,
  buildValueBatchProposal,
  buildValueBatchOffer,
  type ValueBatchMembership,
  type ValueBatchProposal,
  type ValueBatchOffer,
} from './readiness-value-batch.js';
import {
  estimateValueBatch,
  type ValueEstimateFactorContext,
  type ValueEstimateModelCall,
} from './readiness-value-estimator.js';

type CanonicalReadinessAssessment = Parameters<typeof selectValueBatchMembership>[0];

export type PrepareValueBatchOutcome =
  /** An offer the caller can attach to `suggested_actions`. */
  | {
      readonly kind: 'offer';
      readonly offer: ValueBatchOffer;
      readonly proposal: ValueBatchProposal;
      readonly membership: ValueBatchMembership;
    }
  /** Nothing to ask about. Not a failure. */
  | { readonly kind: 'no_cells' }
  /**
   * The model declined every cell, or every estimate was unusable. The proposal
   * is CARRIED so the caller can still tell the user what was refused and why —
   * a bare `null` here would delete the declined reasons, which are the only
   * thing the user can act on in that state.
   */
  | { readonly kind: 'no_writable'; readonly proposal: ValueBatchProposal }
  /** The producer failed. The caller keeps the existing one-at-a-time route. */
  | { readonly kind: 'estimator_failed'; readonly reason: string }
  /** The assembler rejected the estimates. A producer defect, not a user state. */
  | { readonly kind: 'proposal_invalid'; readonly reason: string };

/**
 * Factor context for the model, derived from the graph rather than restated.
 *
 * ⚠ TOLERANT ON SHAPE, DELIBERATELY. A factor's current level lives at
 * `data.value` on the draft path and at `observed_state.value` once canonical,
 * and this runs on both. Reading only one would silently hand the model "no
 * current level recorded" for every factor on the other path — a degradation
 * with no error anywhere, which is exactly the class this estate keeps paying
 * for. Absence stays ABSENT (`undefined`) and is never coerced to 0: a factor
 * with no recorded level is not a factor at zero.
 */
export function deriveFactorContext(graph: unknown, factorIds: ReadonlySet<string>): ValueEstimateFactorContext[] {
  const nodes = (graph as { nodes?: unknown })?.nodes;
  if (!Array.isArray(nodes)) return [];
  const out: ValueEstimateFactorContext[] = [];
  for (const raw of nodes) {
    const n = raw as Record<string, unknown>;
    const id = typeof n.id === 'string' ? n.id : undefined;
    if (!id || !factorIds.has(id)) continue;
    const data = (n.data ?? {}) as Record<string, unknown>;
    const observed = (n.observed_state ?? {}) as Record<string, unknown>;
    const value =
      typeof data.value === 'number'
        ? data.value
        : typeof observed.value === 'number'
          ? observed.value
          : undefined;
    const unit =
      typeof data.unit === 'string'
        ? data.unit
        : typeof n.unit === 'string'
          ? n.unit
          : undefined;
    out.push({
      factor_id: id,
      label: typeof n.label === 'string' ? n.label : undefined,
      current_value: value,
      unit,
    });
  }
  return out;
}

/**
 * Turn an open readiness assessment into one reviewable offer.
 *
 * The caller supplies the model call, so this is testable end to end without a
 * paid request and the estimator's injection point survives all the way up.
 */
export async function prepareValueBatchOffer(
  input: {
    readonly assessment: CanonicalReadinessAssessment;
    readonly graph: unknown;
    readonly currentGraphHash: string;
    readonly scenarioId: string;
    readonly brief: string | undefined;
  },
  call: ValueEstimateModelCall,
): Promise<PrepareValueBatchOutcome> {
  const membership = selectValueBatchMembership(input.assessment);
  if (membership.cells.length === 0) return { kind: 'no_cells' };

  const factorIds = new Set(membership.cells.map((c) => c.factor_id));
  const estimated = await estimateValueBatch(
    {
      cells: membership.cells,
      factors: deriveFactorContext(input.graph, factorIds),
      brief: input.brief,
    },
    call,
  );
  if (estimated.status !== 'ok') {
    return {
      kind: 'estimator_failed',
      reason:
        estimated.status === 'no_cells'
          ? 'no_cells'
          : `${estimated.status}: ${estimated.detail}`,
    };
  }

  const proposalResult = buildValueBatchProposal({
    assessment: input.assessment,
    estimates: estimated.estimates,
  });
  if (proposalResult.status !== 'ok') {
    return { kind: 'proposal_invalid', reason: proposalResult.reason };
  }

  const offerOutcome = buildValueBatchOffer({
    proposal: proposalResult.proposal,
    currentGraphHash: input.currentGraphHash,
    scenarioId: input.scenarioId,
  });
  if (offerOutcome.kind === 'no_writable') {
    return { kind: 'no_writable', proposal: offerOutcome.proposal };
  }
  return {
    kind: 'offer',
    offer: offerOutcome.offer,
    proposal: proposalResult.proposal,
    membership,
  };
}
