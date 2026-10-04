import type { RunDelta } from '@talchain/schemas/boundary';
import type { ContextPackRunDelta } from './context-pack-schema.js';

/** The existing pack projection, shared by every model-input carrier. Wire data stays separate. */
export function projectModelFacingRunDelta(delta: ContextPackRunDelta & Partial<RunDelta>): ContextPackRunDelta {
  const {
    flip_thresholds: _flipThresholdsNotComputed,
    endpoints: _endpoints, input_coverage: _inputCoverage, input_changes: _inputChanges,
    win_probabilities_unavailable: _winProbabilitiesUnavailable,
    ...rest
  } = delta;
  void _flipThresholdsNotComputed; void _endpoints; void _inputCoverage; void _inputChanges; void _winProbabilitiesUnavailable;
  return rest;
}
