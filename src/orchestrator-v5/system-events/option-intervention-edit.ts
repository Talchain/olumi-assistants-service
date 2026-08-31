import { CANONICAL_ID_REGEX } from '../../cee/utils/id-normalizer.js';
import { InterventionV3 } from '../../schemas/cee-v3.js';
import { mergeInterventionSourceObjects } from '../../orchestrator/tools/analysis-ready-helper.js';
import { assertIngressGraphNumericBounds } from '../../validators/numeric-bounds.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { buildOptionEffectRawOperation, linkedFactorsOf } from '../routing/option-effect-write.js';

/**
 * Internal preparation for an explicit option→factor edit. This is NOT a wire
 * schema and cannot admit a system event. The shared event still needs its
 * declared contract. Preparation composes the existing intervention operation;
 * it does not write, commit, infer a unit, or grant constraint-edit authority.
 */
export interface OptionInterventionEditInput {
  readonly persistedGraph: unknown;
  readonly optionId: string;
  readonly factorId: string;
  /** Already on the model scale; raw-unit conversion is not licensed here. */
  readonly modelValue: number;
  readonly expectedGraphHash: string;
}

export function prepareOptionInterventionEdit(input: OptionInterventionEditInput):
  | { readonly kind: 'prepared'; readonly operation: Record<string, unknown> }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string } {
  const refuse = (reason: string) => ({ kind: 'refused' as const, reason });
  if (!Number.isFinite(input.modelValue) || input.modelValue < 0 || input.modelValue > 1) {
    return refuse('invalid_model_value');
  }
  if (!CANONICAL_ID_REGEX.test(input.optionId) || !CANONICAL_ID_REGEX.test(input.factorId)) {
    return refuse('invalid_identity');
  }

  // Validate the persisted ingress representation without repairing it. Strict
  // GraphV3 rejects sanctioned legacy sigma values; flooring them here would
  // change the very analysis identity this edit must check and preserve.
  const parsed = GraphStateIngressSchema.safeParse(input.persistedGraph);
  if (!parsed.success || !assertIngressGraphNumericBounds(parsed.data).ok) {
    return refuse('canonical_graph_unavailable');
  }
  const graph = parsed.data;
  if (!input.expectedGraphHash || computeAnalysisAffectingGraphHash(graph) !== input.expectedGraphHash) {
    return refuse('stale_graph');
  }
  const options = graph.nodes.filter(node => node.id === input.optionId);
  const factors = graph.nodes.filter(node => node.id === input.factorId);
  const option = options[0];
  const factor = factors[0];
  if (options.length !== 1 || factors.length !== 1 || option?.kind !== 'option' || factor?.kind !== 'factor'
    || typeof option.label !== 'string' || typeof factor.label !== 'string') {
    return refuse('unresolved_identity');
  }
  // Reuse the conversational writer's identity-link question, not a new
  // topology/science admission policy. Unique endpoint identity is checked
  // above; the established reader owns which factor IDs an option addresses.
  if (!linkedFactorsOf(graph, option.id).some(linked => linked.id === factor.id)) {
    return refuse('unresolved_effect_relationship');
  }

  const interventions = option.interventions;
  if (interventions !== undefined && (interventions === null || typeof interventions !== 'object'
    || Array.isArray(interventions))) return refuse('invalid_existing_intervention');
  const existing = interventions && Object.hasOwn(interventions, factor.id)
    ? (interventions as Record<string, unknown>)[factor.id] : undefined;
  // A canonical key alone is not read authority: existing consumers may select
  // a newer nested/slash-keyed carrier. Do not manufacture a no-op from its
  // stale top-level mirror or silently promote a legacy carrier here.
  if (mergeInterventionSourceObjects(option)[factor.id] !== existing) {
    return refuse('noncanonical_intervention_source');
  }
  if (existing !== undefined) {
    const entry = InterventionV3.safeParse(existing);
    if (!entry.success || entry.data.target_match.node_id !== factor.id) {
      return refuse('invalid_existing_intervention');
    }
    // This adapter records changed values, not adoption/confirmation. A repeat
    // must not turn the old AI estimate into a new user-authored measurement.
    if (entry.data.value === input.modelValue) return { kind: 'unchanged' };
  }
  return {
    kind: 'prepared',
    operation: buildOptionEffectRawOperation({
      optionId: option.id, optionLabel: option.label,
      factorId: factor.id, factorLabel: factor.label, value: input.modelValue,
    }),
  };
}
