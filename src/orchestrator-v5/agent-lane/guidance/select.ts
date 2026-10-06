import { POLICY } from './policy.js';
import { renderCopy } from './render.js';
import { isDecisionPlan, methodPlanOf, planOf } from './plan.js';
import { stateKeyHash } from './state-key.js';
import type { GuidanceSignals, GuidanceState, GoalPathEdit, JsonValue, PolicyId, Priority, SelectedRow, Selection, StateKeyFields, SuppressionReason, Target, Variant } from './types.js';

const IDS = POLICY.rows.map(r => r.policy_id);
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sorted = (ids: readonly string[]) => [...ids].sort(compareId);
const SETTLED = new Set(['pressed', 'dismissed', 'completed']);
const LIMIT_REASONS = ['no_option_meets_limit', 'every_option_likely_breaks_limit'];
const EDIT_KINDS = new Set(['factor_value_edit', 'edge_strength_edit', 'link_effect_edit', 'option_intervention_edit',
  'goal_target_edit', 'limit_edit', 'prior_range_edit', 'structural_add', 'structural_add_edge', 'structural_remove', 'structural_delete']);
type Draft = { policy_id: PolicyId; priority: Priority; variant?: Variant; target?: Target; item?: string; fields: StateKeyFields };
type Evaluation = { candidates: Draft[]; reason?: SuppressionReason };
const none = (reason: SuppressionReason = 'not_eligible'): Evaluation => ({ candidates: [], reason });

/** selection.state_key_rule: a null or absent member is OMITTED (canonical JSON keeps null, which would change the hash). */
function keyOf(fields: Readonly<Record<string, JsonValue | undefined>>): StateKeyFields {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * The coaching_state entry key (selection.entry_key): the policy id, or for a per-item row the policy id + ':' + the
 * hash of {item_id}. Never the raw id: node ids carry the user's words, and '->' fails the envelope KEY pattern.
 */
export function entryKey(policy_id: PolicyId, item?: string): string {
  return item === undefined ? policy_id : `${policy_id}:${stateKeyHash({ item_id: item })}`;
}

/** A pressed, dismissed or completed entry hides its row until the row's state key changes. */
function cooled(draft: Draft, guidance: GuidanceState): boolean {
  const record = guidance[entryKey(draft.policy_id, draft.policy_id === 'RC-STRENGTHEN-ITEM' ? draft.item : undefined)];
  if (!record || !SETTLED.has(record.status)) return false;
  const recorded = record.state_key_hash ?? (record.state_key_fields ? stateKeyHash(record.state_key_fields) : undefined);
  return recorded === stateKeyHash(draft.fields);
}

type Candidate = { variant: Variant; priority: Priority; items: string[]; kind: 'link' | 'factor' };
/** Every Strengthen variant that holds, before cooldown, each with its items in pick order (goal distance, then id). */
function strengthenCandidates(s: GuidanceSignals): Candidate[] {
  const links = s['model.goal_path_links'] ?? [], factors = s['model.goal_path_factors'] ?? [];
  const distance = new Map<string, number>([...links.map(l => [l.link_id, l.goal_distance] as const),
    ...factors.map(f => [f.factor_id, f.goal_distance] as const)]);
  const ordered = (ids: readonly string[]) => [...ids].sort((a, b) => (distance.get(a) ?? 99) - (distance.get(b) ?? 99) || compareId(a, b));
  const out: Candidate[] = [];
  const s1 = ordered((s['model.placeholder_goal_links'] ?? []).filter(id => links.some(l => l.link_id === id)));
  if (s1.length) out.push({ variant: 'S1', priority: 'P1', items: s1, kind: 'link' });
  const sensitivity = s['run.decision_sensitivity'];
  const most = sensitivity?.most_sensitive?.factor_id;
  const mostFactor = factors.find(f => f.factor_id === most);
  if (sensitivity?.status === 'measured' && mostFactor && ['olumi_estimate', 'olumi_accepted'].includes(mostFactor.value_authorship)) {
    out.push({ variant: 'S2', priority: 'P2', items: [mostFactor.factor_id], kind: 'factor' });
  }
  const s3l = ordered(links.filter(l => l.link_sizing === 'placeholder' || l.link_sizing === 'olumi_estimate').map(l => l.link_id));
  if (s3l.length) out.push({ variant: 'S3L', priority: 'P5', items: s3l, kind: 'link' });
  const s3v = ordered(factors.filter(f => f.value_authorship === 'olumi_estimate').map(f => f.factor_id));
  if (s3v.length) out.push({ variant: 'S3V', priority: 'P5', items: s3v, kind: 'factor' });
  return out;
}

function itemKey(s: GuidanceSignals, item: string, kind: 'link' | 'factor'): StateKeyFields {
  if (kind === 'link') {
    const l = s['model.goal_path_links']!.find(x => x.link_id === item)!;
    return keyOf({ item_id: item, link_sizing: l.link_sizing, value_hash: l.value_hash });
  }
  const f = s['model.goal_path_factors']!.find(x => x.factor_id === item)!;
  return keyOf({ item_id: item, value_authorship: f.value_authorship, value_hash: f.value_hash });
}

/** method_turns.RC-WHAT-CHANGES.honest_limit.item: the Strengthen pick order S1, then S3L, then S3V (no cooldown). */
function honestLimitItem(s: GuidanceSignals): string | undefined {
  return strengthenCandidates(s).find(c => c.variant !== 'S2')?.items[0];
}

function evaluate(id: PolicyId, s: GuidanceSignals): Evaluation {
  const options = s['model.non_sq_option_ids'];
  const risks = s['model.risk_ids'];
  const sensitivity = s['run.decision_sensitivity'];
  if (id === 'RC-WIDEN') {
    if (s['model.goal_present'] === false) return none();
    if (s['model.goal_present'] === undefined || s['model.goal_label'] === undefined || !options || !risks
      || s['model.status_quo_option_id'] === undefined || s['model.same_lever'] === undefined
      || !s['model.goal_path_factor_ids'] || s['run.kind'] === undefined || s['run.withheld_reason'] === undefined) return none('pending_signal');
    const current = s['run.kind'] === 'complete_current';
    let variant: Variant | undefined;
    if (current && LIMIT_REASONS.includes(s['run.withheld_reason'] ?? '')) variant = 'W1';
    else if (options.length === 0) variant = 'W2Z';
    else if (options.length === 1) variant = 'W2';
    else if (s['model.same_lever']) variant = 'W3';
    else if (options.length === 2 && s['model.status_quo_option_id'] === null) variant = 'W4';
    else if (current && s['run.withheld_reason'] === 'options_do_not_separate') variant = 'W5';
    else if (risks.length <= 1) variant = 'W6';
    else if (s['model.goal_path_factor_ids'].length <= 2) variant = 'W7';
    // cooldown_scope: the first variant that holds is the ONLY candidate, so a cooled Widen never falls through.
    if (!variant) return none();
    const target: Target = variant === 'W6' ? 'risks' : variant === 'W7' ? 'factors' : 'options';
    const fields: Record<string, JsonValue | undefined> = { variant_id: variant, target, non_sq_option_ids: sorted(options) };
    if (variant === 'W1' || variant === 'W5') fields.withheld_reason = s['run.withheld_reason'];
    if (target === 'risks') fields.risk_ids = sorted(risks);
    const priority: Priority = variant === 'W1' || variant === 'W2Z' || variant === 'W2' ? 'P1' : variant === 'W7' ? 'P5' : 'P3';
    return { candidates: [{ policy_id: id, variant, target, priority, fields: keyOf(fields) }] };
  }
  if (id === 'RC-WHAT-CHANGES') {
    const tipping = s['run.tipping_point'];
    if (tipping?.status === 'found') {
      if (s['run.kind'] !== 'complete_current') return none();
      if (!s['run.run_key']) return none('pending_signal');
      return { candidates: [{ policy_id: id, priority: 'P2', item: tipping.factor_id,
        fields: keyOf({ run_key: s['run.run_key'], factor_id: tipping.factor_id,
          threshold: tipping.threshold, direction: tipping.direction }) }] };
    }
    if (s['run.kind'] === undefined || s['run.leader_licensed'] === undefined || !sensitivity || sensitivity.status === 'pending') return none('pending_signal');
    if (s['run.kind'] !== 'complete_current' || s['run.leader_licensed'] !== true || sensitivity.status !== 'measured') return none();
    if (!sensitivity.most_sensitive?.factor_id || !sensitivity.most_sensitive.label) return none('pending_signal');
    return { candidates: [{ policy_id: id, priority: 'P2', item: sensitivity.most_sensitive.factor_id,
      fields: keyOf({ run_key: s['run.run_key'], factor_id: sensitivity.most_sensitive.factor_id, range: sensitivity.most_sensitive.range }) }] };
  }
  if (id === 'RC-STRENGTHEN-ITEM') {
    if (!s['model.goal_path_links'] || !s['model.goal_path_factors'] || !s['model.placeholder_goal_links'] || !sensitivity
      || sensitivity.status === 'pending') return none('pending_signal');
    // Never a generic "Strengthen the model": every candidate names one item; a cooled item falls through (cooldown_scope).
    const candidates: Draft[] = strengthenCandidates(s).flatMap(c => c.items.map(item =>
      ({ policy_id: id, variant: c.variant, priority: c.priority, item, fields: itemKey(s, item, c.kind) })));
    return { candidates, reason: candidates.length ? undefined : 'not_eligible' };
  }
  if (id === 'RC-PREMORTEM') {
    if (s['model.goal_present'] === false || options?.length === 0) return none();
    if (s['model.goal_present'] === undefined || !options || !risks || s['run.kind'] === undefined || s['run.leader_licensed'] === undefined) return none('pending_signal');
    if (s['run.kind'] !== 'complete_current' || !(s['run.leader_licensed'] === true || options.length === 1 && risks.length >= 1)) return none();
    // A-WIDEN-SAME-KEY-HIDDEN; REASONING COACH ruling #85 / 5933526864:
    // there is no plan to stress when every option fails the limit.
    if (LIMIT_REASONS.includes(s['run.withheld_reason'] ?? '')) return none();
    return { candidates: [{ policy_id: id, priority: 'P4', fields: keyOf({ plan_option_id: planOf(s), non_sq_option_ids: sorted(options) }) }] };
  }
  const sinceRun = s['since_run.goal_path_user_edits'];
  if (!sinceRun || sinceRun.status === 'pending') return none('pending_signal');
  const edits = sinceRun.edits.filter(e => EDIT_KINDS.has(e.kind));
  if (!edits.length) return none();
  const fields = { edits: [...edits].sort((a, b) => compareId(a.entity_id, b.entity_id) || compareId(a.field, b.field)
    || compareId(a.after_hash, b.after_hash)).map((e: GoalPathEdit) => ({ kind: e.kind, entity_id: e.entity_id, field: e.field, after_hash: e.after_hash })) };
  return { candidates: [{ policy_id: id, priority: 'P5', fields }] };
}

/**
 * RC-WIDEN's variant and target on these signals, from the SAME evaluation the row uses (the Widen method turn's
 * inputs), or undefined when no variant holds. Never a second rule: a row and its method turn agree by construction.
 */
export function widenVariantOf(s: GuidanceSignals): { readonly variant: Variant; readonly target: Target } | undefined {
  const c = evaluate('RC-WIDEN', s).candidates[0];
  return c?.variant !== undefined && c.target !== undefined ? { variant: c.variant, target: c.target } : undefined;
}

function selected(d: Draft, s: GuidanceSignals): SelectedRow | undefined {
  const copy = renderCopy(d, s);
  if (copy.title === null || d.policy_id !== 'RC-COACH-EDITS' && (copy.why === null || copy.question === null)) return undefined;
  let primary_action: SelectedRow['primary_action'];
  if (d.policy_id === 'RC-WIDEN') {
    const action = POLICY.rows[0].primary_action;
    primary_action = { label: action.label[d.target!], action_kind: action.action_kind, intent: action.intent[d.target!] };
  } else if (d.policy_id === 'RC-WHAT-CHANGES') {
    if (s['run.tipping_point']?.status === 'found') {
      primary_action = { label: 'Talk it through', action_kind: 'discuss' };
    } else {
      const action = s['run.decision_sensitivity']?.most_sensitive?.range === 'olumi_assumed'
        ? POLICY.rows[1].primary_action.when_range_olumi_assumed : POLICY.rows[1].primary_action.otherwise;
      primary_action = { label: action.label, action_kind: action.action_kind,
        ...(action.action_kind === 'edit_inline' ? { target: d.item } : {}) };
    }
  } else if (d.policy_id === 'RC-STRENGTHEN-ITEM') primary_action = { label: POLICY.rows[2].primary_action.label, action_kind: 'edit_inline', target: d.item };
  else if (d.policy_id === 'RC-PREMORTEM') primary_action = { label: POLICY.rows[3].primary_action.label, action_kind: 'discuss', intent: 'pre_mortem' };
  else primary_action = { label: POLICY.rows[4].primary_action.label, action_kind: 'discuss' };
  return { policy_id: d.policy_id, priority: d.priority, ...(d.variant ? { variant: d.variant } : {}),
    ...(d.target ? { target: d.target } : {}), ...(d.item ? { item: d.item } : {}), primary_action, state_key_hash: stateKeyHash(d.fields), copy };
}

export function selectGuidance(signals: GuidanceSignals, guidance: GuidanceState): Selection {
  const suppressAll = (reason: SuppressionReason): Selection => ({ suppressed: IDS.map(policy_id => ({ policy_id, reason })) });
  if (signals['open.decision_point'] === true) return suppressAll('decision_point');
  if (signals['turn.request'] === 'run_result') return suppressAll('request_1');
  if (signals['open.decision_point'] === undefined || signals['turn.request'] === undefined) return suppressAll('pending_signal');
  if (signals['turn.request'] === 'method') {
    // method_turn_rule: run the asked method and offer no other method.
    const requested = signals['user.explicit_request'];
    if (!requested || !IDS.includes(requested)) return suppressAll('not_eligible');
    const options = signals['model.non_sq_option_ids'] ?? [];
    let mode: Pick<Selection, 'mode' | 'item' | 'choices'> = {};
    if (requested === 'RC-WHAT-CHANGES' && signals['run.decision_sensitivity']?.status !== 'measured'
      && !(signals['run.kind'] === 'complete_current' && signals['run.run_key']
        && signals['run.tipping_point']?.status === 'found')) {
      const item = honestLimitItem(signals);
      mode = { mode: 'honest_limit', ...(item ? { item } : {}) };
    }
    if (requested === 'RC-PREMORTEM' && methodPlanOf(signals) === undefined && options.length >= 1) {
      mode = isDecisionPlan(signals) ? { mode: 'decision_plan' } : { mode: 'choose_plan', choices: sorted(options) };
    }
    return { ...suppressAll('not_eligible'), runs_method: requested, ...mode };
  }
  const eligible: SelectedRow[] = [];
  const suppressed: { policy_id: PolicyId; reason: SuppressionReason }[] = [];
  for (const id of IDS) {
    const evaluation = evaluate(id, signals);
    let reason: SuppressionReason = evaluation.reason ?? 'not_eligible';
    let pick: SelectedRow | undefined;
    for (const draft of evaluation.candidates) {
      if (cooled(draft, guidance)) { reason = 'cooldown'; continue; }
      const row = selected(draft, signals);
      if (!row) { reason = 'pending_signal'; continue; }
      pick = row; break;
    }
    if (pick) eligible.push(pick); else suppressed.push({ policy_id: id, reason });
  }
  // Row order is the policy tie-break; WHAT-CHANGES precedes STRENGTHEN for the same item.
  const slot1 = eligible.filter(r => r.policy_id !== 'RC-COACH-EDITS').sort((a, b) => compareId(a.priority, b.priority)
    || IDS.indexOf(a.policy_id) - IDS.indexOf(b.policy_id))[0];
  const slot2 = eligible.find(r => r.policy_id === 'RC-COACH-EDITS');
  for (const row of eligible) if (row !== slot1 && row !== slot2) suppressed.push({ policy_id: row.policy_id, reason: 'budget' });
  return { ...(slot1 ? { slot1 } : {}), ...(slot2 ? { slot2 } : {}), suppressed };
}
