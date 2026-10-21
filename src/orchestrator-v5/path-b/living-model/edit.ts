/**
 * THIN CORE EXPLICIT EDIT (20 Oct 2026): a canvas gesture, applied to the living model as a TYPED operation. PURE. No
 * reading of meaning is needed (the gesture says exactly what changes) and no graph delta is reverse-engineered: the
 * engine graph is then regenerated from the edited model, so the canvas never becomes a second writer of meaning.
 *  · The person made the edit, so the item becomes theirs: `source: 'user'` with no quote (their act, not their words).
 *  · A value the gesture gives on the model scale is converted to the person's units on the mapper's own frame, never
 *    guessed; an item with no frame yet refuses the edit.
 *  · Anything this slice cannot apply is refused with its reason, never half-applied.
 */
import type { LivingModelT } from '../../../schemas/living-model.js';
import { mapLivingModel } from './mapper.js';

/** The canvas gestures this slice applies, in the wire's own shapes (`@talchain/schemas` turn-payload). */
export type ExplicitEdit =
  | { readonly kind: 'factor_value_edit'; readonly target_id: string; readonly value: number; readonly raw_value?: number; readonly unit?: string }
  | { readonly kind: 'option_intervention_edit'; readonly option_id: string; readonly factor_id: string; readonly value: number }
  | { readonly kind: 'goal_target_edit'; readonly goal_node_id: string; readonly constraint_type: 'at_least' | 'at_most'; readonly raw_value: number; readonly unit: string }
  | { readonly kind: 'edge_strength_edit'; readonly from: string; readonly to: string; readonly magnitude: number; readonly direction_intent: 'preserve' | 'positive' | 'negative' }
  | { readonly kind: 'structural_rename'; readonly node_id: string; readonly label: string; readonly expected_label: string }
  | { readonly kind: 'structural_delete'; readonly removed_node_ids: readonly string[]; readonly removed_edges: readonly { readonly from: string; readonly to: string }[] }
  | { readonly kind: 'structural_add'; readonly node_id: string; readonly node_kind: string; readonly label: string }
  | { readonly kind: 'structural_add_edge'; readonly from: string; readonly to: string; readonly magnitude: number; readonly effect_direction: 'positive' | 'negative' }
  | { readonly kind: 'prior_range_edit'; readonly target_id: string; readonly range_min: number; readonly range_max: number; readonly distribution?: string }
  | { readonly kind: 'option_status_edit'; readonly option_node_id: string; readonly expected_status: 'feasible' | 'infeasible' | 'removed'; readonly status: 'feasible' | 'infeasible' | 'removed' };

const EXPLICIT_EDIT_KINDS: ReadonlySet<string> = new Set([
  'factor_value_edit', 'option_intervention_edit', 'goal_target_edit', 'edge_strength_edit',
  'structural_rename', 'structural_delete', 'structural_add', 'structural_add_edge', 'prior_range_edit', 'option_status_edit',
]);

/** A gesture this slice applies. The event's shape is the wire's own for its kind, already checked at ingress. */
export const isExplicitEdit = (event: { readonly kind: string }): event is ExplicitEdit => EXPLICIT_EDIT_KINDS.has(event.kind);

export type EditOutcome = { readonly model: LivingModelT } | { readonly refused: string };

const theirs = { source: 'user', party: null, quote: null } as const;
const noRange = { low: null, high: null } as const;

export function applyExplicitEdit(model: LivingModelT, edit: ExplicitEdit, goal?: string): EditOutcome {
  const mapped = mapLivingModel(model, goal === undefined ? {} : { goal });
  const frames = mapped.frames;
  const m: LivingModelT = structuredClone(model);
  const factor = (id: string) => m.factors.find((f) => f.id === id);
  const aim = (id: string) => m.aims.find((a) => a.id === id);
  // A gesture names a DRAWN edge. An option's own effect is drawn from its `<option>__on` switch (the mapper's option-effect
  // route), which draws an edge only from a stored link, under that link's own id. So an edge from an option's switch is the
  // stored link with its id; any other generated edge (an exact sum's lever, a goal's level today) is no stored link's.
  // Without this a strength edit was refused and a delete was acknowledged, then redrawn (a false "saved", Codex on #3555).
  const optionSwitch = (id: string) => model.options.some((o) => `${o.id}__on` === id);
  const ownersOf = (from: string, to: string) => {
    const exact = m.links.filter((l) => l.from === from && l.to === to);
    if (exact.length > 0 || !optionSwitch(from)) return exact;
    return m.links.filter((l) => l.to === to && mapped.graph.edges.some((e) => e.id === l.id && e.from === from && e.to === to));
  };
  const toRaw = (id: string, value: number): number | undefined => {
    const frame = frames.get(id);
    return frame === undefined ? undefined : value * frame.cap;
  };

  switch (edit.kind) {
    case 'factor_value_edit': {
      const f = factor(edit.target_id);
      const a = f === undefined ? aim(edit.target_id) : undefined;
      if (f === undefined && a === undefined) return { refused: 'not_in_model' };
      const unit = f?.unit ?? a?.target?.current_unit ?? a?.target?.unit ?? null;
      if (edit.unit !== undefined && unit !== null && edit.unit !== unit) return { refused: 'unit_mismatch' };
      const raw = edit.raw_value ?? toRaw(edit.target_id, edit.value);
      if (raw === undefined) return { refused: 'no_frame' };
      if (f !== undefined) Object.assign(f, { value: raw, ...noRange, unit: unit ?? edit.unit ?? null, ...theirs });
      else if (a!.target === null) return { refused: 'no_target' };
      else {
        // Today's level keeps the unit the person gave it (Track 3 Q2-02: "30 %" on a goal with no target unit saved as a bare 30):
        // `current_unit` when it differs from the target's unit, null when it is the same (the schema's own rule).
        const levelUnit = edit.unit ?? a!.target.current_unit;
        a!.target = { ...a!.target, current: raw, current_source: 'user', current_unit: levelUnit === a!.target.unit ? null : levelUnit };
      }
      return { model: m };
    }
    case 'prior_range_edit': {
      // A range on the model scale (the canvas's quick-set and Min/Max), kept as the factor's own low and high in the person's
      // units; it replaces a single figure (a range was given, not a figure). Only a plain range: no other distribution.
      const f = factor(edit.target_id);
      if (f === undefined) return { refused: 'not_in_model' };
      if (edit.distribution !== undefined && edit.distribution !== 'uniform') return { refused: 'distribution_not_in_slice' };
      if (!(edit.range_min <= edit.range_max)) return { refused: 'range_inverted' };
      const low = toRaw(f.id, edit.range_min);
      const high = toRaw(f.id, edit.range_max);
      if (low === undefined || high === undefined) return { refused: 'no_frame' };
      // A range around the person's own figure keeps it: a central figure with a range, so more information never costs
      // the Run (DL ruling 21 Oct, as a link's "centred" range). Olumi's estimate is never kept under the person's name: the
      // factor has one author, so a range that excludes the figure, or one around an estimate, replaces it (held and asked).
      // The bounds come through the frame (`toRaw`), so 28 % against a range from 28 % reads 28.000000000000004 (Codex):
      // a range from the figure itself still holds it.
      // Round-trip error only (a few units in the last place), never a gap a person could mean (Codex R2: 1e-9 relative kept 1e12 out of [1e12 + 500, …]).
      const eps = 16 * Number.EPSILON * Math.max(1, Math.abs(f.value ?? 0), Math.abs(low), Math.abs(high));
      const keep = f.value !== null && f.source === 'user' && low - eps <= f.value && f.value <= high + eps;
      Object.assign(f, { value: keep ? f.value : null, low, high, ...theirs });
      return { model: m };
    }
    case 'option_intervention_edit': {
      const o = m.options.find((x) => x.id === edit.option_id);
      const f = factor(edit.factor_id);
      if (o === undefined || f === undefined) return { refused: 'not_in_model' };
      const raw = toRaw(f.id, edit.value);
      if (raw === undefined) return { refused: 'no_frame' };
      const setting = { factor_id: f.id, value: raw, ...noRange, unit: f.unit, ...theirs };
      o.settings = [...o.settings.filter((s) => s.factor_id !== f.id), setting];
      return { model: m };
    }
    case 'goal_target_edit': {
      const a = aim(edit.goal_node_id);
      if (a === undefined) return { refused: 'not_in_model' };
      if (edit.constraint_type === 'at_least' && edit.raw_value === 0) return { refused: 'target_zero' };
      const prior = a.target;
      // A target in another unit would silently relabel the starting level's unit.
      const levelUnit = prior === null ? null : prior.current_unit ?? prior.unit;
      if (prior !== null && prior.current !== null && levelUnit !== null && levelUnit !== edit.unit) return { refused: 'unit_mismatch' };
      // The edit makes the aim the person's. A starting level they never gave is not carried as theirs: it is kept in the
      // history, and Olumi asks for today's level instead.
      const keepCurrent = a.source === 'user' || prior?.current_source === 'user';
      if (!keepCurrent && prior?.current != null) {
        m.history.push({ id: a.id, change: 'superseded', quote: null,
          old: `starting level ${prior.current}${prior.unit === null ? '' : ` ${prior.unit}`} (${a.source === 'olumi' ? 'Olumi\u2019s estimate' : 'not confirmed by you'})` });
      }
      a.target = { quantity: prior?.quantity ?? a.text, comparator: edit.constraint_type === 'at_least' ? '>=' : '<=',
        value: edit.raw_value, ...noRange, unit: edit.unit, by_when: prior?.by_when ?? null,
        baseline: prior?.baseline ?? null, current: keepCurrent ? prior?.current ?? null : null,
        current_source: keepCurrent ? prior?.current_source ?? null : null, current_unit: null, change_kind: null };
      Object.assign(a, theirs);
      return { model: m };
    }
    case 'edge_strength_edit':
    case 'structural_add_edge': {
      const from = frames.get(edit.from);
      const to = frames.get(edit.to);
      if (from === undefined || to === undefined) return { refused: 'no_frame' };
      const owners = ownersOf(edit.from, edit.to);
      // A link at the drawn endpoints is edited as before; one drawn edge that two stored links make names no single change.
      if (owners.length > 1 && owners[0]!.from !== edit.from) return { refused: 'link_ambiguous' };
      const existing = owners[0];
      if (edit.kind === 'structural_add_edge' && existing !== undefined) return { refused: 'link_exists' };
      if (edit.kind === 'edge_strength_edit' && existing === undefined) return { refused: 'not_in_model' };
      const sign = edit.kind === 'structural_add_edge' ? (edit.effect_direction === 'negative' ? '-' : '+')
        : edit.direction_intent === 'preserve' ? existing!.effect.sign : edit.direction_intent === 'negative' ? '-' : '+';
      if (sign === null) return { refused: 'sign_unknown' };
      // The gesture's strength is the engine's coefficient; the model keeps it in the person's units per +1 of `from`.
      const effect = { form: 'point' as const, value: edit.magnitude * to.cap / from.cap, ...noRange, sd: null, unit: to.unit, sign };
      if (existing !== undefined) Object.assign(existing, { effect, ...theirs });
      else m.links.push({ id: `${edit.from}__${edit.to}`, from: edit.from, to: edit.to, effect, ...theirs });
      return { model: m };
    }
    case 'option_status_edit': {
      // In or out of the comparison: a ruled-out option stays in the model and on the board (mapper: `retained_excluded`).
      const o = m.options.find((x) => x.id === edit.option_node_id);
      if (o === undefined) return { refused: 'not_in_model' };
      // `infeasible` ↔ `removed` moves no analysis hash, so the status the person last saw is checked like a rename's label.
      if (o.status !== edit.expected_status) return { refused: 'status_moved' };
      if (o.status === edit.status) return { refused: 'no_change' };
      // ⛔ No re-stamp: `source` also says whose the option's settings are (as for a rename).
      o.status = edit.status;
      return { model: m };
    }
    case 'structural_rename': {
      const item = aim(edit.node_id) ?? factor(edit.node_id) ?? m.options.find((o) => o.id === edit.node_id) ?? m.risks.find((r) => r.id === edit.node_id);
      if (item === undefined) return { refused: 'not_in_model' };
      const current = 'text' in item ? item.text : item.label;
      if (current !== edit.expected_label) return { refused: 'label_moved' };
      if ('text' in item) item.text = edit.label;
      else item.label = edit.label;
      // ⛔ The author is NOT re-stamped: `source` also says whose FIGURES these are (a goal's starting level, a factor's value,
      // a risk's chance), so a rename must never pass Olumi's estimate off as the person's (Codex R2 on the core-edit PR).
      return { model: m };
    }
    case 'structural_delete': {
      const gone = new Set(edit.removed_node_ids);
      const known = new Set([...m.aims, ...m.options, ...m.factors, ...m.risks].map((x) => x.id));
      // The decision node is the mapper's own, redrawn on every regeneration: a delete of it was acknowledged, then redrawn (a
      // false "saved", Codex), so it is refused by name like any other edge or node Olumi draws.
      if ([...gone].some((id) => id.startsWith('decision_') && !known.has(id))) return { refused: 'node_is_generated' };
      if ([...gone].some((id) => !known.has(id))) return { refused: 'not_in_model' };
      const pairGone = (l: { from: string; to: string }) => edit.removed_edges.some((e) => e.from === l.from && e.to === l.to);
      // A definition's parts and a risk's mitigations are drawn from the item itself, not from a link: deleting that edge
      // alone would be acknowledged, then redrawn on regeneration (a false "saved"). Removing a part changes what the
      // quantity IS, which an edge delete does not say, so it is refused by name (codex integration review, 21 Oct).
      const standing = (e: { from: string; to: string }) => !gone.has(e.from) && !gone.has(e.to) && pairGone(e);
      if ([...m.aims, ...m.factors].some((x) => (x.defined_as?.of ?? []).some((p) => standing({ from: p, to: x.id })))) return { refused: 'link_is_definition' };
      if (m.risks.some((r) => r.mitigations.some((x) => standing({ from: x.factor_id, to: r.id })))) return { refused: 'link_is_mitigation' };
      // Any other edge Olumi draws from no stored link (an option's setting, the decision's choice, an exact sum's lever, a
      // goal's level today) has nothing to remove: the same false "saved", so it is refused by name too.
      const generated = (e: { from: string; to: string }) => !gone.has(e.from) && !gone.has(e.to) && ownersOf(e.from, e.to).length === 0
        && mapped.graph.edges.some((x) => x.from === e.from && x.to === e.to);
      if (edit.removed_edges.some(generated)) return { refused: 'link_is_generated' };
      m.aims = m.aims.filter((a) => !gone.has(a.id));
      m.factors = m.factors.filter((f) => !gone.has(f.id));
      // A risk goes like a factor; a mitigation through a removed factor goes with that factor.
      m.risks = m.risks.filter((r) => !gone.has(r.id)).map((r) => ({ ...r, mitigations: r.mitigations.filter((x) => !gone.has(x.factor_id)) }));
      m.options = m.options.filter((o) => !gone.has(o.id)).map((o) => ({ ...o, settings: o.settings.filter((s) => !gone.has(s.factor_id)) }));
      const drawnGone = new Set(edit.removed_edges.flatMap((e) => ownersOf(e.from, e.to)));
      const kept = m.links.filter((l) => !gone.has(l.from) && !gone.has(l.to) && !pairGone(l) && !drawnGone.has(l));
      // A condition on a removed link goes with it, as one on a removed item does (Codex: no dangling reference).
      const linkGone = new Set(m.links.filter((l) => !kept.includes(l)).map((l) => l.id));
      m.links = kept;
      m.conditions = m.conditions.map((c) => ({ ...c, applies_to: c.applies_to.filter((id) => !gone.has(id) && !linkGone.has(id)) }));
      return { model: m };
    }
    case 'structural_add': {
      // Any id already in use: an item, a link, or a node the mapper draws (`decision_…`, a switch) (Codex).
      if ([...m.aims, ...m.options, ...m.factors, ...m.risks, ...m.links].some((x) => x.id === edit.node_id)
        || mapped.graph.nodes.some((n) => n.id === edit.node_id)) return { refused: 'id_exists' };
      if (edit.node_kind === 'factor') m.factors.push({ id: edit.node_id, label: edit.label, kind: 'factor', value: null, ...noRange, unit: null, defined_as: null, limit: null, ...theirs });
      else if (edit.node_kind === 'option') m.options.push({ id: edit.node_id, label: edit.label, settings: [], status: 'feasible', developed_from: null, ...theirs });
      // A new risk has no chance yet: never guessed, so it is drawn and the analysis asks for one (mapper: risk_occurrence_unknown).
      else if (edit.node_kind === 'risk') m.risks.push({ id: edit.node_id, label: edit.label, occurrence: { low: null, high: null }, horizon_months: null, mitigations: [], ...theirs });
      else return { refused: 'kind_not_in_slice' };
      return { model: m };
    }
  }
}
