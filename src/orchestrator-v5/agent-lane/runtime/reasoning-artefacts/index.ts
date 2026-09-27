import { assessBindingCurrentness, canonicalJson, fail, keys, own, record, type BindingCurrentness } from './common.js';
import {
  createWeightedComparison, type WeightedComparisonArtefact,
} from './weighted-comparison.js';

/** Explicit caller choice. This module has no automatic selection or product wiring. */
export function createReasoningArtefact(
  kind: 'weighted_comparison', input: unknown, hostContext: unknown,
): WeightedComparisonArtefact {
  if (kind !== 'weighted_comparison') fail('unsupported_artefact_kind');
  return createWeightedComparison(input, hostContext);
}

/** Recompute every derived field before accepting a stored artefact. */
export function validateReasoningArtefact(raw: unknown): WeightedComparisonArtefact {
  const value = record(raw);
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
  const current = createWeightedComparison(currentInput, currentHostContext);
  return assessBindingCurrentness(historical.binding, current.binding);
}
