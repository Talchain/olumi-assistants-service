import { POLICY } from './policy.js';
import type { GuidanceSignals, RenderedCopy, RowIdentity } from './types.js';

/** Python reference uses 39 code points, rstrip, then an ellipsis (40 in total). */
function cut(label: string): string {
  const chars = Array.from(label);
  return chars.length <= 40 ? label : `${chars.slice(0, 39).join('').trimEnd()}…`;
}
function midSentence(label: string): string {
  const chars = Array.from(label);
  return chars.length > 1 && /\p{Lu}/u.test(chars[0]) && /\p{Ll}/u.test(chars[1])
    ? chars[0].toLowerCase() + chars.slice(1).join('') : label;
}
function pick(value: string | Readonly<Record<string, string>>, variant?: string): string | undefined {
  return typeof value === 'string' ? value : variant ? value[variant] : undefined;
}

/** No invented labels or raw-id fallback; unavailable copy fields are null. */
export function renderCopy(selected: RowIdentity, signals: GuidanceSignals): RenderedCopy {
  const row = POLICY.rows.find(r => r.policy_id === selected.policy_id)!;
  const options = signals['model.non_sq_option_ids'] ?? [];
  const labels = signals['model.option_labels'] ?? {};
  const fills: Record<string, string | undefined> = { goal_label: signals['model.goal_label'] };
  const link = signals['model.goal_path_links']?.find(l => l.link_id === selected.item);
  const factor = signals['model.goal_path_factors']?.find(f => f.factor_id === selected.item);
  if (link) Object.assign(fills, { from_label: link.from_label, to_label: link.to_label,
    item_label: `${link.from_label} → ${link.to_label}`, option_count: String(link.option_ids.filter(id => options.includes(id)).length) });
  else if (factor) Object.assign(fills, { item_label: factor.label, factor_label: factor.label });
  const sensitive = signals['run.decision_sensitivity']?.most_sensitive;
  if (sensitive) fills.factor_label = sensitive.label;
  if (options.length === 1) fills.option_label = labels[options[0]];
  const plan = signals['run.leader_licensed'] === true ? signals['run.leader_option_id'] : options.length === 1 ? options[0] : undefined;
  if (plan) Object.assign(fills, { plan_label: labels[plan], leader_label: labels[plan] });
  const horizon = signals['model.goal_horizon'];
  if (horizon?.months) fills.horizon = horizon.months === 1 ? 'a month from now' : `${horizon.months} months from now`;
  else if (horizon?.deadline) fills.horizon = horizon.deadline;
  const edits = signals['since_run.goal_path_user_edits'];
  if (edits?.status === 'available') {
    fills.edit_count = String(edits.edits.length);
    if (edits.edits.every(e => e.label)) fills.edit_summary = edits.edits.map(e => e.label).join(', ');
  }
  function fill(template?: string): string | null {
    if (template === undefined) return null;
    let out = template;
    for (const [key, value] of Object.entries(fills)) {
      if (value === undefined) continue;
      const replacement = ['option_label', 'plan_label', 'leader_label'].includes(key) ? `‘${cut(value)}’`
        : cut(out.startsWith(`{${key}}`) ? value : midSentence(value));
      out = out.split(`{${key}}`).join(replacement);
    }
    return /\{[^}]+\}/u.test(out) ? null : out;
  }
  let question = pick(row.reasoning_question, selected.variant);
  if (selected.policy_id === 'RC-PREMORTEM') question = pick(row.reasoning_question, fills.horizon ? 'dated' : 'undated');
  if (selected.policy_id === 'RC-WHAT-CHANGES') question = pick(row.reasoning_question,
    sensitive?.range === 'olumi_assumed' ? 'range_olumi_assumed' : 'range_yours_or_unknown');
  return { title: fill(pick(row.short_copy, selected.variant)), why: fill(pick(row.why_now, selected.variant)), question: fill(question) };
}
