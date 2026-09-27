import { ArtefactInputError, assessBindingCurrentness, canonicalJson, fail, keys, own, record,
  type BindingCurrentness } from './common.js';
import {
  createDisconfirmation, validateDisconfirmation, type DisconfirmationArtefact,
} from './disconfirmation.js';
import {
  createEvidenceAssumptionMap, presentEvidenceAssumptionMap, validateEvidenceAssumptionMap,
  type EvidenceAssumptionMapArtefact,
} from './evidence-map.js';
import {
  createWeightedComparison, type WeightedComparisonArtefact,
} from './weighted-comparison.js';

export { presentEvidenceAssumptionMap };

interface ArtefactByKind {
  weighted_comparison: WeightedComparisonArtefact;
  evidence_assumption_map: EvidenceAssumptionMapArtefact;
  disconfirmation: DisconfirmationArtefact;
}

/** Explicit caller choice. This module has no automatic selection or product wiring. */
export function createReasoningArtefact<K extends keyof ArtefactByKind>(
  kind: K, input: unknown, hostContext: unknown,
): ArtefactByKind[K] {
  if (kind === 'weighted_comparison') return createWeightedComparison(input, hostContext) as ArtefactByKind[K];
  if (kind === 'evidence_assumption_map') return createEvidenceAssumptionMap(input, hostContext) as ArtefactByKind[K];
  if (kind === 'disconfirmation') return createDisconfirmation(input, hostContext) as ArtefactByKind[K];
  return fail('unsupported_artefact_kind');
}

/** Internal saved-envelope check. Present F2b only through the fresh-host safe projection. */
export function validateReasoningArtefact(raw: unknown): WeightedComparisonArtefact | EvidenceAssumptionMapArtefact | DisconfirmationArtefact {
  const value = record(raw);
  if (own(value, 'kind') === 'evidence_assumption_map') return validateEvidenceAssumptionMap(value);
  if (own(value, 'kind') === 'disconfirmation') return validateDisconfirmation(value);
  if (own(value, 'kind') !== 'weighted_comparison') fail('unsupported_artefact_kind');
  keys(value, [
    'kind', 'schema_version', 'calculation_version', 'canonical_input_hash', 'binding', 'canonical_inputs',
    'calculation_validity', 'preference_ownership', 'constraint_feasibility', 'ordering_permission', 'sensitivity',
  ]);
  const snapshot = record(own(value, 'canonical_inputs'));
  keys(snapshot, ['input', 'host']);
  const recreated = createWeightedComparison(own(snapshot, 'input'), own(snapshot, 'host'));
  if (canonicalJson(value) !== canonicalJson(recreated)) fail('artefact_revalidation_failed');
  return recreated;
}

export function serializeReasoningArtefact(raw: unknown): string {
  return canonicalJson(validateReasoningArtefact(raw));
}

/** The host supplies a fresh authoritative input snapshot before any persistence port receives a result. */
export function assessReasoningArtefactCurrentness(
  saved: unknown, currentInput: unknown, currentHostContext: unknown,
): BindingCurrentness {
  const historical = validateReasoningArtefact(saved);
  try {
    const current = historical.kind === 'weighted_comparison'
      ? createWeightedComparison(currentInput, currentHostContext)
      : historical.kind === 'evidence_assumption_map'
        ? createEvidenceAssumptionMap(currentInput, currentHostContext)
        : createDisconfirmation(currentInput, currentHostContext);
    return assessBindingCurrentness(historical.binding, current.binding);
  } catch (error) {
    if (error instanceof ArtefactInputError) return { state: 'invalid', changed_dependencies: [] };
    throw error;
  }
}
