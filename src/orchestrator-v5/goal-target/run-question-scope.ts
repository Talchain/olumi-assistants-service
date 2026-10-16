/** The licence owner's scope kernel. Only thin record/transport readers; safe on the readiness import path. */
import { readGoalRecord } from './goal-record.js';
import { readDispatchedGoalThreshold, STATIC_MODEL_SCOPE_NOTE } from './static-run-evidence.js';
import type { RunQuestionSide, RunQuestionScope } from './run-question.js';
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Source inspection, not an engine simulation or a claim about a deployment. Time capability is outside this scope. */
export const STATIC_LEVEL_CAPABILITY = Object.freeze({
  scope: 'static' as const,
  supports_horizon: false,
  verification: 'source_contract' as const,
  level: 'baseline_plus_paired_option_change' as const,
  source: 'Inference-Service-Layer@a5725a158ce9431350eb1e805e9d9ff8db2dea64:_resolve_threshold_in_sample_frame',
  transport: 'plot-lite-service@58b3e3c4c6e8eb1df33cb66f4df129607962aaa9:resolvedGoalTarget',
});

const questionText = (v: unknown): string | undefined => typeof v === 'string' && v.trim() !== '' ? v : undefined;
const questionNodes = (graph: unknown): Rec[] => isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
const questionGoal = (graph: unknown, goalId: unknown): Rec | undefined => questionNodes(graph).find(n => n.kind === 'goal' && n.id === goalId);
const questionOptions = (graph: unknown): string[] => questionNodes(graph).flatMap(n => n.kind === 'option' && typeof n.id === 'string' ? [n.id] : []);
const questionNumber = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const sameQuestionNumber = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));

export function askedQuestionOf(graph: unknown, goalId: string): RunQuestionSide | null {
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

export function dispatchedQuestionOf(request: unknown): RunQuestionSide | null {
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
export function assessEvaluatedQuestionScope(savedGraph: unknown, dispatchedRequest: unknown, goalId: string, levelKind?: boolean): RunQuestionScope {
  const asked = askedQuestionOf(savedGraph, goalId), calculated = dispatchedQuestionOf(dispatchedRequest);
  if (asked === null) return { status: 'unverified', can_show_goal_chance: false, reasons: ['saved_question_not_recorded'] };
  const savedGoal = questionGoal(savedGraph, goalId);
  const basis = isRec(savedGoal?.goal_target_basis) ? savedGoal.goal_target_basis : undefined;
  const targetRows = isRec(savedGraph) && Array.isArray(savedGraph.goal_constraints)
    ? savedGraph.goal_constraints.filter(isRec).filter(row => row.role === 'goal_target') : [];
  // Existing over-period/condition-refusal owners keep their own calculation and truthful withholding reason.
  if (questionText(basis?.open_question) !== undefined || basis?.period_kind === 'over_period' || targetRows.length > 1
    || levelKind === false || questionNodes(savedGraph).some(n => isRec(n.nonlinear_identity) && n.nonlinear_identity.operation === 'accumulation')
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
  if (levelKind === undefined) return { status: 'unverified', can_show_goal_chance: false, reasons: ['engine_scope_not_verified'] };
  if (calculated === null) return { status: 'unverified', can_show_goal_chance: false, reasons: ['dispatched_inputs_not_recorded'] };
  // Existing missing-target/direction owners keep their precise refusal; no second generic reason is minted.
  if (asked.target === undefined || asked.comparator === undefined) return { status: 'unverified', can_show_goal_chance: false,
    reasons: [asked.target === undefined ? 'saved_target_not_recorded' : 'saved_comparator_not_recorded'] };
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
  if (sentThreshold?.frame !== 'level') {
    const referenceOptions = (Array.isArray(sent.options) ? sent.options.filter(isRec) : []).filter(o => o.is_baseline === true);
    if (reasons.length === 0 && referenceOptions.length !== 1) return { status: 'outside_static_scope', can_show_goal_chance: false,
      reasons: ['outside_verified_paired_reference_scope'] };
    reasons.push('unverified_dispatched_level_reference');
  }
  if (reasons.length > 0) return { status: 'invalid', can_show_goal_chance: false, reasons };
  return { status: 'supported_static', can_show_goal_chance: true, reasons: [], note: STATIC_MODEL_SCOPE_NOTE, capability: STATIC_LEVEL_CAPABILITY };
}

/** Internal readiness classification; never an evaluated Run record or a new execution gate. */
export function assessRunQuestionReadiness(graph: unknown): RunQuestionScope {
  const goals = questionNodes(graph).filter(n => n.kind === 'goal' && typeof n.id === 'string');
  return goals.length === 1 ? assessEvaluatedQuestionScope(graph, undefined, String(goals[0]!.id))
    : { status: 'unverified', can_show_goal_chance: false, reasons: ['one_saved_goal_required'] };
}

