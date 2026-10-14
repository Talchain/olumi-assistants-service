/** Selected canonical Run facts for follow-up/Explain context. No freshness or permission authority. */
import type { ContextPackRunDelta } from '../context/context-pack-schema.js';
import { projectModelFacingRunDelta } from '../context/model-facing-run-delta.js';
import { asVerdictState, type StoredLimitVerdicts } from '../../orchestrator/context/constraint-feasibility.js';
import { analysisResultForAgent } from './decision-sensitivity.js';
import { limitChecksForAgent, LIMIT_CHECKS_NOTE } from './limit-checks.js';
import { runExplanationChip } from './run-explanation.js';
import { isCodeShaped, runToolOutputLicensesLeader } from './licensed-run-view.js';
import { runOptionSetForCopy, type RecordedRunOptionSet, type StoredOptionParticipation } from '../tools/handlers/option-participation.js';

export interface SavedRunContextFactsRead {
  readonly graph_hash?: string;
  /** The canonical read's selected Run occurrence, including stale/unknown reads. */
  readonly run_revision?: number | null;
  readonly run_revision_source?: 'recorded' | 'legacy_unknown';
  readonly analysis_state?: unknown;
  readonly analysis_result?: unknown;
  readonly raw?: unknown;
  /** The selected Run's existing evaluated-product carrier, bound by the canonical read. */
  readonly identity_evaluated?: ReadonlySet<string>;
  /** This selected Run's recorded carrier, already read through the canonical participation reader. */
  readonly option_participation?: StoredOptionParticipation;
  /** Projected from the SAME selected fact by the canonical graph read; no snapshot rides in analysis_result. */
  readonly run_option_set?: RecordedRunOptionSet;
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
  const revision = read.run_revision_source === undefined ? {} : {
    selected_run_revision: read.run_revision ?? null, selected_run_revision_source: read.run_revision_source,
  };
  const selected = runExplanationChip(scenarioId, {
    graphHash: read.graph_hash, analysisState: read.analysis_state, analysisResult: read.analysis_result,
  });
  if (selected === null) return revision;
  const projected = analysisResultForAgent(read.analysis_result, undefined, true, read.raw) as Record<string, unknown>;
  const verdict = asVerdictState(read.constraint_verdict_state);
  const checks = !runToolOutputLicensesLeader({ claim_permissions: permissions })
    ? limitChecksForAgent(read.raw, read.limit_verdicts, read.identity_evaluated,
      new Set((read.run_option_set ?? runOptionSetForCopy(undefined, read.option_participation, read.raw)).leftOut
        .map(o => o.option_id))) : undefined;
  return {
    ...revision,
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

/** Only CEE-owned licensed members of the selected Run, inside the opt-in canonical section. */
export function runExplanationContextFacts(
  scenarioId: string, read: SavedRunContextFactsRead,
  analysis: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const revision = read.run_revision_source === undefined || analysis?.selected_run_revision_source !== undefined ? {} : {
    selected_run_revision: read.run_revision ?? null, selected_run_revision_source: read.run_revision_source,
  };
  if (analysis === undefined || runExplanationChip(scenarioId, {
    graphHash: read.graph_hash, analysisState: read.analysis_state, analysisResult: read.analysis_result,
  }) === null) return revision;
  const projected = analysisResultForAgent(read.analysis_result, read.raw, true) as Record<string, unknown>;
  const warnings = (projected.enrichment as { inference_warnings?: unknown } | undefined)?.inference_warnings;
  const rows = Array.isArray(warnings) ? warnings.filter((v): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v)) : [];
  const target = rows.find(w => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
  const leaderId = (read.analysis_result as { leading_option_id?: unknown } | undefined)?.leading_option_id;
  return {
    ...revision,
    claim_permissions: analysis.claim_permissions,
    ...(runToolOutputLicensesLeader(analysis) && (leaderId === null || typeof leaderId === 'string')
      ? { leading_option_id: leaderId } : {}),
    ...(projected.decision_sensitivity === undefined ? {} : { decision_sensitivity: projected.decision_sensitivity }),
    ...(target === undefined ? {} : { target_testability: {
      code: target.code,
      // The gated producer text, carried as `say` (never under a producer `message` key). Never the warning's own `say`:
      // that repeats analysis.goal_chance.say. The Explain route applies the asked-once rule to this `say` too.
      ...(typeof target.message === 'string' ? { say: target.message } : {}),
    } }),
    warning_codes: [...rows, ...(() => {
      const brief = (projected.enrichment as { decision_brief?: { warnings?: unknown } } | undefined)?.decision_brief;
      return Array.isArray(brief?.warnings) ? brief.warnings.filter((w): w is Record<string, unknown> =>
        w !== null && typeof w === 'object' && !Array.isArray(w)) : [];
    })()].flatMap(w => typeof w.code === 'string' && isCodeShaped(w.code) ? [w.code] : []),
  };
}
