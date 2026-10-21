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
 *    model and its dependent chance is withheld, unless the person gave their own figure inside it, which sizes the link
 *    as their point (AIE range disposition, 16 Oct: `centre`), the range kept beside it;
 *  · existence 1 for a stated link is the assumption of conditioning on it; Olumi's 0.8 is an untested convention;
 *  · an unsized link is Olumi's placeholder, which the chance licence withholds; an unknown sign is never drawn positive;
 *  · unknown is never 0: a level, setting or link this slice cannot convert is WITHHELD with its reason, never dropped
 *    silently and never guessed;
 *  · an option's own effect on the goal ("adds 260 metres") reaches the engine through a factor the options set, because
 *    the engine reads effects only through factors. Where every such effect is stated EXACT and the goal's level today is
 *    the person's own, it is worked out exactly as a sum (the existing STEP 8 Route A shape: goal = its level today + the
 *    option's change; ISL never draws an identity's parts), since any drawn link is floored to a spread by PLoT. Otherwise
 *    each option gets an on/off factor whose link is sized like any other.
 */
import { REPAIR_CODES, type RepairEntry } from '@talchain/schemas';
import type { LivingModelT, LivingSourceT } from '../../../schemas/living-model.js';
import { resolveGoalThresholdCapWithProvenance } from '../../../utils/goal-threshold-cap.js';
import { admitGoalBaseline } from '../../../cee/factor-extraction/goal-baseline-admissibility.js';
import { LLM_STRENGTH_STD_FLOOR } from '../../../cee/constants.js';
import { EventRiskV1 } from '../../../schemas/event-risk.js';

export type WithheldReason =
  | 'no_level_target' | 'aim_not_in_slice' | 'change_kind_unknown' | 'change_base_invalid' | 'change_base_not_theirs' | 'current_unit_mismatch' | 'exact_target_not_in_slice' | 'target_range_not_in_slice'
  | 'goal_level_unknown' | 'link_frame_unknown' | 'chance_rests_on_withheld' | 'condition_not_in_slice'
  | 'goal_level_not_admitted' | 'factor_level_unknown' | 'level_range_not_in_slice' | 'setting_not_convertible'
  | 'link_endpoint_unknown' | 'link_unit_mismatch' | 'link_range_no_law' | 'link_sign_unknown'
  | 'exact_not_drawable' | 'stay_within_base_not_theirs' | 'stay_within_unconfirmed'
  | 'risk_occurrence_unknown' | 'risk_unattributed' | 'risk_not_in_slice';

/** A risk that cannot be sent as the event the person described withholds the chance when it is on the goal's path. */
const RISK_REFUSED: ReadonlySet<WithheldReason> = new Set(['risk_occurrence_unknown', 'risk_unattributed', 'risk_not_in_slice']);

export interface Withheld { readonly id: string; readonly reason: WithheldReason }

type Rec = Record<string, unknown>;
/** The scale an item's levels are read on: `value = raw / cap`. */
export interface Frame { readonly cap: number; readonly unit: string | null }
export interface Mapped {
  readonly graph: { nodes: Rec[]; edges: Rec[] };
  readonly withheld: readonly Withheld[];
  /** Each goal's and factor's frame, so a value on the model scale converts back to the person's units. */
  readonly frames: ReadonlyMap<string, Frame>;
  /** Premises the result is worked out under that nobody stated, said beside it (amendment 1: "carrying on leaves X unchanged"). */
  readonly assumed: readonly { readonly id: string; readonly text: string }[];
}

const STRUCTURAL = { strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' } as const;
const OLUMI_EXISTS = 0.8;

const stated = (s: LivingSourceT): boolean => s === 'user' || s === 'party';
/** The person's own words for keeping a level where it is (Science, 21 Oct). The cue only skips the question; it never sets the comparator or the number. */
const STAY_CUE = { '>=': /\b(keep|keeps|keeping|stay|stays|staying|at least|no less than|minimum)\b/i, '<=': /\b(keep|keeps|keeping|stay|stays|staying|at most|no more than|cap|capped)\b/i } as const;
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

type Target = NonNullable<LivingModelT['aims'][number]['target']>;
interface LevelTarget { readonly comparator: '>=' | '<='; readonly value: number; readonly unit: string | null }

/**
 * The level a target asks for. A change from today ("raise it by 10%") is read on today's level, in that level's own unit
 * (Batch 0 rulings 19 and 21; amendment 1: carrying on as now leaves the quantity unchanged, so the status quo is today):
 * absolute B ± C, relative B × (1 ± r/100), points B ± C on a quantity that is itself a percentage. What a percentage change
 * means on a percentage is never picked (amendment 3): it needs the AI's declared `change_kind`.
 */
function levelTargetOf(t: Target): LevelTarget | WithheldReason {
  if (t.comparator === '=') return 'exact_target_not_in_slice';
  if (t.value === null) return t.low !== null || t.high !== null ? 'target_range_not_in_slice' : 'no_level_target';
  // A declared unit is model content, never relabelled by another field (buddy R1 on #3525): today's level in another unit
  // than a level target has no supported conversion here, so the dependent calculation is withheld.
  if (t.comparator === '>=' || t.comparator === '<=') {
    if (t.current !== null && t.current_unit !== null && t.current_unit !== t.unit) return 'current_unit_mismatch';
    return { comparator: t.comparator, value: t.value, unit: t.unit };
  }
  if (t.current === null) return 'goal_level_unknown';
  const levelUnit = t.current_unit ?? t.unit;
  const kind = t.change_kind ?? (levelUnit === '%' ? null : t.unit === levelUnit ? 'absolute' : t.unit === '%' ? 'relative' : null);
  // Points are percentage points of a percentage quantity: both units are '%', or nothing is dropped silently.
  const fits = kind === 'absolute' ? t.unit === levelUnit : kind === 'relative' ? t.unit === '%'
    : kind === 'points' ? levelUnit === '%' && t.unit === '%' : false;
  if (kind === null || !fits) return 'change_kind_unknown';
  if (kind === 'relative' && !(t.current > 0)) return 'change_base_invalid';
  const sign = t.comparator === 'increase' ? 1 : -1;
  const by = Math.abs(t.value);
  return { comparator: sign > 0 ? '>=' : '<=', value: kind === 'relative' ? t.current * (1 + (sign * by) / 100) : t.current + sign * by, unit: levelUnit };
}

/** The goal a saved graph was compiled with: a regeneration keeps it unless its aim is no longer current. */
export function goalIdOf(graph: unknown): string | undefined {
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  const goal = Array.isArray(nodes) ? nodes.find((n) => (n as { kind?: unknown } | null)?.kind === 'goal') as { id?: unknown } | undefined : undefined;
  return typeof goal?.id === 'string' ? goal.id : undefined;
}

/** The options that keep a saved graph's goal (none when it has none). */
export const savedGoal = (graph: unknown): { goal?: string } => { const goal = goalIdOf(graph); return goal === undefined ? {} : { goal }; };

export function mapLivingModel(living: LivingModelT, opts: { readonly goal?: string } = {}): Mapped {
  let model = living;
  const withheld: Withheld[] = [];
  const nodes: Rec[] = [];
  const edges: Rec[] = [];
  const hold = (id: string, reason: WithheldReason) => { withheld.push({ id, reason }); };
  const assumed: { id: string; text: string }[] = [];
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
    const isChange = t !== null && (t.comparator === 'increase' || t.comparator === 'decrease');
    // "Exactly N" is never read as "at least N"; a change is read on today's level (`levelTargetOf`), and only on the
    // person's own: a change on Olumi's estimated base would need the provisional estimate_only treatment (rulings 9/10),
    // which this slice does not carry, so it is withheld and Olumi asks for today's level.
    const lt = t === null ? 'no_level_target' as const
      : isChange && t.current !== null && !(t.current_source === 'user' || stated(aim.source)) ? 'change_base_not_theirs' as const : levelTargetOf(t);
    if (typeof lt === 'string') hold(aim.id, lt);
    else {
      const fromTarget = resolveGoalThresholdCapWithProvenance(undefined, lt.value, lt.unit ?? undefined, undefined);
      // The goal's frame holds today's level too: a ceiling below today would put today off its own scale ('level_frame').
      const resolved = fromTarget !== null && fromTarget.provenance !== 'metric_scale' && t!.current !== null && t!.current * 1.25 > fromTarget.cap
        ? { cap: t!.current * 1.25, provenance: 'level_frame' as const } : fromTarget;
      if (resolved === null) hold(aim.id, 'goal_level_not_admitted');
      else {
        goal = { id: aim.id, cap: resolved.cap, unit: lt.unit ?? '' };
        Object.assign(goalNode, {
          goal_direction: lt.comparator,
          goal_threshold_raw: lt.value, goal_threshold_unit: lt.unit ?? '', goal_threshold_cap: resolved.cap,
          goal_threshold_cap_provenance: resolved.provenance, goal_threshold: lt.value / resolved.cap, goal_threshold_frame: 'level',
          ...(t!.by_when !== null ? { goal_deadline_as_stated: t!.by_when } : {}),
        });
        if (t!.current === null) hold(aim.id, 'goal_level_unknown');
        else {
          // "Stay within" (Science, 21 Oct): a floor today already clears, or a ceiling today already sits under, is a valid
          // goal, scored on the level at the end of the horizon (not along the way). Only on the person's own level today
          // (an Olumi estimate is asked for), and read silently only when their words say so; otherwise Olumi asks once.
          const stays = lt.comparator === '<=' ? t!.current <= lt.value : t!.current >= lt.value;
          const level = stays && !(t!.current_source === 'user' || stated(aim.source)) ? 'stay_within_base_not_theirs' as const
            : stays && !STAY_CUE[lt.comparator].test(aim.quote ?? '') ? 'stay_within_unconfirmed' as const
            : admitGoalBaseline({ rawTarget: lt.value, rawBaseline: t!.current, cap: resolved.cap, ...(lt.comparator === '<=' ? { ceiling: true } : {}),
              ...(stays ? { stayWithin: true } : {}) });
          if (typeof level === 'string') hold(aim.id, level);
          else if (!level.admitted) hold(aim.id, 'goal_level_not_admitted');
          else {
            goalNode.observed_state = withSource({ value: level.normalised, baseline: level.normalised, raw_value: t!.current, cap: resolved.cap, unit: lt.unit ?? '' },
              t!.current_source === 'user' ? { source: 'user', quote: null } : aim);
            // A change is measured from today only if carrying on as now leaves the quantity there (amendment 1): said beside it.
            if (stays) {
              const say = (v: number) => `${v}${lt.unit ? ` ${lt.unit}` : ''}`;
              assumed.push({ id: aim.id, text: `Keep ${t!.quantity} at or ${lt.comparator === '<=' ? 'below' : 'above'} ${say(lt.value)} (today ${say(t!.current)}). The chance is for its level at the end of ${t!.by_when ?? 'the period'}, not along the way.` });
            }
            if (isChange) assumed.push({ id: aim.id, text: `Carrying on as now leaves ${t!.quantity} at today's ${t!.current}${lt.unit ? ` ${lt.unit}` : ''}; the change is measured from that.` });
          }
        }
      }
    }
  }

  // Joint goals are not in this slice: every other current aim with a target is kept in the living model, withheld here.
  for (const a of model.aims) if (a !== aim && a.status === 'current' && a.target !== null) hold(a.id, 'aim_not_in_slice');

  // ── An option's own effect on the goal becomes a factor the options set (see the header). Same ids, same attribution.
  const optionIds = new Set(model.options.map((o) => o.id));
  const direct = goal === undefined ? [] : model.links.filter((l) => optionIds.has(l.from) && l.to === goal!.id);
  let exactSum: { readonly lever: string; readonly today: string } | undefined;
  if (direct.length > 0 && goal !== undefined && goalNode?.observed_state !== undefined) {
    const g = goal;
    const todayIsTheirs = aim!.target!.current_source === 'user' || stated(aim!.source);
    const exact = todayIsTheirs && new Set(direct.map((l) => l.from)).size === direct.length
      && model.links.every((l) => l.to !== g.id || optionIds.has(l.from))
      && direct.every((l) => l.effect.form === 'exact' && l.effect.value !== null && l.effect.sign !== null
        && (l.effect.unit === null || l.effect.unit === g.unit));
    // A change below today is a part of the sum too (R2 P04: "removes 140 minutes a week"): the lever is declared a change
    // (`quantity_frame: 'change'`, 0 today), which PLoT carries signed on the goal's cap (PLoT #454), never clamped at 0.
    if (exact) {
      exactSum = { lever: `${g.id}__change`, today: `${g.id}_today` };
      const lever = exactSum.lever;
      model = { ...model,
        factors: [...model.factors, { id: lever, label: `Change in ${aim!.target!.quantity}`, value: 0, low: null, high: null,
          unit: g.unit === '' ? null : g.unit, source: 'olumi', party: null, quote: null }],
        options: model.options.map((o) => {
          const l = direct.find((d) => d.from === o.id);
          return l === undefined ? o : { ...o, settings: [...o.settings, { factor_id: lever, value: (l.effect.sign === '-' ? -1 : 1) * Math.abs(l.effect.value!),
            low: null, high: null, unit: g.unit === '' ? null : g.unit, source: l.source, party: l.party, quote: l.quote }] };
        }),
        links: model.links.filter((l) => !direct.includes(l)) };
    }
  }
  /**
   * Any other effect an option has, on a factor or on the goal ("emailing customers improves how well they understand
   * the delay"): the option switches its action on (`<option>__on`, 0 today, 1 under the option), and the link runs from
   * that switch, so it reaches the engine as the person or Olumi gave it, sized or not. Without this, a link from an
   * option to a factor had no engine endpoint and was held (`link_endpoint_unknown`), leaving the option driving nothing.
   */
  const fromOption = model.links.filter((l) => optionIds.has(l.from));
  if (fromOption.length > 0) {
    const on = (optionId: string) => `${optionId}__on`;
    model = { ...model,
      factors: [...model.factors, ...[...new Set(fromOption.map((l) => l.from))].map((id) => ({ id: on(id),
        label: `${model.options.find((o) => o.id === id)!.label} in place`, value: 0, low: null, high: null, unit: null, source: 'olumi' as const, party: null, quote: null }))],
      options: model.options.map((o) => {
        const l = fromOption.find((d) => d.from === o.id);
        return l === undefined ? o : { ...o, settings: [...o.settings, { factor_id: on(o.id), value: 1, low: null, high: null, unit: null, source: l.source, party: l.party, quote: l.quote }] };
      }),
      links: model.links.map((l) => (fromOption.includes(l) ? { ...l, from: on(l.from) } : l)) };
  }

  // ── Factors, each on its own frame.
  const setsFactor = new Set(model.options.flatMap((o) => o.settings.map((s) => s.factor_id)));
  const caps = new Map<string, number>();
  const current = new Map<string, number>();
  for (const f of model.factors) {
    const levels = [f.value, ...model.options.flatMap((o) => o.settings.filter((s) => s.factor_id === f.id).map((s) => s.value))]
      .filter((v): v is number => v !== null);
    // The exact sum's change is read on the goal's own frame, so the goal is its parts added in the goal's units.
    const cap = exactSum !== undefined && f.id === exactSum.lever ? goal!.cap : capFor(levels, f.unit, goal);
    if (cap !== undefined) caps.set(f.id, cap);
    const node: Rec = { id: f.id, kind: 'factor', label: f.label, category: setsFactor.has(f.id) ? 'controllable' : 'observable',
      // The exact sum's change: 0 today by definition (the contract's marker), so the engine holds it exact.
      ...(f.id === exactSum?.lever ? { quantity_frame: 'change' } : {}) };
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
  // No single option at today's levels is not a loss: every option is still emitted and compared on its own interventions.
  // It was reported as withheld, and the AI then said the alternatives were omitted (R2 P01/P07 at 46d30e6e).
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

  // ── Risks (Track 2): an EVENT that may happen within a window, sent as ISL's event_risk.v1 (#228), which owns its
  // semantics: occurrence drawn once per scenario, the stated chance scaled down while a mitigation is in place, and what
  // it does if it happens as ordinary links from it (per +1: it happening). Its chance, window and whose figures they are
  // are the person's or Olumi's as stated, never guessed (an Olumi chance is sent as Olumi's). A present condition is never
  // an event (Science §3C): the AI is told so, since no rule here can tell one from an event certain within its window
  // (p = 1, which ISL evaluates). A cause INTO an event (a cascade) is not in this slice (§9). Anything else is refused.
  const risks = new Set<string>();
  const refusedRisks = new Set<string>();
  const settingsOf = (factorId: string) => model.options.flatMap((o) => o.settings.filter((x) => x.factor_id === factorId));
  for (const r of model.risks) {
    const { low, high } = r.occurrence;
    const basis = stated(r.source) ? 'user' as const : r.source === 'olumi' ? 'olumi' as const : undefined;
    // A mitigation is a step an option switches on: a unitless factor on a frame of 1 (so "in place" reaches the engine as
    // 1, never 0.01 of a %), not in place today (0), set only to 0 or 1, with no other effect, no cause of its own and no
    // other risk (ISL: a preventer is a root switch whose only child is this risk).
    const switchOk = (id: string) => {
      const f = model.factors.find((x) => x.id === id);
      return f !== undefined && f.unit === null && caps.get(id) === 1 && f.value === 0
        && settingsOf(id).every((x) => x.value === 0 || x.value === 1)
        && !model.links.some((l) => l.to === id || (l.from === id && l.to !== r.id))
        && !model.risks.some((o) => o.id !== r.id && o.mitigations.some((m) => m.factor_id === id));
    };
    const block = basis === undefined || low === null || high === null || r.horizon_months === null ? undefined : {
      version: 1 as const, occurrence: { p_low: low, p_high: high, basis }, horizon: { months: r.horizon_months },
      ...(r.mitigations.length > 0 ? { mitigations: r.mitigations.map((m) => ({ factor_id: m.factor_id, occurrence_reduction: m.reduction })) } : {}),
    };
    const reason: WithheldReason | undefined = low === null || high === null || r.horizon_months === null ? 'risk_occurrence_unknown'
      : basis === undefined ? 'risk_unattributed'
        : !EventRiskV1.safeParse(block).success || !r.mitigations.every((m) => switchOk(m.factor_id)) ? 'risk_not_in_slice' : undefined;
    if (reason !== undefined) { hold(r.id, reason); refusedRisks.add(r.id); continue; }
    risks.add(r.id);
    nodes.push({ id: r.id, kind: 'risk', label: r.label, event_risk: block, ...(r.quote !== null ? { source_quote: r.quote } : {}) });
    const who = stated(r.source) ? { source: edited(r) ? 'user_specified' : 'brief_extraction', magnitude: 'user_stated' } : { source: 'cee_hypothesis', magnitude: 'olumi_estimate' };
    // The preventer's link: its strength is not read (the stated reduction is), so it carries no doubt of its own.
    for (const m of r.mitigations) {
      edges.push({ id: `${m.factor_id}__${r.id}`, from: m.factor_id, to: r.id, strength: { mean: -1, std: LLM_STRENGTH_STD_FLOOR }, exists_probability: 1,
        effect_direction: 'negative', provenance: who });
    }
  }

  // ── Causal links, sized on their endpoints' frames.
  const frameOf = (id: string): { cap: number; unit: string | null } | undefined => {
    if (goal !== undefined && id === goal.id) return { cap: goal.cap, unit: goal.unit === '' ? null : goal.unit };
    // An event is 0 (it does not happen) or 1 (it happens): what it does is the change per +1, on a frame of 1.
    if (risks.has(id)) return { cap: 1, unit: null };
    const f = model.factors.find((x) => x.id === id);
    const cap = caps.get(id);
    return f !== undefined && cap !== undefined ? { cap, unit: f.unit } : undefined;
  };
  const causal = new Set([...model.factors.map((f) => f.id), ...risks, ...(goalNode === undefined ? [] : [String(goalNode.id)])]);
  for (const l of model.links) {
    // What a refused risk would do is said once, by the risk's own reason; a cause INTO an event is not in this slice.
    if (refusedRisks.has(l.from) && !refusedRisks.has(l.to) && !risks.has(l.to)) continue;
    if (risks.has(l.to) || refusedRisks.has(l.to)) { hold(l.id, 'risk_not_in_slice'); continue; }
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
    // The person's own figure inside their range ("about 20, between 10 and 30") sizes the link as their point, with the
    // range kept beside it in the living model (AIE range disposition, 16 Oct: `centre`). A bare range sizes nothing.
    const centred = e.form === 'range' && e.value !== null && e.low !== null && e.high !== null && e.low < e.value && e.value < e.high;
    const sized = ratio === undefined ? undefined : ((e.form === 'point' || centred) && e.value !== null)
      ? { mean: sign * Math.abs(e.value) * ratio, std: Math.abs(e.value) * ratio / 2 }
      : (e.form === 'normal' && e.value !== null && e.sd !== null && e.sd > 0)
        ? { mean: sign * Math.abs(e.value) * ratio, std: e.sd * ratio }
        // Stated exact, but on a drawn link: kept at the floor spread so the model still runs, while its chance is withheld,
        // since any drawn spread can turn a deterministic "meets" into about 50% (AIE 17:59, point 4). The exact sum is the
        // one exact route.
        : (e.form === 'exact' && e.value !== null) ? { mean: sign * Math.abs(e.value) * ratio, std: LLM_STRENGTH_STD_FLOOR }
        : undefined;
    if (ratio === undefined && (e.form === 'point' || e.form === 'normal' || e.form === 'exact' || centred)) hold(l.id, 'link_frame_unknown');
    if (e.form === 'exact') hold(l.id, 'exact_not_drawable');
    if (e.form === 'range' && !centred) hold(l.id, 'link_range_no_law');
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
      ...(e.form === 'point' || centred ? [{ code: REPAIR_CODES.CLAMP_STD_MINIMUM, layer: 'cee' as const, field_path: `${path}.strength.std`, before: null,
        after: sized.std, severity: 'info' as const,
        reason: centred
          ? `The calculation uses the stated ${Math.abs(e.value!)} with Olumi's illustrative spread (half the stated effect). The stated range, ${e.low} to ${e.high}, is kept with the model but is not used as a spread.`
          : 'Nobody stated how uncertain this strength is. Applied Olumi\'s illustrative spread (half the stated effect). It is not a measurement of anyone\'s confidence.' }] : []),
      { code: REPAIR_CODES.DEFAULT_EXISTS_PROBABILITY, layer: 'cee', field_path: `${path}.exists_probability`, before: null, after: exists, severity: 'info',
        reason: stated(l.source) ? 'Nobody stated how likely this link is to exist. The calculation assumes it exists, as stated.'
          : 'Nobody stated how likely this link is to exist. Applied Olumi\'s untested default.' },
    ];
    const who = stated(l.source) ? { source: edited(l) ? 'user_specified' : 'brief_extraction', magnitude: 'user_stated' }
      : l.source === 'olumi' ? { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } : {};
    // The size in the person's own units, as every existing reader of a sized link reads it (`natural_effect`: the target's
    // testability, the chance licence, the canvas): the change in `to` per +1 of `from`, and the β it was written for.
    const natural_effect = { amount: sign * Math.abs(e.value!), amount_unit: to!.unit ?? '', per_source_change: 1,
      per_source_change_unit: from!.unit ?? '', strength_mean: sized.mean, strength_mean_frame: 'edge_strength' as const };
    edges.push({ ...base, strength: sized, exists_probability: exists, provenance: { ...who, natural_effect, uncertainty_defaults: assumed } });
  }

  // The exact sum: the goal's level today and the options' change, each one +1 definitional part (ISL adds them in the
  // goal's units and never draws them). The today part IS the goal's level today, copied, never a new figure.
  if (exactSum !== undefined && goalNode !== undefined) {
    const unit = goal!.unit;
    nodes.push({ id: exactSum.today, kind: 'factor', label: `${String(goalNode.label)} today`, category: 'observable', observed_state: { ...(goalNode.observed_state as Rec) } });
    for (const part of [exactSum.today, exactSum.lever]) {
      edges.push({ id: `${part}__${goal!.id}`, from: part, to: goal!.id, strength: { mean: 1, std: LLM_STRENGTH_STD_FLOOR }, exists_probability: 1,
        effect_direction: 'positive', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', definitional: true, natural_effect: {
          amount: 1, amount_unit: unit, per_source_change: 1, per_source_change_unit: unit, strength_mean: 1, strength_mean_frame: 'edge_strength' } } });
    }
    goalNode.nonlinear_identity = { operation: 'sum', factor_ids: [exactSum.today, exactSum.lever], stated_in_brief: false };
  }

  // A chance rests on everything on the goal's path. Anything there that this slice left out of the engine graph (an
  // unsigned or unplaceable link, an option setting it could not convert) would change the calculation, so the chance is
  // withheld: the goal keeps no threshold, and says why (AIE, 20 Oct: withhold the dependent calculation, never compute it
  // on less). A placeholder link needs no such rule: the chance licence already withholds through it.
  if (goal !== undefined && goalNode !== undefined) {
    // The path is read on the person's own links as well as the engine's, so an option effect lowered to a factor or to the
    // exact sum keeps everything stated about it (buddy R1 on #3523).
    const allLinks = [...living.links, ...model.links,
      ...model.risks.flatMap((r) => r.mitigations.map((m) => ({ id: `${m.factor_id}__${r.id}`, from: m.factor_id, to: r.id })))];
    const onPath = new Set([goal.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const l of allLinks) if (onPath.has(l.to) && !onPath.has(l.from)) { onPath.add(l.from); grew = true; }
    }
    // An option moves the goal through what it sets, so it is on the path too (science check 5bbceeec, point 5).
    for (const o of model.options) if (o.settings.some((s) => onPath.has(s.factor_id))) onPath.add(o.id);
    const leftOut = withheld.some((w) => (w.reason === 'link_sign_unknown' || w.reason === 'link_endpoint_unknown' || w.reason === 'exact_not_drawable'
      || w.reason === 'risk_not_in_slice') && onPath.has(model.links.find((l) => l.id === w.id)?.to ?? ''))
      || withheld.some((w) => RISK_REFUSED.has(w.reason) && onPath.has(w.id)) || [...droppedSettings].some((id) => onPath.has(id));
    // An unresolved PREREQUISITE on anything the chance rests on (the engine cannot hold one) withholds it, whoever raised it.
    // An applied ASSUMPTION carries a CONDITIONAL result, kept in the living model the AI reads and said with the result; a
    // CHALLENGE is said beside it. The AI declares the role; the source never decides it (AIE, 17:59 20 Oct).
    const pathLinks = new Set(allLinks.filter((l) => onPath.has(l.to)).map((l) => l.id));
    const conditioned = model.conditions.filter((c) => c.role === 'prerequisite' && c.applies_to.some((id) => onPath.has(id) || pathLinks.has(id)));
    for (const c of conditioned) hold(`condition:${c.text}`, 'condition_not_in_slice');
    if (leftOut || conditioned.length > 0) {
      for (const k of Object.keys(goalNode)) if (k.startsWith('goal_threshold') || k === 'goal_direction' || k === 'goal_deadline_as_stated') delete goalNode[k];
      hold(goal.id, 'chance_rests_on_withheld');
    }
  }

  const frames = new Map<string, Frame>(model.factors.flatMap((f) => (caps.has(f.id) ? [[f.id, { cap: caps.get(f.id)!, unit: f.unit }] as const] : [])));
  if (goal !== undefined) frames.set(goal.id, { cap: goal.cap, unit: goal.unit === '' ? null : goal.unit });
  return { graph: { nodes, edges }, withheld, frames, assumed };
}
