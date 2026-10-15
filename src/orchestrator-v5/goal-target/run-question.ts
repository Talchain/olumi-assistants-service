/** Read-only question/scope projection owned by the goal-chance licence. No store or output-statistic inference. */
import { goalKindOf } from './goal-kind.js';
import { readGoalRecord, type GoalRecord } from './goal-record.js';
import { sentDigest } from '../tools/handlers/run-input-digest.js';
import { readDispatchedGoalThreshold, recordedStaticLevelEvidence, STATIC_MODEL_SCOPE_NOTE } from './static-run-evidence.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Read-only pass-through of ONE selected stored Run. Lane A owns the producer; absent never means zero. */
export interface SelectedRunEvidence {
  readonly runId?: string;
  readonly inputSnapshot?: unknown;
  readonly occurrence?: { readonly fact_row_id?: string; readonly evaluated_scenario_revision?: number | null };
}

/** Source inspection, not an engine simulation or a claim about a deployment. Time capability is outside this scope. */
export const STATIC_LEVEL_CAPABILITY = Object.freeze({
  scope: 'static' as const,
  level: 'baseline_plus_paired_option_change' as const,
  source: 'Inference-Service-Layer@a5725a158ce9431350eb1e805e9d9ff8db2dea64:_resolve_threshold_in_sample_frame',
  transport: 'plot-lite-service@58b3e3c4c6e8eb1df33cb66f4df129607962aaa9:resolvedGoalTarget',
});

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
const questionNodes = (graph: unknown): Rec[] => isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
const questionGoal = (graph: unknown, goalId: unknown): Rec | undefined => questionNodes(graph).find(n => n.kind === 'goal' && n.id === goalId);
const questionOptions = (graph: unknown): string[] => questionNodes(graph).flatMap(n => n.kind === 'option' && typeof n.id === 'string' ? [n.id] : []);
const questionNumber = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const sameQuestionNumber = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));

function askedQuestionOf(graph: unknown, goalId: string): RunQuestionSide | null {
  const goal = readGoalRecord(graph, goalId);
  const node = questionGoal(graph, goalId);
  const os = isRec(node?.observed_state) ? node.observed_state : undefined;
  const basis = isRec(node?.goal_target_basis) ? node.goal_target_basis : undefined;
  return goal === null ? null : {
    quantity: { node_id: goalId, label: goal.label },
    ...(goal.target?.raw === undefined ? {} : { target: goal.target.raw }),
    ...(goal.target?.comparator === undefined ? {} : { comparator: goal.target.comparator }),
    ...(goal.target?.unit === undefined ? {} : { unit: goal.target.unit }),
    ...(goal.target?.frame === undefined ? {} : { frame: goal.target.frame }),
    ...(goal.horizon === null ? {} : { horizon: goal.horizon }), option_ids: questionOptions(graph),
    ...(questionText(basis?.reference) === undefined ? {} : { reference: String(basis!.reference) }),
    ...(goal.period === undefined ? {} : { period: goal.period }),
    ...(questionNumber(os?.raw_value) === undefined ? {} : { baseline: questionNumber(os?.raw_value) }),
  };
}

function dispatchedQuestionOf(request: unknown): RunQuestionSide | null {
  if (!isRec(request) || typeof request.goal_node_id !== 'string') return null;
  const goal = questionGoal(request.graph, request.goal_node_id);
  if (goal === undefined) return null;
  const os = isRec(goal.observed_state) ? goal.observed_state : undefined;
  const operator = request.goal_direction === 'minimise' ? (request.goal_threshold_strict === true ? '<' : '<=')
    : (request.goal_threshold_strict === true ? '>' : '>=');
  return {
    quantity: { node_id: request.goal_node_id, ...(questionText(goal.label) === undefined ? {} : { label: String(goal.label) }) },
    target: questionNumber(goal.goal_threshold_raw), unit: questionText(goal.goal_threshold_unit),
    frame: questionText(goal.goal_threshold_frame), comparator: operator,
    encoded_target: questionNumber(request.goal_threshold) ?? questionNumber(goal.goal_threshold),
    baseline: questionNumber(os?.raw_value), encoded_baseline: questionNumber(os?.baseline),
    option_ids: (Array.isArray(request.options) ? request.options.filter(isRec) : []).flatMap(o => {
      const id = questionText(o.option_id) ?? questionText(o.id); return id === undefined ? [] : [id];
    }),
  };
}

/** Shared scope check over a frozen saved model and the FINAL dispatched request. Never reads output statistics. */
export function assessRunQuestionScope(savedGraph: unknown, dispatchedRequest: unknown, goalId: string): RunQuestionScope {
  const asked = askedQuestionOf(savedGraph, goalId), calculated = dispatchedQuestionOf(dispatchedRequest);
  if (asked === null) return { status: 'unverified', can_show_goal_chance: false, reasons: ['saved_question_not_recorded'] };
  const savedGoal = questionGoal(savedGraph, goalId);
  const basis = isRec(savedGoal?.goal_target_basis) ? savedGoal.goal_target_basis : undefined;
  const targetRows = isRec(savedGraph) && Array.isArray(savedGraph.goal_constraints)
    ? savedGraph.goal_constraints.filter(isRec).filter(row => row.role === 'goal_target') : [];
  // Existing over-period/condition-refusal owners keep their own calculation and truthful withholding reason.
  if (questionText(basis?.open_question) !== undefined || basis?.period_kind === 'over_period' || targetRows.length > 1
    || goalKindOf(savedGraph) !== 'level' || questionNodes(savedGraph).some(n => isRec(n.nonlinear_identity) && n.nonlinear_identity.operation === 'accumulation')
    || questionGoal(savedGraph, goalId)?.nonlinear_identity !== undefined
    || questionGoal(savedGraph, goalId)?.quantity_frame === 'change'
    || asked.frame !== 'level') return { status: 'outside_static_scope', can_show_goal_chance: false, reasons: ['outside_verified_static_level_scope'] };
  if (dispatchedRequest === undefined) {
    const missing = [asked.target === undefined ? 'target' : undefined, asked.comparator === undefined ? 'comparator' : undefined,
      asked.unit === undefined ? 'unit' : undefined, asked.baseline === undefined ? 'baseline' : undefined].filter((v): v is string => v !== undefined);
    // Readiness inspects the same saved question, but has no evaluated request and grants no figure permission.
    return { status: missing.length > 0 ? 'invalid' : 'unverified', can_show_goal_chance: false,
      reasons: missing.length > 0 ? missing.map(field => `missing_saved_${field}`) : ['not_yet_evaluated'],
      ...(missing.length === 0 ? { note: STATIC_MODEL_SCOPE_NOTE } : {}) };
  }
  if (calculated === null) return { status: 'unverified', can_show_goal_chance: false, reasons: ['dispatched_inputs_not_recorded'] };
  const sent = isRec(dispatchedRequest) ? dispatchedRequest : {};
  const goal = questionGoal(sent.graph, goalId), os = isRec(goal?.observed_state) ? goal.observed_state : undefined;
  const cap = questionNumber(goal?.goal_threshold_cap);
  const reasons: string[] = [];
  if (calculated.quantity.node_id !== goalId) reasons.push('wrong_goal');
  if (asked.frame !== calculated.frame) reasons.push('wrong_frame');
  if (asked.comparator === undefined || asked.comparator !== calculated.comparator) reasons.push('wrong_comparator');
  if (asked.unit === undefined || asked.unit !== calculated.unit || os?.unit !== asked.unit) reasons.push('wrong_or_missing_unit');
  if (asked.target === undefined || asked.target !== calculated.target) reasons.push('wrong_or_missing_target');
  if (cap === undefined || cap <= 0 || calculated.encoded_target === undefined || calculated.target === undefined
    || !sameQuestionNumber(calculated.encoded_target, calculated.target / cap)) reasons.push('unverified_target_conversion');
  if (calculated.baseline === undefined || calculated.encoded_baseline === undefined) reasons.push('missing_baseline');
  else if (asked.baseline === undefined || asked.baseline !== calculated.baseline) reasons.push('wrong_or_unverified_saved_baseline');
  else if (cap === undefined || !sameQuestionNumber(calculated.encoded_baseline, calculated.baseline / cap)
    || !sameQuestionNumber(questionNumber(os?.value) ?? NaN, calculated.encoded_baseline)) reasons.push('unverified_baseline_conversion');
  const optionIds = calculated.option_ids ?? [], askedIds = asked.option_ids ?? [];
  if (optionIds.length === 0 || optionIds.some(id => !askedIds.includes(id))) reasons.push('unverified_options');
  const sentThreshold = readDispatchedGoalThreshold(sent, goalId);
  if (sentThreshold?.frame !== 'level') reasons.push('unverified_dispatched_level_reference');
  if (reasons.length > 0) return { status: 'invalid', can_show_goal_chance: false, reasons };
  return { status: 'supported_static', can_show_goal_chance: true, reasons: [], note: STATIC_MODEL_SCOPE_NOTE };
}

/** Internal readiness classification; never an evaluated Run record or a new execution gate. */
export function assessRunQuestionReadiness(graph: unknown): RunQuestionScope {
  const goals = questionNodes(graph).filter(n => n.kind === 'goal' && typeof n.id === 'string');
  return goals.length === 1 ? assessRunQuestionScope(graph, undefined, String(goals[0]!.id))
    : { status: 'unverified', can_show_goal_chance: false, reasons: ['one_saved_goal_required'] };
}

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
    : saved !== undefined && goalId !== undefined && exact !== null ? assessRunQuestionScope(saved, input.dispatchedRequest, goalId)
    : recorded !== undefined ? { status: 'supported_static' as const, can_show_goal_chance: true, reasons: [], note: STATIC_MODEL_SCOPE_NOTE }
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

