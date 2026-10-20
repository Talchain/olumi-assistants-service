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
  | { readonly kind: 'structural_add_edge'; readonly from: string; readonly to: string; readonly magnitude: number; readonly effect_direction: 'positive' | 'negative' };

const EXPLICIT_EDIT_KINDS: ReadonlySet<string> = new Set([
  'factor_value_edit', 'option_intervention_edit', 'goal_target_edit', 'edge_strength_edit',
  'structural_rename', 'structural_delete', 'structural_add', 'structural_add_edge',
]);

/** A gesture this slice applies. The event's shape is the wire's own for its kind, already checked at ingress. */
export const isExplicitEdit = (event: { readonly kind: string }): event is ExplicitEdit => EXPLICIT_EDIT_KINDS.has(event.kind);

export type EditOutcome = { readonly model: LivingModelT } | { readonly refused: string };

const theirs = { source: 'user', party: null, quote: null } as const;
const noRange = { low: null, high: null } as const;

export function applyExplicitEdit(model: LivingModelT, edit: ExplicitEdit, goal?: string): EditOutcome {
  const frames = mapLivingModel(model, goal === undefined ? {} : { goal }).frames;
  const m: LivingModelT = structuredClone(model);
  const factor = (id: string) => m.factors.find((f) => f.id === id);
  const aim = (id: string) => m.aims.find((a) => a.id === id);
  const toRaw = (id: string, value: number): number | undefined => {
    const frame = frames.get(id);
    return frame === undefined ? undefined : value * frame.cap;
  };

  switch (edit.kind) {
    case 'factor_value_edit': {
      const f = factor(edit.target_id);
      const a = f === undefined ? aim(edit.target_id) : undefined;
      if (f === undefined && a === undefined) return { refused: 'not_in_model' };
      const unit = f?.unit ?? a?.target?.unit ?? null;
      if (edit.unit !== undefined && unit !== null && edit.unit !== unit) return { refused: 'unit_mismatch' };
      const raw = edit.raw_value ?? toRaw(edit.target_id, edit.value);
      if (raw === undefined) return { refused: 'no_frame' };
      if (f !== undefined) Object.assign(f, { value: raw, ...noRange, unit: unit ?? edit.unit ?? null, ...theirs });
      else if (a!.target === null) return { refused: 'no_target' };
      else a!.target = { ...a!.target, current: raw, current_source: 'user' };
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
      if (prior !== null && prior.current !== null && prior.unit !== null && prior.unit !== edit.unit) return { refused: 'unit_mismatch' };
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
        current_source: keepCurrent ? prior?.current_source ?? null : null };
      Object.assign(a, theirs);
      return { model: m };
    }
    case 'edge_strength_edit':
    case 'structural_add_edge': {
      const from = frames.get(edit.from);
      const to = frames.get(edit.to);
      if (from === undefined || to === undefined) return { refused: 'no_frame' };
      const existing = m.links.find((l) => l.from === edit.from && l.to === edit.to);
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
    case 'structural_rename': {
      const item = aim(edit.node_id) ?? factor(edit.node_id) ?? m.options.find((o) => o.id === edit.node_id);
      if (item === undefined) return { refused: 'not_in_model' };
      const current = 'text' in item ? item.text : item.label;
      if (current !== edit.expected_label) return { refused: 'label_moved' };
      if ('text' in item) item.text = edit.label;
      else item.label = edit.label;
      return { model: m };
    }
    case 'structural_delete': {
      const gone = new Set(edit.removed_node_ids);
      const known = new Set([...m.aims, ...m.options, ...m.factors].map((x) => x.id));
      // The decision node is the mapper's own; removing it alone changes nothing the model holds.
      if ([...gone].some((id) => !known.has(id) && !id.startsWith('decision_'))) return { refused: 'not_in_model' };
      const pairGone = (l: { from: string; to: string }) => edit.removed_edges.some((e) => e.from === l.from && e.to === l.to);
      m.aims = m.aims.filter((a) => !gone.has(a.id));
      m.factors = m.factors.filter((f) => !gone.has(f.id));
      m.options = m.options.filter((o) => !gone.has(o.id)).map((o) => ({ ...o, settings: o.settings.filter((s) => !gone.has(s.factor_id)) }));
      m.links = m.links.filter((l) => !gone.has(l.from) && !gone.has(l.to) && !pairGone(l));
      m.conditions = m.conditions.map((c) => ({ ...c, applies_to: c.applies_to.filter((id) => !gone.has(id)) }));
      return { model: m };
    }
    case 'structural_add': {
      if ([...m.aims, ...m.options, ...m.factors].some((x) => x.id === edit.node_id)) return { refused: 'id_exists' };
      if (edit.node_kind === 'factor') m.factors.push({ id: edit.node_id, label: edit.label, value: null, ...noRange, unit: null, ...theirs });
      else if (edit.node_kind === 'option') m.options.push({ id: edit.node_id, label: edit.label, settings: [], ...theirs });
      else return { refused: 'kind_not_in_slice' };
      return { model: m };
    }
  }
}
