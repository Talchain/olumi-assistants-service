import { GoalConstraintSchema } from '../schemas/assist.js';

type Rec = Record<string, unknown>;
const records = (v: unknown): Rec[] => Array.isArray(v) ? v.filter((x): x is Rec => x !== null && typeof x === 'object' && !Array.isArray(x)) : [];
const record = (v: unknown): Rec => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : {};
// Lossless limit rows: the S5 scalar goal record does not expose these or their pending-question metadata.
const limitRows = (graph: unknown): Rec[] => records(record(graph).goal_constraints);

export const RETAINED_LIMIT_QUESTION = 'Do these describe the same limit?';
export const RETAINED_LIMIT_WITHHELD = 'The result for the full goal, including the joint chance with its limits, is withheld while the earlier and proposed limits have not been confirmed to describe the same quantity. Both limits remain recorded.';
export const RETAINED_LIMIT_QUANTITY_QUESTION = 'What forecast and basis should be used to evaluate this retained limit?';
export const RETAINED_LIMIT_QUANTITY_WITHHELD = 'The result for the full goal, including the joint chance with its limits, is withheld because a carried limit has no supported quantity in the revised model. The limit remains recorded; a forecast and its basis are needed to evaluate it.';
export const RETAINED_LIMIT_WITHHOLD_CODE = 'GOAL_FIGURES_RETAINED_LIMIT_UNRESOLVED';

/** Only the carry-forward's bound, still-pending question licenses this state. A dangling marker licenses nothing. */
export function unresolvedRetainedLimits(graph: unknown) {
  const rows = limitRows(graph);
  return rows.flatMap((row) => {
    const parsed = GoalConstraintSchema.safeParse(row);
    if (!parsed.success || parsed.data.role === 'goal_target') return [];
    const c = parsed.data;
    const m = c.retained_unresolved_limit;
    if (m === undefined) return [];
    if (m.reason === 'retained_limit_quantity_unresolved') {
      return m.role === 'original' && m.previous_constraint_id === c.constraint_id
        && m.proposed_constraint_ids.length === 0 && m.question === RETAINED_LIMIT_QUANTITY_QUESTION ? [c] : [];
    }
    if (m.question !== RETAINED_LIMIT_QUESTION) return [];
    const previous = rows.find((r) => r.constraint_id === m.previous_constraint_id);
    const origin = record(previous?.retained_unresolved_limit);
    if (previous === undefined || previous.role === 'goal_target' || origin.previous_constraint_id !== previous.constraint_id
      || origin.role !== 'original' || origin.state !== 'unscored'
      || origin.question !== m.question || origin.reason !== m.reason
      || JSON.stringify(origin.proposed_constraint_ids) !== JSON.stringify(m.proposed_constraint_ids)) return [];
    if (m.role === 'original' ? m.previous_constraint_id !== c.constraint_id : !m.proposed_constraint_ids.includes(c.constraint_id)) return [];
    if (!m.proposed_constraint_ids.every((id) => rows.some((r) => r.constraint_id === id && r.node_id !== previous.node_id
      && r.role !== 'goal_target' && r.value === previous.value && r.operator === previous.operator))) return [];
    return [c];
  });
}

/** Exempt connectivity only: no incident link, setting, target or other role may hide behind the question. */
export function retainedLimitOnlyNodeIds(graph: unknown): ReadonlySet<string> {
  const g = record(graph);
  const rows = limitRows(g);
  const held = unresolvedRetainedLimits(g);
  const nodes = records(g.nodes);
  const options = [...nodes.filter((n) => n.kind === 'option'), ...records(g.options)];
  return new Set(held.filter((c) => {
    const n = nodes.find((node) => node.id === c.node_id);
    return n !== undefined && ['factor', 'outcome', 'risk'].includes(String(n.kind)) && g.goal_node_id !== n.id
      && !records(g.edges).some((e) => e.from === n.id || e.to === n.id)
      && Object.keys(record(n.interventions)).length === 0
      && !options.some((o) => Object.prototype.hasOwnProperty.call(record(o.interventions), c.node_id))
      && rows.filter((r) => r.node_id === n.id).every((r) => held.some((h) => h.constraint_id === r.constraint_id));
  }).map((c) => c.node_id));
}

/** Existing unscored representation: remove only the wire frame; the saved figure, unit and frame stay intact. */
export function withholdRetainedLimitFrames<C>(graph: unknown, constraints: C): C {
  const held = new Set(unresolvedRetainedLimits(graph).map((c) => c.constraint_id));
  if (held.size === 0 || !Array.isArray(constraints)) return constraints;
  return constraints.map((c: unknown) => {
    const row = record(c);
    if (!held.has(String(row.constraint_id))) return c;
    const { value_frame: _frame, ...unscored } = row;
    return unscored;
  }) as C;
}

/** The limitation actually bound to the retained rows; equivalence alone never supplies a forecast. */
export function retainedLimitWithheldLine(graph: unknown): string {
  return unresolvedRetainedLimits(graph).some((c) => c.retained_unresolved_limit?.reason === 'retained_limit_quantity_unresolved')
    ? RETAINED_LIMIT_QUANTITY_WITHHELD : RETAINED_LIMIT_WITHHELD;
}
