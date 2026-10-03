import { planOf } from './plan.js';
import { POLICY } from './policy.js';
import type { GuidanceSignals, RenderedCopy, RowIdentity } from './types.js';

/** Python reference uses 39 code points, rstrip, then an ellipsis (40 in total). */
export function cut(label: string): string {
  const chars = Array.from(label);
  return chars.length <= 40 ? label : `${chars.slice(0, 39).join('').trimEnd()}…`;
}
export function midSentence(label: string): string {
  const chars = Array.from(label);
  return chars.length > 1 && /\p{Lu}/u.test(chars[0]) && /\p{Ll}/u.test(chars[1])
    ? chars[0].toLowerCase() + chars.slice(1).join('') : label;
}
function pick(value: string | Readonly<Record<string, string>>, variant?: string): string | undefined {
  return typeof value === 'string' ? value : variant ? value[variant] : undefined;
}

/** No invented labels or raw-id fallback; unavailable copy fields are null. */
export function renderCopy(selected: RowIdentity, signals: GuidanceSignals): RenderedCopy {
  const tipping = signals['run.tipping_point'];
  if (selected.policy_id === 'RC-WHAT-CHANGES' && signals['run.kind'] === 'complete_current' && tipping?.status === 'found') {
    return { title: `${tipping.label} could change this.`, why: tipping.say,
      question: `Would you like to refine ${tipping.label}?` };
  }
  const row = POLICY.rows.find(r => r.policy_id === selected.policy_id)!;
  const options = signals['model.non_sq_option_ids'] ?? [];
  const labels = signals['model.option_labels'] ?? {};
  // #2465 types the goal label `string | null`; null is "no label", never a value to render (HARNESS 5938345968 note 3).
  const fills: Record<string, string | undefined> = { goal_label: signals['model.goal_label'] ?? undefined };
  const link = signals['model.goal_path_links']?.find(l => l.link_id === selected.item);
  const factor = signals['model.goal_path_factors']?.find(f => f.factor_id === selected.item);
  if (link) Object.assign(fills, { from_label: link.from_label, to_label: link.to_label,
    item_label: `${link.from_label} → ${link.to_label}`, option_count: String(link.option_ids.filter(id => options.includes(id)).length) });
  else if (factor) Object.assign(fills, { item_label: factor.label, factor_label: factor.label });
  const sensitive = signals['run.decision_sensitivity']?.most_sensitive;
  if (sensitive) fills.factor_label = sensitive.label;
  if (options.length === 1) fills.option_label = labels[options[0]];
  const plan = planOf(signals);
  if (plan) Object.assign(fills, { plan_label: labels[plan], leader_label: labels[plan] });
  const horizon = signals['model.goal_horizon'];
  if (horizon?.months) fills.horizon = horizon.months === 1 ? 'a month from now' : `${horizon.months} months from now`;
  else if (horizon?.deadline) fills.horizon = horizon.deadline;
  const edits = signals['since_run.goal_path_user_edits'];
  if (edits?.status === 'available') {
    fills.edit_count = String(edits.edits.length);
    if (edits.edits.every(e => e.label)) fills.edit_summary = edits.edits.map(e => e.label).join(', ');
  }
  /**
   * ONE pass over the TEMPLATE's own placeholders. A user's label is inserted verbatim and never re-scanned, so a label
   * that itself contains `{…}` neither blanks the copy nor pulls in another field (HARNESS 5938345968 note 4). Any
   * placeholder without a value makes the whole field null: never an unresolved template.
   */
  function fill(template?: string): string | null {
    if (template === undefined) return null;
    let missing = false;
    const out = template.replace(/\{([a-z_]+)\}/gu, (_match, key: string, offset: number) => {
      const value = fills[key];
      if (value === undefined) { missing = true; return ''; }
      return ['option_label', 'plan_label', 'leader_label'].includes(key) ? `‘${cut(value)}’` : cut(offset === 0 ? value : midSentence(value));
    });
    return missing ? null : out;
  }
  let question = pick(row.reasoning_question, selected.variant);
  if (selected.policy_id === 'RC-PREMORTEM') question = pick(row.reasoning_question, fills.horizon ? 'dated' : 'undated');
  if (selected.policy_id === 'RC-WHAT-CHANGES') question = pick(row.reasoning_question,
    sensitive?.range === 'olumi_assumed' ? 'range_olumi_assumed' : 'range_yours_or_unknown');
  return { title: fill(pick(row.short_copy, selected.variant)), why: fill(pick(row.why_now, selected.variant)), question: fill(question) };
}
