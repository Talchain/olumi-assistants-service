/**
 * THIN CORE MAPPER (20 Oct 2026): the living model → the GraphV3 the engine runs on. PURE, and regenerated in full on
 * every revision, so no dependent value can go stale. Every id is the living model's own, so regeneration never
 * renumbers an entity or orphans a Run.
 *
 * Slice 1 handles LEVEL targets. The science conventions are the existing ones, re-stated here because the kept
 * sizers (`link-effect.ts`, `refit-frames.ts`, `same-unit.ts`) import the legacy meaning layer:
 *  · a level is `raw / cap`; the goal's cap is `resolveGoalThresholdCapWithProvenance`, its level `admitGoalBaseline`;
 *  · a link's β = (change in `to` per +1 of `from`) × cap_from / cap_to, its σ scaled by the same ratio (AIE, 20 Oct):
 *    a stated point gives the central coefficient only, and σ = |β|/2 is Olumi's illustrative convention (D3), never the
 *    user's spread; an explicitly stated Normal law gives both; an ordinary range is not a law, so it stays in the living
 *    model and its dependent chance is withheld;
 *  · existence 1 for a stated link is the assumption of conditioning on it; Olumi's 0.8 is an untested convention;
 *  · an unsized link is Olumi's placeholder, which the chance licence withholds; an unknown sign is never drawn positive;
 *  · unknown is never 0: a level, setting or link this slice cannot convert is WITHHELD with its reason, never dropped
 *    silently and never guessed.
 */
import { REPAIR_CODES, type RepairEntry } from '@talchain/schemas';
import type { LivingModelT, LivingSourceT } from '../../../schemas/living-model.js';
import { resolveGoalThresholdCapWithProvenance } from '../../../utils/goal-threshold-cap.js';
import { admitGoalBaseline } from '../../../cee/factor-extraction/goal-baseline-admissibility.js';

export type WithheldReason =
  | 'no_level_target' | 'aim_not_in_slice' | 'change_target_not_in_slice' | 'exact_target_not_in_slice' | 'target_range_not_in_slice'
  | 'goal_level_unknown' | 'link_frame_unknown' | 'chance_rests_on_withheld' | 'condition_not_in_slice'
  | 'goal_level_not_admitted' | 'factor_level_unknown' | 'level_range_not_in_slice' | 'setting_not_convertible'
  | 'link_endpoint_unknown' | 'link_unit_mismatch' | 'link_range_no_law' | 'link_sign_unknown' | 'no_single_status_quo';

export interface Withheld { readonly id: string; readonly reason: WithheldReason }

type Rec = Record<string, unknown>;
/** The scale an item's levels are read on: `value = raw / cap`. */
export interface Frame { readonly cap: number; readonly unit: string | null }
export interface Mapped {
  readonly graph: { nodes: Rec[]; edges: Rec[] };
  readonly withheld: readonly Withheld[];
  /** Each goal's and factor's frame, so a value on the model scale converts back to the person's units. */
  readonly frames: ReadonlyMap<string, Frame>;
}

const STRUCTURAL = { strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' } as const;
const OLUMI_EXISTS = 0.8;

const stated = (s: LivingSourceT): boolean => s === 'user' || s === 'party';
/** An item the person set themselves on the canvas: theirs, with no words to quote (`edit.ts`). */
const edited = (a: { source: LivingSourceT; quote: string | null }): boolean => a.source === 'user' && a.quote === null;
/** user/party → their words (or their own edit); Olumi → its inference; unverified → no stamp (unknown). */
const levelSource = (a: { source: LivingSourceT; quote: string | null }): string | undefined =>
  edited(a) ? 'user_edited' : stated(a.source) ? 'brief_extraction' : a.source === 'olumi' ? 'cee_inference' : undefined;
const withSource = (o: Rec, a: { source: LivingSourceT; quote: string | null }): Rec => {
  const source = levelSource(a);
  return source === undefined ? o : { ...o, source, ...(stated(a.source) ? { extractionType: 'explicit' } : {}) };
};

/** The frame a factor's levels are read on: '%' → 100, unitless [0,1] → 1, the goal's when the unit matches, else headroom. */
function capFor(levels: readonly number[], unit: string | null, goal: { cap: number; unit: string } | undefined): number | undefined {
  const finite = levels.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return undefined;
  const top = Math.max(...finite.map(Math.abs));
  if (unit === '%') return 100;
  if (goal !== undefined && unit !== null && unit === goal.unit && goal.cap >= top) return goal.cap;
  if (unit === null && finite.every((v) => v >= 0 && v <= 1)) return 1;
  return top > 0 ? top * 1.25 : undefined;
}

/** The goal a saved graph was compiled with: a regeneration keeps it unless its aim is no longer current. */
export function goalIdOf(graph: unknown): string | undefined {
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  const goal = Array.isArray(nodes) ? nodes.find((n) => (n as { kind?: unknown } | null)?.kind === 'goal') as { id?: unknown } | undefined : undefined;
  return typeof goal?.id === 'string' ? goal.id : undefined;
}

/** The options that keep a saved graph's goal (none when it has none). */
export const savedGoal = (graph: unknown): { goal?: string } => { const goal = goalIdOf(graph); return goal === undefined ? {} : { goal }; };

export function mapLivingModel(model: LivingModelT, opts: { readonly goal?: string } = {}): Mapped {
  const withheld: Withheld[] = [];
  const nodes: Rec[] = [];
  const edges: Rec[] = [];
  const hold = (id: string, reason: WithheldReason) => { withheld.push({ id, reason }); };
  /** The factors some option sets that this slice could not convert (the setting is left out of the engine graph). */
  const droppedSettings = new Set<string>();

  // ── The goal: the saved graph's goal while its aim is current (so reordering aims never swaps it unseen), else the
  // first current aim with a target. It is always on the graph; it has a threshold (so a chance) only where this slice
  // supports its target.
  const aim = (opts.goal === undefined ? undefined : model.aims.find((a) => a.id === opts.goal && a.status === 'current'))
    ?? model.aims.find((a) => a.status === 'current' && a.target !== null) ?? model.aims.find((a) => a.status === 'current');
  let goal: { id: string; cap: number; unit: string } | undefined;
  let goalNode: Rec | undefined;
  if (aim === undefined) hold('goal', 'no_level_target');
  else {
    goalNode = { id: aim.id, kind: 'goal', label: aim.text, ...(aim.quote !== null ? { source_quote: aim.quote } : {}) };
    nodes.push(goalNode);
    const t = aim.target;
    if (t === null) hold(aim.id, 'no_level_target');
    else if (t.comparator === 'increase' || t.comparator === 'decrease') hold(aim.id, 'change_target_not_in_slice');
    // "Exactly N" is never read as "at least N".
    else if (t.comparator === '=') hold(aim.id, 'exact_target_not_in_slice');
    else if (t.value === null) hold(aim.id, t.low !== null || t.high !== null ? 'target_range_not_in_slice' : 'no_level_target');
    else {
      const resolved = resolveGoalThresholdCapWithProvenance(undefined, t.value, t.unit ?? undefined, undefined);
      if (resolved === null) hold(aim.id, 'goal_level_not_admitted');
      else {
        goal = { id: aim.id, cap: resolved.cap, unit: t.unit ?? '' };
        Object.assign(goalNode, {
          goal_direction: t.comparator,
          goal_threshold_raw: t.value, goal_threshold_unit: t.unit ?? '', goal_threshold_cap: resolved.cap,
          goal_threshold_cap_provenance: resolved.provenance, goal_threshold: t.value / resolved.cap, goal_threshold_frame: 'level',
          ...(t.by_when !== null ? { goal_deadline_as_stated: t.by_when } : {}),
        });
        if (t.current === null) hold(aim.id, 'goal_level_unknown');
        else {
          const level = admitGoalBaseline({ rawTarget: t.value, rawBaseline: t.current, cap: resolved.cap, ...(t.comparator === '<=' ? { ceiling: true } : {}) });
          if (!level.admitted) hold(aim.id, 'goal_level_not_admitted');
          else goalNode.observed_state = withSource({ value: level.normalised, baseline: level.normalised, raw_value: t.current, cap: resolved.cap, unit: t.unit ?? '' }, aim);
        }
      }
    }
  }

  // Joint goals are not in this slice: every other current aim with a target is kept in the living model, withheld here.
  for (const a of model.aims) if (a !== aim && a.status === 'current' && a.target !== null) hold(a.id, 'aim_not_in_slice');

  // ── Factors, each on its own frame.
  const setsFactor = new Set(model.options.flatMap((o) => o.settings.map((s) => s.factor_id)));
  const caps = new Map<string, number>();
  const current = new Map<string, number>();
  for (const f of model.factors) {
    const levels = [f.value, ...model.options.flatMap((o) => o.settings.filter((s) => s.factor_id === f.id).map((s) => s.value))]
      .filter((v): v is number => v !== null);
    const cap = capFor(levels, f.unit, goal);
    if (cap !== undefined) caps.set(f.id, cap);
    const node: Rec = { id: f.id, kind: 'factor', label: f.label, category: setsFactor.has(f.id) ? 'controllable' : 'observable' };
    if (f.value !== null && cap !== undefined) {
      current.set(f.id, f.value);
      node.observed_state = withSource({ value: f.value / cap, raw_value: f.value, cap, unit: f.unit ?? '' }, f);
    } else hold(f.id, f.low !== null || f.high !== null ? 'level_range_not_in_slice' : 'factor_level_unknown');
    nodes.push(node);
  }

  // ── Options: one decision, one status quo, each setting an intervention on its factor's frame.
  const decisionId = `decision_${goal?.id ?? 'model'}`;
  nodes.unshift({ id: decisionId, kind: 'decision', label: `Decision: ${aim?.text ?? 'options'}` });
  const atCurrent = (o: LivingModelT['options'][number]) => o.settings.every((s) => s.value !== null && s.value === current.get(s.factor_id));
  const statusQuo = model.options.filter(atCurrent);
  if (statusQuo.length !== 1) hold('options', 'no_single_status_quo');
  for (const o of model.options) {
    const isBaseline = statusQuo.length === 1 && statusQuo[0] === o;
    const interventions: Rec = {};
    const set = (factorId: string, raw: number, unit: string | null, source: { source: LivingSourceT; quote: string | null }) => {
      const cap = caps.get(factorId);
      if (cap === undefined) { droppedSettings.add(factorId); return hold(`${o.id}:${factorId}`, 'setting_not_convertible'); }
      interventions[factorId] = {
        value: raw / cap, raw_value: raw, unit: unit ?? '', ...(levelSource(source) !== undefined ? { source: levelSource(source) } : {}),
        target_match: { node_id: factorId, match_type: 'exact_id', confidence: 'high' },
      };
    };
    for (const s of o.settings) {
      const factor = model.factors.find((f) => f.id === s.factor_id);
      if (factor === undefined || s.value === null || (s.unit !== null && factor.unit !== null && s.unit !== factor.unit)) {
        droppedSettings.add(s.factor_id);
        hold(`${o.id}:${s.factor_id}`, 'setting_not_convertible');
      } else set(s.factor_id, s.value, s.unit ?? factor.unit, s);
    }
    // The status quo holds every controllable factor at its current level, explicitly.
    if (isBaseline) for (const id of setsFactor) if (interventions[id] === undefined && current.has(id)) set(id, current.get(id)!, model.factors.find((f) => f.id === id)!.unit, { source: 'olumi', quote: null });
    nodes.push({ id: o.id, kind: 'option', label: o.label, ...(isBaseline ? { is_baseline: true } : {}), ...(Object.keys(interventions).length > 0 ? { interventions } : {}) });
    edges.push({ from: decisionId, to: o.id, ...STRUCTURAL, provenance: { source: 'cee_hypothesis' } });
    for (const id of Object.keys(interventions)) edges.push({ from: o.id, to: id, ...STRUCTURAL, provenance: { source: 'cee_hypothesis' } });
  }

  // ── Causal links, sized on their endpoints' frames.
  const frameOf = (id: string): { cap: number; unit: string | null } | undefined => {
    if (goal !== undefined && id === goal.id) return { cap: goal.cap, unit: goal.unit === '' ? null : goal.unit };
    const f = model.factors.find((x) => x.id === id);
    const cap = caps.get(id);
    return f !== undefined && cap !== undefined ? { cap, unit: f.unit } : undefined;
  };
  const causal = new Set([...model.factors.map((f) => f.id), ...(goalNode === undefined ? [] : [String(goalNode.id)])]);
  for (const l of model.links) {
    if (!causal.has(l.from) || !causal.has(l.to)) { hold(l.id, 'link_endpoint_unknown'); continue; }
    // The engine has no "unknown" direction, so an unsigned link stays in the living model only.
    if (l.effect.sign === null) { hold(l.id, 'link_sign_unknown'); continue; }
    const sign = l.effect.sign === '-' ? -1 : 1;
    const base: Rec = { id: l.id, from: l.from, to: l.to, effect_direction: sign < 0 ? 'negative' : 'positive' };
    const e = l.effect;
    const from = frameOf(l.from);
    const to = frameOf(l.to);
    const unitMismatch = to !== undefined && e.unit !== null && to.unit !== null && e.unit !== to.unit;
    const ratio = from !== undefined && to !== undefined ? from.cap / to.cap : undefined;
    const sized = ratio === undefined ? undefined : (e.form === 'point' && e.value !== null)
      ? { mean: sign * Math.abs(e.value) * ratio, std: Math.abs(e.value) * ratio / 2 }
      : (e.form === 'normal' && e.value !== null && e.sd !== null && e.sd > 0)
        ? { mean: sign * Math.abs(e.value) * ratio, std: e.sd * ratio }
        : undefined;
    if (ratio === undefined && (e.form === 'point' || e.form === 'normal')) hold(l.id, 'link_frame_unknown');
    if (e.form === 'range') hold(l.id, 'link_range_no_law');
    if (unitMismatch) hold(l.id, 'link_unit_mismatch');
    if (sized === undefined || unitMismatch) {
      // Unsized (or not convertible): Olumi's placeholder, which the chance licence withholds.
      edges.push({ ...base, strength: { mean: sign * 0.5, std: 0.125 }, exists_probability: OLUMI_EXISTS, defaulted: true,
        provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
      continue;
    }
    const exists = stated(l.source) ? 1 : OLUMI_EXISTS;
    // What nobody stated is Olumi's assumption, said through the existing ledger (`link-default-assumptions.ts`), never
    // left to a comment: a point's spread, and whether the link exists at all.
    const path = `edges[${l.from}::${l.to}]`;
    const assumed: RepairEntry[] = [
      ...(e.form === 'point' ? [{ code: REPAIR_CODES.CLAMP_STD_MINIMUM, layer: 'cee' as const, field_path: `${path}.strength.std`, before: null,
        after: sized.std, severity: 'info' as const,
        reason: 'Nobody stated how uncertain this strength is. Applied Olumi\'s illustrative spread (half the stated effect). It is not a measurement of anyone\'s confidence.' }] : []),
      { code: REPAIR_CODES.DEFAULT_EXISTS_PROBABILITY, layer: 'cee', field_path: `${path}.exists_probability`, before: null, after: exists, severity: 'info',
        reason: stated(l.source) ? 'Nobody stated how likely this link is to exist. The calculation assumes it exists, as stated.'
          : 'Nobody stated how likely this link is to exist. Applied Olumi\'s untested default.' },
    ];
    const who = stated(l.source) ? { source: edited(l) ? 'user_specified' : 'brief_extraction', magnitude: 'user_stated' }
      : l.source === 'olumi' ? { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } : {};
    edges.push({ ...base, strength: sized, exists_probability: exists, provenance: { ...who, uncertainty_defaults: assumed } });
  }

  // A chance rests on everything on the goal's path. Anything there that this slice left out of the engine graph (an
  // unsigned or unplaceable link, an option setting it could not convert) would change the calculation, so the chance is
  // withheld: the goal keeps no threshold, and says why (AIE, 20 Oct: withhold the dependent calculation, never compute it
  // on less). A placeholder link needs no such rule: the chance licence already withholds through it.
  if (goal !== undefined && goalNode !== undefined) {
    const onPath = new Set([goal.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const l of model.links) if (onPath.has(l.to) && !onPath.has(l.from)) { onPath.add(l.from); grew = true; }
    }
    const leftOut = withheld.some((w) => (w.reason === 'link_sign_unknown' || w.reason === 'link_endpoint_unknown')
      && onPath.has(model.links.find((l) => l.id === w.id)?.to ?? '')) || [...droppedSettings].some((id) => onPath.has(id));
    // A condition on anything the chance rests on (a prerequisite the engine cannot hold) changes it too.
    const pathLinks = new Set(model.links.filter((l) => onPath.has(l.to)).map((l) => l.id));
    const conditioned = model.conditions.filter((c) => c.applies_to.some((id) => onPath.has(id) || pathLinks.has(id)));
    for (const c of conditioned) hold(`condition:${c.text}`, 'condition_not_in_slice');
    if (leftOut || conditioned.length > 0) {
      for (const k of Object.keys(goalNode)) if (k.startsWith('goal_threshold') || k === 'goal_direction' || k === 'goal_deadline_as_stated') delete goalNode[k];
      hold(goal.id, 'chance_rests_on_withheld');
    }
  }

  const frames = new Map<string, Frame>(model.factors.flatMap((f) => (caps.has(f.id) ? [[f.id, { cap: caps.get(f.id)!, unit: f.unit }] as const] : [])));
  if (goal !== undefined) frames.set(goal.id, { cap: goal.cap, unit: goal.unit === '' ? null : goal.unit });
  return { graph: { nodes, edges }, withheld, frames };
}
