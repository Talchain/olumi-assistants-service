import { POLICY } from './policy.js';
import { renderCopy } from './render.js';
import { stateKeyHash } from './state-key.js';
import type { GuidanceSignals, GuidanceState, GoalPathEdit, PolicyId, Priority, SelectedRow, Selection, StateKeyFields, SuppressionReason, Target, Variant } from './types.js';

const IDS = POLICY.rows.map(r => r.policy_id);
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sorted = (ids: readonly string[]) => [...ids].sort(compareId);
const EDIT_KINDS = new Set(['factor_value_edit', 'edge_strength_edit', 'link_effect_edit', 'option_intervention_edit',
  'goal_target_edit', 'limit_edit', 'prior_range_edit', 'structural_add', 'structural_add_edge', 'structural_remove', 'structural_delete']);
type Draft = { policy_id: PolicyId; priority: Priority; variant?: Variant; target?: Target; item?: string; fields: StateKeyFields };
type Evaluation = { candidates: Draft[]; reason?: SuppressionReason };
const none = (reason: SuppressionReason = 'not_eligible'): Evaluation => ({ candidates: [], reason });

function cooled(draft: Draft, guidance: GuidanceState, signals: GuidanceSignals): boolean {
  if (signals['user.explicit_request'] === draft.policy_id) return false;
  const perItem = draft.item && draft.policy_id === 'RC-STRENGTHEN-ITEM';
  const base = guidance[draft.policy_id];
  const record = perItem ? guidance[`${draft.policy_id}:${draft.item}`]
    ?? (base?.state_key_fields?.item_id === draft.item ? base : undefined) : base;
  if (!record || record.status === 'offered' && draft.policy_id !== 'RC-COACH-EDITS') return false;
  const recorded = record.state_key_hash ?? (record.state_key_fields ? stateKeyHash(record.state_key_fields) : undefined);
  // Incomplete recorded state cannot prove a relevant change: stay silent.
  return recorded === undefined || recorded === stateKeyHash(draft.fields);
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
    if (current && ['no_option_meets_limit', 'every_option_likely_breaks_limit'].includes(s['run.withheld_reason'] ?? '')) variant = 'W1';
    else if (options.length <= 1) variant = 'W2';
    else if (s['model.same_lever']) variant = 'W3';
    else if (options.length === 2 && s['model.status_quo_option_id'] === null) variant = 'W4';
    else if (current && s['run.withheld_reason'] === 'options_do_not_separate') variant = 'W5';
    else if (risks.length <= 1 && options.length >= 1) variant = 'W6';
    else if (s['model.goal_path_factor_ids'].length <= 2) variant = 'W7';
    if (!variant) return none();
    const target: Target = variant === 'W6' ? 'risks' : variant === 'W7' ? 'factors' : 'options';
    const fields: Record<string, string | readonly string[]> = { variant_id: variant, target, non_sq_option_ids: sorted(options) };
    if (variant === 'W1' || variant === 'W5') fields.withheld_reason = s['run.withheld_reason']!;
    if (target === 'risks') fields.risk_ids = sorted(risks);
    return { candidates: [{ policy_id: id, variant, target, priority: variant === 'W1' || variant === 'W2' ? 'P1' : variant === 'W7' ? 'P5' : 'P3', fields }] };
  }
  if (id === 'RC-WHAT-CHANGES') {
    if (s['run.kind'] === undefined || s['run.leader_licensed'] === undefined || !sensitivity || sensitivity.status === 'pending') return none('pending_signal');
    if (s['run.kind'] !== 'complete_current' || s['run.leader_licensed'] !== true || sensitivity.status !== 'measured') return none();
    if (!sensitivity.most_sensitive?.factor_id || !sensitivity.most_sensitive.label) return none('pending_signal');
    return { candidates: [{ policy_id: id, priority: 'P2', item: sensitivity.most_sensitive.factor_id,
      fields: { run_key: s['run.run_key'], factor_id: sensitivity.most_sensitive.factor_id, range: sensitivity.most_sensitive.range } }] };
  }
  if (id === 'RC-STRENGTHEN-ITEM') {
    const links = s['model.goal_path_links'], factors = s['model.goal_path_factors'], placeholders = s['model.placeholder_goal_links'];
    if (!links || !factors || !placeholders || !sensitivity || sensitivity.status === 'pending') return none('pending_signal');
    const orderedLinks = [...links].filter(l => Number.isFinite(l.goal_distance)).sort((a, b) => a.goal_distance - b.goal_distance || compareId(a.link_id, b.link_id));
    const orderedFactors = [...factors].filter(f => Number.isFinite(f.goal_distance)).sort((a, b) => a.goal_distance - b.goal_distance || compareId(a.factor_id, b.factor_id));
    const candidates: Draft[] = [];
    const linkDraft = (l: typeof orderedLinks[number], variant: Variant, priority: Priority): Draft => ({ policy_id: id, variant, priority, item: l.link_id,
      fields: { item_id: l.link_id, link_sizing: s['model.link_sizing']?.[l.link_id] ?? l.link_sizing, strength_band_hash: l.strength_band_hash } });
    const factorDraft = (f: typeof orderedFactors[number], variant: Variant, priority: Priority): Draft => ({ policy_id: id, variant, priority, item: f.factor_id,
      fields: { item_id: f.factor_id, value_authorship: s['model.value_authorship']?.[f.factor_id] ?? f.value_authorship, value_hash: f.value_hash } });
    for (const l of orderedLinks) if (placeholders.includes(l.link_id) && l.link_sizing !== 'user') candidates.push(linkDraft(l, 'S1', 'P1'));
    for (const f of orderedFactors) if (sensitivity.status === 'measured' && f.factor_id === sensitivity.most_sensitive?.factor_id
      && ['olumi_estimate', 'olumi_accepted'].includes(f.value_authorship)) candidates.push(factorDraft(f, 'S2', 'P2'));
    for (const l of orderedLinks) if (['placeholder', 'olumi_estimate'].includes(l.link_sizing)) candidates.push(linkDraft(l, 'S3L', 'P5'));
    for (const f of orderedFactors) if (f.value_authorship === 'olumi_estimate') candidates.push(factorDraft(f, 'S3V', 'P5'));
    return { candidates, reason: candidates.length ? undefined : 'not_eligible' };
  }
  if (id === 'RC-PREMORTEM') {
    if (s['model.goal_present'] === false || options?.length === 0) return none();
    const explicit = s['user.explicit_request'] === id;
    if (s['model.goal_present'] === undefined || !options || (!explicit && (!risks || s['run.kind'] === undefined || s['run.leader_licensed'] === undefined))) return none('pending_signal');
    if (!explicit && (s['run.kind'] !== 'complete_current' || !(s['run.leader_licensed'] === true || options.length === 1 && risks!.length >= 1))) return none();
    // A-WIDEN-SAME-KEY-HIDDEN; REASONING COACH ruling #85 / 5933526864:
    // there is no plan to stress when every option fails the limit.
    if (!explicit && ['no_option_meets_limit', 'every_option_likely_breaks_limit'].includes(s['run.withheld_reason'] ?? '')) return none();
    const plan = s['run.leader_licensed'] === true ? s['run.leader_option_id'] : options.length === 1 ? options[0] : undefined;
    if (!plan) return none('pending_signal');
    return { candidates: [{ policy_id: id, priority: 'P4', fields: { plan_option_id: plan, non_sq_option_ids: sorted(options) } }] };
  }
  const sinceRun = s['since_run.goal_path_user_edits'];
  if (!sinceRun || sinceRun.status === 'pending') return none('pending_signal');
  const edits = sinceRun.edits.filter(e => EDIT_KINDS.has(e.kind));
  if (!edits.length) return none();
  const fields = { edits: [...edits].sort((a, b) => compareId(a.entity_id, b.entity_id) || compareId(a.field, b.field)
    || compareId(a.after_hash, b.after_hash)).map((e: GoalPathEdit) => ({ kind: e.kind, entity_id: e.entity_id, field: e.field, after_hash: e.after_hash })) };
  return { candidates: [{ policy_id: id, priority: 'P5', fields }] };
}

function selected(d: Draft, s: GuidanceSignals): SelectedRow | undefined {
  const copy = renderCopy(d, s);
  if (copy.title === null || d.policy_id !== 'RC-COACH-EDITS' && (copy.why === null || copy.question === null)) return undefined;
  let primary_action: SelectedRow['primary_action'];
  if (d.policy_id === 'RC-WIDEN') {
    const action = POLICY.rows[0].primary_action;
    primary_action = { label: action.label[d.target!], action_kind: action.action_kind, intent: action.intent[d.target!] };
  } else if (d.policy_id === 'RC-WHAT-CHANGES') {
    const action = s['run.decision_sensitivity']?.most_sensitive?.range === 'olumi_assumed'
      ? POLICY.rows[1].primary_action.when_range_olumi_assumed : POLICY.rows[1].primary_action.otherwise;
    primary_action = { label: action.label, action_kind: action.action_kind,
      ...(action.action_kind === 'edit_inline' ? { target: d.item } : {}) };
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
    const requested = signals['user.explicit_request'];
    const mayRun = requested && IDS.includes(requested) && (requested !== 'RC-PREMORTEM'
      || signals['model.goal_present'] === true && (signals['model.non_sq_option_ids']?.length ?? 0) >= 1);
    return { ...suppressAll('not_eligible'), ...(mayRun ? { runs_method: requested } : {}) };
  }
  const eligible: SelectedRow[] = [];
  const suppressed: { policy_id: PolicyId; reason: SuppressionReason }[] = [];
  for (const id of IDS) {
    const evaluation = evaluate(id, signals);
    let reason: SuppressionReason = evaluation.reason ?? 'not_eligible';
    let pick: SelectedRow | undefined;
    for (const draft of evaluation.candidates) {
      if (cooled(draft, guidance, signals)) { reason = 'cooldown'; continue; }
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
