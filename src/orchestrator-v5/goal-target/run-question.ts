/** Read-only question/scope projection owned by the goal-chance licence. No store or output-statistic inference. */
import type { GoalRecord } from './goal-record.js';
import type { RunEvidence } from '../agent-lane/run-evidence.js';
import { askedQuestionOf, dispatchedQuestionOf, assessEvaluatedQuestionScope, STATIC_LEVEL_CAPABILITY } from './run-question-scope.js';
export { STATIC_LEVEL_CAPABILITY, assessRunQuestionReadiness } from './run-question-scope.js';
import { sentDigest } from '../tools/handlers/run-input-digest.js';
import { recordedStaticLevelEvidence, STATIC_MODEL_SCOPE_NOTE } from './static-run-evidence.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The merged selected-Run hook is the one evidence type; no parallel carrier. */
export type SelectedRunEvidence = RunEvidence;

export interface RunQuestionSide {
  readonly quantity: { readonly node_id: string; readonly label?: string };
  readonly target?: number;
  readonly comparator?: string;
  readonly unit?: string;
  readonly frame?: string;
  readonly horizon?: GoalRecord['horizon'];
  readonly reference?: string;
  readonly period?: GoalRecord['period'];
  readonly option_ids?: readonly string[];
  readonly baseline?: number;
  readonly encoded_target?: number;
  readonly encoded_baseline?: number;
  readonly scope?: 'static';
}

export interface RunQuestionScope {
  readonly status: 'supported_static' | 'invalid' | 'unverified' | 'outside_static_scope';
  readonly can_show_goal_chance: boolean;
  readonly reasons: readonly string[];
  readonly note?: typeof STATIC_MODEL_SCOPE_NOTE;
  readonly capability?: typeof STATIC_LEVEL_CAPABILITY;
  readonly dispatched_input_digest?: string;
}

export interface RunQuestion {
  readonly run_id: string | null;
  readonly fact_row_id: string | null;
  readonly evaluated_scenario_revision: number | null;
  readonly asked: RunQuestionSide | null;
  readonly calculated: RunQuestionSide | null;
  readonly omitted: readonly { readonly field: string; readonly reason: string; readonly asked?: unknown }[];
  readonly scope: RunQuestionScope;
  readonly evidence: { readonly status: 'verified' | 'partial' | 'unverified'; readonly missing: readonly string[]; readonly dispatched_input_digest: string | null };
}

const questionText = (v: unknown): string | undefined => typeof v === 'string' && v.trim() !== '' ? v : undefined;
const questionNumber = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Projection of ONE saved Run. No current graph argument exists deliberately. A historical model is usable only when its
 * immutable revision equals this occurrence's evaluated revision. A digest is not a recoverable request; missing fields
 * remain missing, even if today's model, the percentiles or another screen appear to agree.
 */
export function deriveRunQuestion(input: {
  readonly runEvidence?: SelectedRunEvidence;
  readonly storedResult?: unknown;
  readonly historicalModel?: { readonly revision: number; readonly graph: unknown };
  readonly dispatchedRequest?: unknown;
  /** The licence owner’s verified capability assessment of these exact inputs, not an output-based inference. */
  readonly evaluatedScope?: RunQuestionScope;
}): RunQuestion {
  const evidence = input.runEvidence;
  const suppliedSnapshot = evidence?.inputSnapshot === undefined && isRec(input.storedResult)
    ? input.storedResult.input_snapshot : evidence?.inputSnapshot;
  const snapshot = isRec(suppliedSnapshot) ? suppliedSnapshot : undefined;
  const goal = isRec(snapshot?.goal) ? snapshot.goal : undefined;
  const revision = evidence?.occurrence?.evaluated_scenario_revision;
  const evaluatedRevision = typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
  const saved = evaluatedRevision !== null && input.historicalModel?.revision === evaluatedRevision ? input.historicalModel.graph : undefined;
  const resultId = isRec(input.storedResult) ? questionText(input.storedResult.run_id) : undefined;
  const runId = questionText(evidence?.runId) ?? resultId ?? null;
  const missing: string[] = [];
  if (snapshot === undefined) missing.push('input_snapshot');
  if (evaluatedRevision === null) missing.push('evaluated_scenario_revision');
  if (questionText(evidence?.occurrence?.fact_row_id) === undefined) missing.push('fact_row_id');
  if (saved === undefined) missing.push('historical_model_at_evaluated_revision');
  if (runId === null || (resultId !== undefined && evidence?.runId !== undefined && resultId !== evidence.runId)) missing.push('selected_run_identity');
  const goalId = questionText(goal?.node_id) ?? (isRec(input.dispatchedRequest) ? questionText(input.dispatchedRequest.goal_node_id) : undefined);
  const identityMismatch = resultId !== undefined && evidence?.runId !== undefined && resultId !== evidence.runId;
  const recorded = identityMismatch ? undefined
    : recordedStaticLevelEvidence({ ...(isRec(input.storedResult) ? input.storedResult : {}), input_snapshot: snapshot });
  const recordedAsked: RunQuestionSide | null = recorded === undefined ? null : {
    quantity: { node_id: recorded.goal_id, ...(recorded.label === undefined ? {} : { label: recorded.label }) },
    target: recorded.target, comparator: recorded.comparator, unit: recorded.unit, frame: 'level',
    ...(recorded.by_date === undefined ? {} : { horizon: { as_stated: recorded.by_date } }),
  };
  const asked = saved === undefined || goalId === undefined ? recordedAsked : askedQuestionOf(saved, goalId);
  // The final request is usable only when the selected Run's own existing digest binds it.
  const requestBound = isRec(input.dispatchedRequest) && snapshot?.sent_digest === sentDigest(input.dispatchedRequest);
  const exact = requestBound ? dispatchedQuestionOf(input.dispatchedRequest) : null;
  const evaluatedInputs: RunQuestionSide | null = exact ?? (recorded === undefined ? null : {
    ...recordedAsked!, option_ids: recorded.option_ids, baseline: recorded.baseline, encoded_baseline: recorded.encoded_baseline,
    encoded_target: recorded.encoded_target, horizon: undefined, scope: 'static' as const,
  }) ?? (goal === undefined || goalId === undefined ? null : {
    quantity: { node_id: goalId, ...(questionText(goal.label) === undefined ? {} : { label: String(goal.label) }) },
    target: questionNumber(goal.target_raw), unit: questionText(goal.unit), frame: questionText(goal.frame), comparator: questionText(goal.operator),
    option_ids: (Array.isArray(snapshot?.options) ? snapshot.options.filter(isRec) : []).flatMap(o => typeof o.option_id === 'string' ? [o.option_id] : []),
  });
  // The stored licence can attest the calculation, but cannot recover an original horizon/reference it never retained.
  if (saved === undefined) missing.push('asked_horizon_and_reference_at_evaluated_revision', 'asked_options_at_evaluated_revision');
  if (exact === null && recorded === undefined) missing.push('dispatched_goal_threshold', 'dispatched_goal_baseline');
  const scope: RunQuestionScope = identityMismatch || runId === null
    ? { status: 'unverified' as const, can_show_goal_chance: false, reasons: [identityMismatch ? 'selected_run_identity_mismatch' : 'selected_run_identity_not_recorded'] }
    : saved !== undefined && goalId !== undefined && exact !== null ? (input.evaluatedScope !== undefined && input.evaluatedScope.dispatched_input_digest === snapshot?.sent_digest ? input.evaluatedScope
      : assessEvaluatedQuestionScope(saved, input.dispatchedRequest, goalId))
    : recorded !== undefined ? { status: 'supported_static' as const, can_show_goal_chance: true, reasons: [], note: STATIC_MODEL_SCOPE_NOTE, capability: STATIC_LEVEL_CAPABILITY,
      dispatched_input_digest: questionText(snapshot?.sent_digest) }
    : { status: 'unverified' as const, can_show_goal_chance: false, reasons: ['evaluated_question_not_fully_recorded'] };
  const calculated = evaluatedInputs === null || scope.status !== 'supported_static' ? evaluatedInputs
    : { ...evaluatedInputs, scope: 'static' as const };
  const omitted = [
    ...(asked?.horizon === undefined ? [] : [{ field: 'horizon', reason: scope.status === 'supported_static' ? 'not_calculated' : 'not_verified', asked: asked.horizon }]),
    ...missing.map(field => ({ field, reason: 'not_recorded' })),
  ];
  return { run_id: runId, fact_row_id: questionText(evidence?.occurrence?.fact_row_id) ?? null,
    evaluated_scenario_revision: evaluatedRevision, asked, calculated, omitted, scope,
    evidence: { status: missing.length === 0 ? 'verified' : calculated === null ? 'unverified' : 'partial', missing,
      dispatched_input_digest: questionText(snapshot?.sent_digest) ?? null } };
}

