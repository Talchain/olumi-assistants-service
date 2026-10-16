/** Evidence reader used by the existing goal-chance licence and its horizon read gate. No result-statistic inference. */
export const STATIC_MODEL_SCOPE_NOTE = 'Static model; not a forecast to a date.';
export const STATIC_INPUTS_NOT_RECORDED = 'The inputs needed to verify this static calculation were not retained. Run the analysis again on the saved model.';
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));

/** Read the Run's retained dispatched threshold and input snapshot. Licence wording never grants scope. */
export function recordedStaticLevelEvidence(result: unknown): {
  readonly goal_id: string; readonly label?: string; readonly target: number; readonly unit: string; readonly comparator: string;
  readonly encoded_target: number; readonly baseline: number; readonly encoded_baseline: number;
  readonly option_ids: readonly string[];
} | undefined {
  const r = rec(result), snapshot = rec(r?.input_snapshot), goal = rec(snapshot?.goal);
  // sent_threshold is the existing request-evidence carrier, not the licence's prose/form/target decision.
  const carriers = [r?.inference_warnings, rec(r?.enrichment)?.inference_warnings].flatMap(v => Array.isArray(v) ? v : [])
    .map(rec).filter((w): w is Rec => w?.code === 'GOAL_CHANCE_LICENSED');
  if (carriers.length !== 1 || snapshot === undefined || goal === undefined
    || typeof snapshot.sent_digest !== 'string' || !/^[a-f0-9]{64}$/u.test(snapshot.sent_digest)) return undefined;
  const sent = rec(carriers[0]!.sent_threshold);
  const display = rec(carriers[0]!.target);
  const comparator: Readonly<Record<string, string>> = { at_least: '>=', above: '>', at_most: '<=', below: '<' };
  // Display metadata may contradict the input record, but its presence or wording never establishes the calculation.
  if ((carriers[0]!.goal_node_id !== undefined && carriers[0]!.goal_node_id !== goal.node_id)
    || (display !== undefined && ((display.value !== undefined && display.value !== goal.target_raw)
      || (display.unit !== undefined && display.unit !== goal.unit)
      || (display.comparator !== undefined && comparator[String(display.comparator)] !== goal.operator)
      || (display.frame !== undefined && display.frame !== 'level')))) return undefined;
  if (sent?.frame !== 'level' || sent.field !== 'goal_threshold' || !finite(sent.value) || !finite(sent.baseline)
    || typeof goal.node_id !== 'string' || goal.node_id.trim() === '' || goal.frame !== 'level'
    || !finite(goal.target_raw) || typeof goal.unit !== 'string' || goal.unit.trim() === ''
    || !['>=', '>', '<=', '<'].includes(String(goal.operator))) return undefined;
  // PLoT defaults to maximise when no direction was dispatched. Strictness is retained by the snapshot's operator.
  if (goal.direction !== undefined && goal.direction !== 'maximise' && goal.direction !== 'minimise') return undefined;
  if (goal.direction === 'minimise' ? !['<=', '<'].includes(String(goal.operator)) : !['>=', '>'].includes(String(goal.operator))) return undefined;
  const factors = Array.isArray(snapshot.factors) ? snapshot.factors.map(rec) : [];
  const bases = factors.filter(f => f?.factor_id === goal.node_id);
  const base = bases.length === 1 ? bases[0] : undefined;
  if (!finite(base?.raw) || !finite(base.encoded) || base.unit !== goal.unit || !close(base.encoded, sent.baseline)) return undefined;
  const scale = base.raw !== 0 ? base.encoded / base.raw : goal.target_raw !== 0 ? sent.value / goal.target_raw : undefined;
  if (scale === undefined ? (base.encoded !== 0 || sent.value !== 0)
    : scale <= 0 || !close(base.encoded, base.raw * scale) || !close(sent.value, goal.target_raw * scale)) return undefined;
  const options = Array.isArray(snapshot.options) ? snapshot.options.map(rec) : [];
  const ids = options.flatMap(o => typeof o?.option_id === 'string' && o.option_id.trim() !== '' ? [o.option_id] : []);
  if (ids.length !== options.length || ids.length === 0 || new Set(ids).size !== ids.length
    || options.filter(o => o?.is_baseline === true).length !== 1
    || !options.some(o => o?.is_baseline === true && o.option_id === sent.status_quo_option_id)) return undefined;
  return { goal_id: goal.node_id, ...(typeof goal.label === 'string' ? { label: goal.label } : {}),
    target: goal.target_raw, unit: goal.unit, comparator: goal.operator as string,
    encoded_target: sent.value, baseline: base.raw, encoded_baseline: sent.baseline, option_ids: ids };
}

/** Classify a recorded level calculation for fail-closed readers; this never verifies or licenses it. */
export function hasRecordedLevelCalculation(result: unknown): boolean {
  const r = rec(result);
  return [r?.inference_warnings, rec(r?.enrichment)?.inference_warnings].flatMap(v => Array.isArray(v) ? v : []).some(raw => {
    const w = rec(raw);
    return w?.code === 'GOAL_CHANCE_LICENSED' && (rec(w.sent_threshold)?.frame === 'level'
      || Array.isArray(w.notes) && w.notes.includes(STATIC_MODEL_SCOPE_NOTE));
  });
}

/** PLoT selects a finite root/node threshold with one bound frame. No response statistics participate. */
export function readDispatchedGoalThreshold(request: unknown, goalId: unknown): {
  readonly value: number; readonly field: 'goal_threshold'; readonly frame: 'delta' | 'level';
  readonly baseline?: number; readonly status_quo_option_id?: string;
} | undefined {
  const sent = rec(request), graph = rec(sent?.graph);
  if (sent === undefined || sent.goal_node_id !== goalId || !Array.isArray(graph?.nodes)) return undefined;
  const goal = graph.nodes.map(rec).find(n => n?.id === goalId && n?.kind === 'goal');
  if (goal === undefined) return undefined;
  const root = sent.goal_threshold, node = goal.goal_threshold;
  if (root !== undefined && (!finite(root) || (node !== undefined && root !== node))) return undefined;
  const value = root ?? node;
  if (!finite(value)) return undefined;
  // ISL _resolve_change_threshold: a change quantity’s absolute target is the paired change from its defined zero.
  if (goal.goal_threshold_frame === 'delta' || (goal.goal_threshold_frame === 'change_abs' && goal.quantity_frame === 'change')) {
    return { value, field: 'goal_threshold', frame: 'delta' };
  }
  const observed = rec(goal.observed_state);
  if (goal.goal_threshold_frame !== 'level' || !finite(observed?.baseline)) return undefined;
  const baselines = (Array.isArray(sent.options) ? sent.options.map(rec) : []).filter(o => o?.is_baseline === true);
  const statusQuoId = baselines.length === 1 ? baselines[0]!.option_id ?? baselines[0]!.id : undefined;
  if (typeof statusQuoId !== 'string' || statusQuoId.trim() === '') return undefined;
  return { value, field: 'goal_threshold', frame: 'level', baseline: observed.baseline, status_quo_option_id: statusQuoId };
}
