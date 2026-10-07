import type { RunDelta } from '@talchain/schemas/boundary';
import type { ContextPackRunDelta } from './context-pack-schema.js';

/**
 * ⛔ SD-1 (DL 0df0e1, 6 Oct; Acceptance rehearsal12 on CEE d40fd7b): the model reads `C1_attributable` as licence to
 * credit the user's change (`RUN_DELTA_INSTRUCTION`). The wire's C1 says the two Runs were set up alike and the model
 * differed; it does NOT say ONE change was made. rehearsal12 had two (a band edit, and a figure restated inside its band
 * that no row can state), the list named one, coverage was `partial`, and the model told the user the comparison
 * "attributes the difference to your edit". The model never sees the rows or the coverage, so this projection applies S7's
 * own rule (`rerun-explanation.ts`: a C1 pair is credited only with complete coverage and exactly ONE non-goal row). Any
 * other C1 pair reads `C5_unattributed` (buddy r2 (b)): the Runs WERE set up alike, so `C2_unpaired` ("not comparable
 * like-for-like") would license a false sentence; C5 says only that the difference is not put down to one change, and
 * `RUN_DELTA_INSTRUCTION` licenses a cause for C1 alone. A delta with no `input_coverage` key was already projected and
 * passes as it is.
 */
export function modelFacingAttributionCase(delta: Pick<RunDelta, 'attribution_case'> & Partial<Pick<RunDelta, 'input_coverage' | 'input_changes'>>): RunDelta['attribution_case'] {
  if (delta.attribution_case !== 'C1_attributable' || delta.input_coverage === undefined) return delta.attribution_case;
  const rows = delta.input_changes ?? [];
  return delta.input_coverage === 'complete' && rows.length === 1 && rows[0]!.entity_kind !== 'goal' ? 'C1_attributable' : 'C5_unattributed';
}

/** The existing pack projection, shared by every model-input carrier. Wire data stays separate. */
export function projectModelFacingRunDelta(delta: ContextPackRunDelta & Partial<RunDelta>): ContextPackRunDelta {
  const attributionCase = modelFacingAttributionCase(delta);
  const {
    flip_thresholds: _flipThresholdsNotComputed,
    endpoints: _endpoints, input_coverage: _inputCoverage, input_changes: _inputChanges,
    win_probabilities_unavailable: _winProbabilitiesUnavailable,
    goal_chances: _goalChances,
    ...rest
  } = delta;
  void _flipThresholdsNotComputed; void _endpoints; void _inputCoverage; void _inputChanges; void _winProbabilitiesUnavailable;
  void _goalChances;
  return attributionCase === rest.attribution_case ? rest : { ...rest, attribution_case: attributionCase };
}
