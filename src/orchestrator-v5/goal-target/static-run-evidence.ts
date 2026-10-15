/** Evidence reader used by the existing goal-chance licence and its horizon read gate. No result-statistic inference. */
export const STATIC_MODEL_SCOPE_NOTE = 'Static model; not a forecast to a date.';
export const STATIC_INPUTS_NOT_RECORDED = 'The inputs needed to verify this static calculation were not retained. Run the analysis again on the saved model.';
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));
const operators: Readonly<Record<string, string>> = { at_least: '>=', above: '>', at_most: '<=', below: '<' };

/** Only the existing licence's request-bound LEVEL carrier can attest a static calculation. Older inferred deltas cannot. */
export function recordedStaticLevelEvidence(result: unknown): {
  readonly goal_id: string; readonly label?: string; readonly target: number; readonly unit: string; readonly comparator: string;
  readonly encoded_target: number; readonly baseline: number; readonly encoded_baseline: number;
  readonly option_ids: readonly string[]; readonly by_date?: string;
} | undefined {
  const r = rec(result), snapshot = rec(r?.input_snapshot), goal = rec(snapshot?.goal);
  const warnings = [r?.inference_warnings, rec(r?.enrichment)?.inference_warnings].flatMap(v => Array.isArray(v) ? v : [])
    .map(rec).filter((w): w is Rec => w?.code === 'GOAL_CHANCE_LICENSED');
  if (warnings.length !== 1 || snapshot === undefined || goal === undefined
    || typeof snapshot.sent_digest !== 'string' || !/^[a-f0-9]{64}$/u.test(snapshot.sent_digest)) return undefined;
  const licence = warnings[0]!, target = rec(licence.target), sent = rec(licence.sent_threshold);
  if (!Array.isArray(licence.notes) || !licence.notes.includes(STATIC_MODEL_SCOPE_NOTE)
    || target?.frame !== 'level' || sent?.frame !== 'level' || sent.field !== 'goal_threshold'
    || !finite(target.value) || !finite(sent.value) || !finite(sent.baseline)
    || typeof goal.node_id !== 'string' || licence.goal_node_id !== goal.node_id
    || goal.frame !== 'level' || target.value !== goal.target_raw || typeof target.unit !== 'string' || target.unit !== goal.unit
    || typeof target.comparator !== 'string' || operators[target.comparator] !== goal.operator) return undefined;
  const factors = Array.isArray(snapshot.factors) ? snapshot.factors.map(rec) : [];
  const bases = factors.filter(f => f?.factor_id === goal.node_id);
  const base = bases.length === 1 ? bases[0] : undefined;
  if (!finite(base?.raw) || !finite(base.encoded) || base.unit !== goal.unit || !close(base.encoded, sent.baseline)
    || base.raw === 0 || base.encoded === 0 || !close(sent.value, target.value * base.encoded / base.raw)) return undefined;
  const options = Array.isArray(snapshot.options) ? snapshot.options.map(rec) : [];
  const ids = options.flatMap(o => typeof o?.option_id === 'string' ? [o.option_id] : []);
  if (!Array.isArray(licence.option_ids) || ids.length === 0 || new Set(ids).size !== ids.length
    || licence.option_ids.length !== ids.length || new Set(licence.option_ids).size !== ids.length || licence.option_ids.some(id => typeof id !== 'string' || !ids.includes(id))
    || !options.some(o => o?.is_baseline === true && o.option_id === sent.status_quo_option_id)) return undefined;
  return { goal_id: goal.node_id, ...(typeof goal.label === 'string' ? { label: goal.label } : {}),
    target: target.value, unit: target.unit, comparator: operators[target.comparator]!,
    encoded_target: sent.value, baseline: base.raw, encoded_baseline: sent.baseline, option_ids: ids,
    ...(typeof target.by_date === 'string' ? { by_date: target.by_date } : {}) };
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
  if (goal.goal_threshold_frame === 'delta') return { value, field: 'goal_threshold', frame: 'delta' };
  const observed = rec(goal.observed_state);
  if (goal.goal_threshold_frame !== 'level' || !finite(observed?.baseline)) return undefined;
  const baselines = (Array.isArray(sent.options) ? sent.options.map(rec) : []).filter(o => o?.is_baseline === true);
  const statusQuoId = baselines.length === 1 ? baselines[0]!.option_id ?? baselines[0]!.id : undefined;
  if (typeof statusQuoId !== 'string' || statusQuoId.trim() === '') return undefined;
  return { value, field: 'goal_threshold', frame: 'level', baseline: observed.baseline, status_quo_option_id: statusQuoId };
}
