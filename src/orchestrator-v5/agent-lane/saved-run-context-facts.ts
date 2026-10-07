/** Selected canonical Run facts for follow-up/Explain context. No freshness or permission authority. */
import type { ContextPackRunDelta } from '../context/context-pack-schema.js';
import { projectModelFacingRunDelta } from '../context/model-facing-run-delta.js';
import { asVerdictState, type StoredLimitVerdicts } from '../../orchestrator/context/constraint-feasibility.js';
import { analysisResultForAgent } from './decision-sensitivity.js';
import { limitChecksForAgent, LIMIT_CHECKS_NOTE } from './limit-checks.js';
import { runExplanationChip } from './run-explanation.js';
import { runToolOutputLicensesLeader } from './licensed-run-view.js';

export interface SavedRunContextFactsRead {
  readonly graph_hash?: string;
  readonly analysis_state?: unknown;
  readonly analysis_result?: unknown;
  readonly raw?: unknown;
  /** The selected Run's existing evaluated-product carrier, bound by the canonical read. */
  readonly identity_evaluated?: ReadonlySet<string>;
  readonly limit_verdicts?: StoredLimitVerdicts;
  readonly constraint_verdict_state?: unknown;
  readonly leader_limit_risks?: readonly unknown[] | null;
  /** Already bound and licensed at the canonical-read carrier; never the UI wire object. */
  readonly run_delta?: ContextPackRunDelta;
}

/** The existing Explain reference binds the full selected fact tuple; it is not a Run execution id. */
export function savedRunContextFacts(
  scenarioId: string,
  read: SavedRunContextFactsRead,
  permissions: unknown,
): Record<string, unknown> {
  const selected = runExplanationChip(scenarioId, {
    graphHash: read.graph_hash, analysisState: read.analysis_state, analysisResult: read.analysis_result,
  });
  if (selected === null) return {};
  const projected = analysisResultForAgent(read.analysis_result, undefined, true, read.raw) as Record<string, unknown>;
  const verdict = asVerdictState(read.constraint_verdict_state);
  const checks = !runToolOutputLicensesLeader({ claim_permissions: permissions })
    ? limitChecksForAgent(read.raw, read.limit_verdicts, read.identity_evaluated) : undefined;
  return {
    selected_run_reference: selected.id,
    ...(projected.goal_chance_driver_availability !== undefined
      ? { goal_chance_driver_availability: projected.goal_chance_driver_availability } : {}),
    ...(read.run_delta !== undefined && runToolOutputLicensesLeader({ claim_permissions: permissions })
      ? { run_delta: projectModelFacingRunDelta(read.run_delta) } : {}),
    leader_limit_risks_note: 'Each probability is the chance that its recorded option meets the named limit, not its chance of breaching it. '
      + 'Missing means unrecorded; null means no result body; [] means read with no recorded risk. These facts grant no permission to name a leader.',
    ...(projected.tipping_point !== undefined ? {
      tipping_point: projected.tipping_point, tipping_point_run_key: selected.id,
    } : {}),
    ...(read.limit_verdicts !== undefined ? { limit_verdicts: read.limit_verdicts } : {}),
    ...(read.constraint_verdict_state === null ? { constraint_verdict_state: null }
      : verdict !== null ? { constraint_verdict_state: verdict } : {}),
    // Preserve the canonical producer's distinction: missing, null (no body), [] (read, no risk).
    ...(read.leader_limit_risks === null || Array.isArray(read.leader_limit_risks)
      ? { leader_limit_risks: read.leader_limit_risks } : {}),
    ...(checks !== undefined ? { limit_checks: { limits: checks, note: LIMIT_CHECKS_NOTE } } : {}),
  };
}
