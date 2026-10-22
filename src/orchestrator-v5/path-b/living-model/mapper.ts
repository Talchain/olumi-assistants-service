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
import { LivingModel, type LivingModelT, type LivingSourceT } from '../../../schemas/living-model.js';
import { aimTargetReading, stated } from './aim-reading.js';
import { resolveGoalThresholdCapWithProvenance } from '../../../utils/goal-threshold-cap.js';
import { admitGoalBaseline } from '../../../cee/factor-extraction/goal-baseline-admissibility.js';
import { sayFigureAsWritten } from '../../agent-lane/say-figure.js';
import { LLM_STRENGTH_STD_FLOOR } from '../../../cee/constants.js';
import { readUnitParts, sameUnit, singular, unitsCompose, words } from '../../agent-lane/same-unit.js';
import { periodAdverb, periodNoun } from '../../../utils/unit-alphabet.js';
import { EventRiskV1 } from '../../../schemas/event-risk.js';
import { riskOccurrenceIsCurrent } from '../../agent-lane/risk-occurrence.js';
import { readStatedDeadline } from '../../goal-target/deadline-date.js';

export type WithheldReason =
  | 'no_level_target' | 'aim_not_in_slice' | 'change_kind_unknown' | 'change_base_invalid' | 'change_base_not_theirs' | 'current_unit_mismatch' | 'exact_target_not_in_slice' | 'target_range_not_in_slice'
  | 'goal_level_unknown' | 'link_frame_unknown' | 'link_goal_target_unknown' | 'link_goal_level_unknown' | 'chance_rests_on_withheld' | 'condition_not_in_slice'
  | 'goal_level_not_admitted' | 'factor_level_unknown' | 'level_range_not_in_slice' | 'setting_not_convertible'
  | 'link_endpoint_unknown' | 'link_unit_mismatch' | 'link_range_no_law' | 'link_sign_unknown'
  | 'exact_not_drawable' | 'stay_within_base_not_theirs' | 'stay_within_unconfirmed'
  | 'identity_not_in_slice' | 'identity_part_unknown' | 'identity_unit_mismatch' | 'identity_inconsistent'
  | 'identity_other_cause' | 'identity_contradicted' | 'identity_restated'
  | 'risk_occurrence_unknown' | 'risk_unattributed' | 'risk_not_in_slice' | 'risk_window_not_goal_window' | 'limit_not_in_slice'
  | 'target_not_theirs';

/** A definition that withholds the chance when its carrier is on the goal's path (it cannot be worked out as stated). */
const IDENTITY_REFUSED: ReadonlySet<WithheldReason> = new Set(['identity_not_in_slice', 'identity_part_unknown', 'identity_unit_mismatch', 'identity_inconsistent']);
/** A risk that cannot be sent as the event the person described withholds the chance when it is on the goal's path. */
const RISK_REFUSED: ReadonlySet<WithheldReason> = new Set(['risk_occurrence_unknown', 'risk_unattributed', 'risk_not_in_slice', 'risk_window_not_goal_window']);

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

/** The person's own words for keeping a level where it is (Science, 21 Oct). The cue only skips the question; it never sets the comparator or the number. */
const STAY_CUE = { '>=': /\b(keep|keeps|keeping|stay|stays|staying|at least|no less than|minimum)\b/i, '<=': /\b(keep|keeps|keeping|stay|stays|staying|at most|no more than|cap|capped)\b/i } as const;
/** An item the person set themselves on the canvas: theirs, with no words to quote (`edit.ts`). */
const edited = (a: { source: LivingSourceT; quote: string | null }): boolean => a.source === 'user' && a.quote === null;
/** user/party → their words (or their own edit); Olumi → its inference; unverified → no stamp (unknown). */
const levelSource = (a: { source: LivingSourceT; quote: string | null }): string | undefined =>
  edited(a) ? 'user_edited' : stated(a.source) ? 'brief_extraction' : a.source === 'olumi' ? 'cee_inference' : undefined;
/**
 * An option's setting in the intervention contract's own words (`InterventionV3.source`): the factor-level words above are
 * not members, so every core setting Olumi estimated or the person edited read "Source not recorded" (Lenses, 21 Oct).
 */
const settingSource = (a: { source: LivingSourceT; quote: string | null }): 'brief_extraction' | 'cee_hypothesis' | 'user_specified' | undefined =>
  edited(a) ? 'user_specified' : stated(a.source) ? 'brief_extraction' : a.source === 'olumi' ? 'cee_hypothesis' : undefined;
/** Per-figure authorship: a figure Olumi estimated on another's item is Olumi's, whatever the item's source (`estimate_by`). */
const OLUMI_FIGURE = { source: 'olumi' as LivingSourceT, quote: null };
const figureBy = (fig: { estimate_by?: 'olumi' | null }, item: { source: LivingSourceT; quote: string | null }) =>
  (fig.estimate_by === 'olumi' ? OLUMI_FIGURE : item);
const withSource = (o: Rec, a: { source: LivingSourceT; quote: string | null }): Rec => {
  const source = levelSource(a);
  return source === undefined ? o : { ...o, source, ...(stated(a.source) ? { extractionType: 'explicit' } : {}) };
};

/**
 * The frame a factor's levels are read on: '%' → 100, unitless [0,1] → 1, the goal's when the unit matches, else headroom.
 * Every level 0 (DL lease 22 Oct, served eb481e4a "Client delivery delay", 0 weeks, range 0 to 8): the stated range's top if
 * positive, else 1. A level of 0 reads 0 on any frame and links scale by the frame, so the figures do not move; without a
 * frame the level was held and the card read "Value not set yet".
 */
function capFor(levels: readonly number[], unit: string | null, goal: { cap: number; unit: string } | undefined,
  range: readonly (number | null)[] = []): number | undefined {
  const finite = levels.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return undefined;
  const top = Math.max(...finite.map(Math.abs));
  if (unit === '%') return 100;
  if (goal !== undefined && unit !== null && unit === goal.unit && goal.cap >= top) return goal.cap;
  if (unit === null && finite.every((v) => v >= 0 && v <= 1)) return 1;
  if (top > 0) return top * 1.25;
  const rangeTop = Math.max(0, ...range.filter((v): v is number => v !== null && Number.isFinite(v)));
  return rangeTop > 0 ? rangeTop : 1;
}

/**
 * The deadline as the legacy lane holds it (`goal_horizon.deadline`, `goal-horizon-write.ts`), read by the existing parser, so
 * the existing licence gives the legacy reason (Codex r6 on #3522). The mapper has no clock and regenerates on every revision,
 * so only a date its own words fix is held: a calendar date, or a quarter, month or year end, with its year stated. Words that
 * need today ("in six months", "by March") stay words, as the legacy lane fixes those only on the person's Yes to a date card.
 */
function statedDeadline(byWhen: string | null): string | undefined {
  if (byWhen === null) return undefined;
  const read = readStatedDeadline(byWhen, '0001-01-01');
  // Its year is bound by the words themselves: a whole four-digit year in them, never a relative year read against the reference
  // (Codex r1 on #3577: "Review 2032-03 plan by March next year" made "2-03-31", which a substring check let through).
  const year = /^(\d{4})-\d{2}-\d{2}$/.exec(read?.date ?? '')?.[1];
  return read !== null && year !== undefined && Number(year) >= 1000 && new RegExp(`\\b${year}\\b`).test(byWhen)
    && ['date', 'quarter_end', 'month_end', 'year_end'].includes(read.form) ? read.date : undefined;
}

/** The goal a saved graph was compiled with: a regeneration keeps it unless its aim is no longer current. */
export function goalIdOf(graph: unknown): string | undefined {
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  const goal = Array.isArray(nodes) ? nodes.find((n) => (n as { kind?: unknown } | null)?.kind === 'goal') as { id?: unknown } | undefined : undefined;
  return typeof goal?.id === 'string' ? goal.id : undefined;
}

/** The options that keep a saved graph's goal (none when it has none). */
export const savedGoal = (graph: unknown): { goal?: string } => { const goal = goalIdOf(graph); return goal === undefined ? {} : { goal }; };

// The other half of the one composition rule (DL 22 Oct, served board 6ce4f6ae: "£ per loaf" × "loaves a week" was refused):
// money per X times a count of X is money, with ONE period across the two parts and it the defined quantity's own
// ("£ per week"). `unitsCompose` reads money per X per period × a count; the denominator naming the count's noun is the
// dimensional proof either way. Unscaled, unqualified units only; two periods ("£ per loaf per week" × "loaves a week") never.
// Every word is accounted for, by its place (Codex r1 + r2 on #3627: flattening dropped a count's own denominator,
// "users per account per week"; collapsed "week/week"; folded "thousand" into the noun; read "person-weeks" as a rate).
// A period is a rate's only as the unit's LAST word, an adverb ("weekly") or after per, "/", a or an; any other period
// word is a duration or a second period and refuses it.
const RATE_CONNECTORS = new Set(['per', '/', 'a', 'an']);
const unitShapeOf = (u: string | null): { readonly head: readonly string[]; readonly period: string | null } | null => {
  const ws = u === null ? [] : words(u);
  let end = ws.length;
  let period: string | null = null;
  const last = ws[end - 1];
  if (last !== undefined && periodAdverb(last) !== null) { period = periodAdverb(last); end -= 1; }
  else if (last !== undefined && periodNoun(last) !== null) {
    if (end < 2 || !RATE_CONNECTORS.has(ws[end - 2]!)) return null;
    period = periodNoun(last); end -= 2;
  }
  const head = ws.slice(0, end);
  return head.some((w) => periodNoun(w) !== null || periodAdverb(w) !== null) ? null : { head, period };
};
const plainMoney = (w: string | undefined, code: string | null): boolean => {
  const m = w === undefined ? null : readUnitParts(w);
  return m !== null && m.kind === 'currency' && m.scale === 1 && m.per === null && m.period === null && m.code === code;
};
const ratePerCountComposes = (whole: string | null, a: string | null, b: string | null): boolean => {
  const g = readUnitParts(whole);
  const gs = unitShapeOf(whole);
  if (g === null || g.kind !== 'currency' || gs === null || gs.head.length !== 1 || !plainMoney(gs.head[0], g.code)) return false;
  return ([[a, b], [b, a]] as const).some(([m, c]) => {
    const rate = unitShapeOf(m);
    const count = unitShapeOf(c);
    if (rate === null || count === null || readUnitParts(c)?.kind !== 'count') return false;
    // A CLOSED grammar (Codex r3 on #3627: "each"/"every" made a two-dimension denominator read as one): money, then per or
    // "/", then ONE word, and the count is that same ONE word. A many-word denominator ("per user account") is refused,
    // never parsed: the person is asked, as for any identity that cannot be worked out as stated.
    const [money, sep, den, ...extra] = rate.head;
    const [noun, ...more] = count.head;
    const oneWord = (w: string | undefined): w is string => w !== undefined && /^[a-z]+$/.test(w) && !RATE_CONNECTORS.has(w);
    if (!plainMoney(money, g.code) || (sep !== 'per' && sep !== '/') || extra.length > 0 || more.length > 0 || !oneWord(den) || !oneWord(noun)) return false;
    if (singular(den) !== singular(noun)) return false;
    const periods = [rate.period, count.period].filter((p): p is string => p !== null);
    return periods.length <= 1 && (periods[0] ?? null) === gs.period;
  });
};

type Definition = NonNullable<LivingModelT['factors'][number]['defined_as']>;
/**
 * What a definition makes, and why it cannot be worked out as stated, by ONE rule for the identity the engine evaluates and
 * for the goal's level today it gives (a part unknown, units that do not compose, a stated level its parts do not make). Its
 * place in the graph (a carrier, no cycle) is the identity's own check.
 */
function definitionCheck(model: LivingModelT, def: Definition, itemId: string, unit: string | null, label: string, level: number | null):
  { readonly reason?: WithheldReason; readonly made: number; readonly parts: readonly LivingModelT['factors'][number][] } {
  const { op, of } = def;
  const found = of.map((id) => model.factors.find((f) => f.id === id));
  const values = found.map((p) => p?.value ?? null);
  // Exact: a definition's stated level is what its parts make. The engine would rescale a product to fit (ISL's k).
  const made = op === 'sum' ? values.reduce<number>((a, v) => a + (v ?? 0), 0) : values.reduce<number>((a, v) => a * (v ?? 0), 1);
  if (of.length < 2 || new Set(of).size !== of.length || of.includes(itemId) || found.some((p) => p === undefined)
    || (op === 'product' && of.length !== 2)) return { reason: 'identity_not_in_slice', made, parts: [] };
  const parts = found as LivingModelT['factors'][number][];
  const reason: WithheldReason | undefined = values.some((v) => v === null) ? 'identity_part_unknown'
    : (op === 'sum' ? !parts.every((p) => sameUnit(p.unit, unit))
      : unitsCompose(unit, label, { unit: parts[0]!.unit, label: parts[0]!.label }, { unit: parts[1]!.unit, label: parts[1]!.label }).kind !== 'proof'
        && !ratePerCountComposes(unit, parts[0]!.unit, parts[1]!.unit))
      ? 'identity_unit_mismatch'
      : level !== null && Math.abs(level - made) > 1e-9 * Math.max(1, Math.abs(level)) ? 'identity_inconsistent' : undefined;
  return { ...(reason === undefined ? {} : { reason }), made, parts };
}

/** A figure as the decimal it is written as (its shortest exact digits), or undefined when not finite or in exponent form. */
const decimalOf = (v: number): { readonly digits: bigint; readonly places: number } | undefined => {
  // Not a decimal at all (the schema admits Infinity; Codex r3): nothing is worked out, never a throw.
  if (!Number.isFinite(v)) return undefined;
  const t = String(v);
  if (/e/i.test(t)) return undefined;
  const [whole, frac = ''] = t.replace(/^-/, '').split('.');
  return { digits: BigInt(`${t.startsWith('-') ? '-' : ''}${whole}${frac}`), places: frac.length };
};
/** The decimal digits back as written text ("6.9", "-0.5", "840"), with no trailing zeros. */
function decimalText(digits: bigint, places: number): string {
  const neg = digits < 0n;
  const d = (neg ? -digits : digits).toString().padStart(places + 1, '0');
  const frac = places === 0 ? '' : d.slice(-places).replace(/0+$/, '');
  return `${neg ? '-' : ''}${places === 0 ? d : d.slice(0, -places)}${frac === '' ? '' : `.${frac}`}`;
}
/**
 * A definition's level from its parts in exact decimal arithmetic (3 × 2.3 is 6.9, never 6.8999999999999995; a sum that
 * cancels keeps every digit; Codex r1/r2), with its exact text; undefined when a part is in exponent form: nothing is
 * worked out rather than a figure near it.
 */
function exactlyMade(op: 'sum' | 'product', values: readonly number[]): { readonly level: number; readonly text: string } | undefined {
  const parts = values.map(decimalOf);
  if (parts.some((p) => p === undefined)) return undefined;
  const ds = parts as { readonly digits: bigint; readonly places: number }[];
  const places = op === 'sum' ? Math.max(...ds.map((p) => p.places)) : ds.reduce((a, p) => a + p.places, 0);
  const digits = op === 'sum' ? ds.reduce((a, p) => a + p.digits * 10n ** BigInt(places - p.places), 0n)
    : ds.reduce((a, p) => a * p.digits, 1n);
  const text = decimalText(digits, places);
  return { level: Number(text) + 0, text };
}
/** A figure exactly as written ("£3 per loaf", "280 loaves a day", "£0.000001000000000000001"): its digits, never rounded. */
function sayExactly(written: string, unit: string | null): string {
  const n = written.replace(/^(-?)(\d+)/, (_m, sign: string, whole: string) => `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`);
  const u = (unit ?? '').trim();
  const money = /^([£$€])\s*(.*)$/.exec(u);
  return money !== null ? `${money[1]}${n}${money[2] === '' ? '' : ` ${money[2]}`}` : u === '%' ? `${n}%` : u === '' ? n : `${n} ${u}`;
}

/** No one's figure: `withSource` stamps nothing (a worked-out level, read as unverified, never as Olumi's estimate). */
const UNSTAMPED = { source: 'unverified' as LivingSourceT, quote: null };

/**
 * The goal's level today worked out from the person's OWN definition of it ("revenue = coffees sold × price", theirs, not
 * Olumi's reading) and their OWN point figures for its parts, by the identity's one rule (`definitionCheck`): never from a
 * figure Olumi estimated or a range, never from a part itself defined by others (the identity's cycle check). Exact, so the
 * engine's identity reproduces it; the mapper's consistency check would require a stated level to equal it anyway.
 */
function levelFromDefinition(model: LivingModelT, aim: LivingModelT['aims'][number]): { readonly level: number; readonly said: string } | undefined {
  const def = aim.defined_as;
  const t = aim.target;
  if (def === null || t === null || !stated(def.source)) return undefined;
  if (def.of.some((id) => model.factors.find((f) => f.id === id)?.defined_as)) return undefined;
  const check = definitionCheck(model, def, aim.id, t.unit, t.quantity ?? aim.text, null);
  if (check.reason !== undefined || !check.parts.every((p) => p.value !== null && p.low === null && p.high === null
    && p.estimate_by !== 'olumi' && stated(p.source))) return undefined;
  const made = exactlyMade(def.op, check.parts.map((p) => p.value!));
  if (made === undefined) return undefined;
  const sign = def.op === 'sum' ? ' + ' : ' × ';
  const said = `Today\u2019s ${t.quantity} is worked out from your figures: ${check.parts.map((p) => `${p.label} ${sayExactly(String(p.value), p.unit)}`).join(sign)}`
    + ` = ${sayExactly(made.text, t.unit)}.`;
  return { level: made.level, said };
}

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
  let goalHeld: WithheldReason | undefined;
  let goalNode: Rec | undefined;
  if (aim === undefined) hold('goal', 'no_level_target');
  else {
    goalNode = { id: aim.id, kind: 'goal', label: aim.text, ...(aim.quote !== null ? { source_quote: aim.quote } : {}) };
    nodes.push(goalNode);
    const t = aim.target;
    const isChange = t !== null && (t.comparator === 'increase' || t.comparator === 'decrease');
    // The ONE reading of the aim's target (`aim-reading.ts`), shared with the gap that says its held reason.
    const lt = aimTargetReading(aim);
    // Today's level as the person gave it, or (a level target only) worked out exactly from their own confirmed definition
    // and their own figures (café pre-flight 23 Oct: 280 coffees × £3 is today's £840), never from Olumi's.
    const derived = t !== null && t.current === null && !isChange ? levelFromDefinition(model, aim) : undefined;
    const current = t === null ? null : t.current ?? derived?.level ?? null;
    if (typeof lt === 'string') { goalHeld = lt; hold(aim.id, lt); }
    else {
      const fromTarget = resolveGoalThresholdCapWithProvenance(undefined, lt.value, lt.unit ?? undefined, undefined);
      // The goal's frame holds today's level too: a ceiling below today would put today off its own scale ('level_frame').
      const resolved = fromTarget !== null && fromTarget.provenance !== 'metric_scale' && current !== null && current * 1.25 > fromTarget.cap
        ? { cap: current * 1.25, provenance: 'level_frame' as const } : fromTarget;
      if (resolved === null) hold(aim.id, 'goal_level_not_admitted');
      else {
        goal = { id: aim.id, cap: resolved.cap, unit: lt.unit ?? '' };
        const deadline = statedDeadline(t!.by_when);
        Object.assign(goalNode, {
          goal_direction: lt.comparator,
          goal_threshold_raw: lt.value, goal_threshold_unit: lt.unit ?? '', goal_threshold_cap: resolved.cap,
          goal_threshold_cap_provenance: resolved.provenance, goal_threshold: lt.value / resolved.cap, goal_threshold_frame: 'level',
          ...(t!.by_when !== null ? { goal_deadline_as_stated: t!.by_when } : {}),
          ...(deadline !== undefined ? { goal_horizon: { deadline } } : {}),
          // DL ruling 22 Oct (goal-window carrier): the person's own duration counted from today ("within 12 months") is the
          // goal's window as Olumi's reading (`goalTargetBasisOf`), so an Olumi risk over that same window counts
          // (`riskOccurrenceWindowMonths`). The effects are NOT read as in place by its end (`effects_at_period_end: false`), so
          // the chance stays the static reading (`goalHorizonVerdict` → no_horizon) and no window is claimed for it. A level
          // target only; a change target is not covered yet.
          ...(!isChange && t!.period_months !== null && Number.isInteger(t!.period_months) && t!.period_months >= 1 && t!.period_months <= 120
            && lt.unit !== null && lt.unit.trim() !== '' ? { goal_target_basis: { source: 'olumi_reading', quantity_frame: 'level', target_frame: 'level',
              target_raw: lt.value, reference: 'today', period_months: t!.period_months, period_kind: 'at_end', effect_unit: lt.unit,
              effects_at_period_end: false } } : {}),
        });
        if (current === null) hold(aim.id, 'goal_level_unknown');
        else {
          // "Stay within" (Science, 21 Oct): a floor today already clears, or a ceiling today already sits under, is a valid
          // goal, scored on the level at the end of the horizon (not along the way). Only on the person's own level today
          // (an Olumi estimate is asked for), and read silently only when their words say so; otherwise Olumi asks once.
          const stays = lt.comparator === '<=' ? current <= lt.value : current >= lt.value;
          const level = stays && !(t!.current_source === 'user' || stated(aim.source)) ? 'stay_within_base_not_theirs' as const
            : stays && !STAY_CUE[lt.comparator].test(aim.quote ?? '') ? 'stay_within_unconfirmed' as const
            : admitGoalBaseline({ rawTarget: lt.value, rawBaseline: current, cap: resolved.cap, ...(lt.comparator === '<=' ? { ceiling: true } : {}),
              ...(stays ? { stayWithin: true } : {}) });
          if (typeof level === 'string') hold(aim.id, level);
          else if (!level.admitted) hold(aim.id, 'goal_level_not_admitted');
          else {
            goalNode.observed_state = withSource({ value: level.normalised, baseline: level.normalised, raw_value: current, cap: resolved.cap, unit: lt.unit ?? '' },
              // A worked-out level is no one's statement: unstamped, and said beside the result how it was worked out.
              derived !== undefined ? UNSTAMPED : t!.current_source === 'user' ? { source: 'user', quote: null } : aim);
            if (derived !== undefined) assumed.push({ id: aim.id, text: derived.said });
            // A change is measured from today only if carrying on as now leaves the quantity there (amendment 1): said beside it.
            if (stays) {
              const say = (v: number) => sayFigureAsWritten(v, lt.unit ?? '');
              assumed.push({ id: aim.id, text: `Keep ${t!.quantity} at or ${lt.comparator === '<=' ? 'below' : 'above'} ${say(lt.value)} (today ${say(current)}). The chance is for its level at the end of ${(t!.by_when ?? 'the period').replace(/^(at |by )?(the )?end of /i, '')}, not along the way.` });
            }
            if (isChange) assumed.push({ id: aim.id, text: `Carrying on as now leaves ${t!.quantity} at today's ${sayFigureAsWritten(current, lt.unit ?? '')}; the change is measured from that.` });
          }
        }
      }
    }
  }

  // Joint goals are not in this slice: every other current aim with a target is kept in the living model, withheld here.
  for (const a of model.aims) if (a !== aim && a.status === 'current' && a.target !== null) hold(a.id, 'aim_not_in_slice');

  // ── A mitigation is a switch: one risk's step, unitless, off today, set only to 0 or 1, with no cause of its own.
  const isRisk = (id: string) => model.risks.some((r) => r.id === id);
  const isSwitch = (id: string) => {
    const f = model.factors.find((x) => x.id === id);
    return f !== undefined && f.unit === null && f.value === 0 && !model.links.some((l) => l.to === id)
      && model.options.every((o) => o.settings.every((s) => s.factor_id !== id || s.value === 0 || s.value === 1))
      && model.risks.filter((r) => r.mitigations.some((m) => m.factor_id === id)).length === 1;
  };
  // ISL's preventer may feed only its risk, so a switch's own effects ("costs £1k a month") are said of the ONE option that
  // turns it on, and reach the engine by that option's route below: the same effect on the same draws. With two such
  // options, or one already stating its own effect on the same item, nothing moves and the risk is refused by name below.
  const moved = new Map<string, string>();
  for (const id of new Set(model.risks.flatMap((r) => r.mitigations.map((m) => m.factor_id)))) {
    const on = model.options.filter((o) => o.settings.some((s) => s.factor_id === id && s.value === 1));
    const clash = model.links.some((l) => l.from === id && !isRisk(l.to) && model.links.some((x) => x.from === on[0]?.id && x.to === l.to));
    if (isSwitch(id) && on.length === 1 && !clash) moved.set(id, on[0]!.id);
  }
  if (moved.size > 0) model = { ...model, links: model.links.map((l) => (moved.has(l.from) && !isRisk(l.to) ? { ...l, from: moved.get(l.from)! } : l)) };

  // ── An option's own effect on the goal becomes a factor the options set (see the header). Same ids, same attribution.
  const optionIds = new Set(model.options.map((o) => o.id));
  const direct = goal === undefined ? [] : model.links.filter((l) => optionIds.has(l.from) && l.to === goal!.id);
  let exactSum: { readonly lever: string; readonly today: string } | undefined;
  // A goal the person defines (Track 2) is worked out from its definition, so an option's own effect on it is another cause.
  if (direct.length > 0 && goal !== undefined && goalNode?.observed_state !== undefined && !aim!.defined_as) {
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
        factors: [...model.factors, { id: lever, label: `Change in ${aim!.target!.quantity}`, kind: 'factor', estimate_by: null, value: 0, low: null, high: null,
          unit: g.unit === '' ? null : g.unit, defined_as: null, limit: null, source: 'olumi', party: null, quote: null }],
        options: model.options.map((o) => {
          const l = direct.find((d) => d.from === o.id);
          return l === undefined ? o : { ...o, settings: [...o.settings, { factor_id: lever, estimate_by: l.effect.estimate_by, value: (l.effect.sign === '-' ? -1 : 1) * Math.abs(l.effect.value!),
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
  /** The switches made here, exactly: never a person's own factor whose id happens to look like one (Codex #3556 R1). */
  const switches = new Set<string>();
  if (fromOption.length > 0) {
    const on = (optionId: string) => `${optionId}__on`;
    for (const l of fromOption) switches.add(on(l.from));
    model = { ...model,
      factors: [...model.factors, ...[...new Set(fromOption.map((l) => l.from))].map((id) => ({ id: on(id),
        label: `${model.options.find((o) => o.id === id)!.label} in place`, kind: 'factor' as const, estimate_by: null, value: 0, low: null, high: null, unit: null, defined_as: null, limit: null,
        source: 'olumi' as const, party: null, quote: null }))],
      options: model.options.map((o) => {
        const l = fromOption.find((d) => d.from === o.id);
        return l === undefined ? o : { ...o, settings: [...o.settings, { factor_id: on(o.id), estimate_by: null, value: 1, low: null, high: null, unit: null, source: l.source, party: l.party, quote: l.quote }] };
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
    const cap = exactSum !== undefined && f.id === exactSum.lever ? goal!.cap : capFor(levels, f.unit, goal, [f.low, f.high]);
    if (cap !== undefined) caps.set(f.id, cap);
    const node: Rec = { id: f.id, kind: 'factor', label: f.label, category: setsFactor.has(f.id) ? 'controllable' : 'observable',
      // The exact sum's change: 0 today by definition (the contract's marker), so the engine holds it exact.
      ...(f.id === exactSum?.lever ? { quantity_frame: 'change' } : {}) };
    if (f.value !== null && cap !== undefined) {
      current.set(f.id, f.value);
      node.observed_state = withSource({ value: f.value / cap, raw_value: f.value, cap, unit: f.unit ?? '' }, figureBy(f, f));
      // A central figure with a range (the link's "centred" rule): the figure is used; the range is kept, not used as a spread.
      // Neutral words: the figure may be Olumi's estimate, never called "stated" (Codex); the card says whose it is.
      if (f.low !== null && f.high !== null) assumed.push({ id: f.id, text: `The calculation uses ${sayFigureAsWritten(f.value, f.unit ?? '')} for ${f.label}. The range, ${sayFigureAsWritten(f.low, f.unit ?? '')} to ${sayFigureAsWritten(f.high, f.unit ?? '')}, is kept with the model but is not used as a spread.` });
    } else hold(f.id, f.low !== null || f.high !== null ? 'level_range_not_in_slice' : 'factor_level_unknown');
    nodes.push(node);
  }

  // ── Limits (Track 2): a bound beside the aim, as the legacy lane's limit row (`add_constraint`), read on the factor's frame.
  // Never widened to fit (that rescales the factor's links, Codex r1): a limit off the frame is held, as add_constraint refuses it.
  const goal_constraints = model.factors.flatMap((f) => {
    const l = f.limit ?? null;
    if (l === null) return [];
    if (!current.has(f.id) || l.value < 0 || l.value > caps.get(f.id)!) { hold(f.id, 'limit_not_in_slice'); return []; }
    const strict = l.comparator === '<' || l.comparator === '>';
    return [{ constraint_id: `limit_${f.id}`, node_id: f.id, operator: l.comparator.startsWith('<') ? '<=' : '>=',
      ...(strict ? { operator_as_stated: l.comparator } : {}), value: l.value, label: f.label, provenance: stated(l.source) ? 'explicit' : 'inferred',
      ...(l.quote !== null && l.quote.length <= 200 ? { source_quote: l.quote } : {}), value_frame: 'level', ...(f.unit !== null ? { unit: f.unit } : {}) }];
  });

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
        value: raw / cap, raw_value: raw, unit: unit ?? '', ...(settingSource(source) !== undefined ? { source: settingSource(source) } : {}),
        // The person's stated setting is attested as theirs, exactly as `withSource` attests a stated level (else every core
        // Run said "could not confirm where some figures came from" about the person's own option, KA1 21 Oct).
        ...(stated(source.source) && !edited(source) ? { extractionType: 'explicit' } : {}),
        target_match: { node_id: factorId, match_type: 'exact_id', confidence: 'high' },
      };
    };
    for (const s of o.settings) {
      const factor = model.factors.find((f) => f.id === s.factor_id);
      if (factor === undefined || s.value === null || (s.unit !== null && factor.unit !== null && s.unit !== factor.unit)) {
        droppedSettings.add(s.factor_id);
        hold(`${o.id}:${s.factor_id}`, 'setting_not_convertible');
      } else set(s.factor_id, s.value, s.unit ?? factor.unit, figureBy(s, s));
    }
    // The status quo holds every controllable factor at its current level, explicitly.
    if (isBaseline) for (const id of setsFactor) if (interventions[id] === undefined && current.has(id)) set(id, current.get(id)!, model.factors.find((f) => f.id === id)!.unit, { source: 'olumi', quote: null });
    // A ruled-out option stays on the board, out of the comparison: the legacy status, which the Run's option gate honours.
    const out = o.status === 'infeasible' || o.status === 'removed' ? { option_status: o.status, analysis_participation: 'retained_excluded' } : {};
    nodes.push({ id: o.id, kind: 'option', label: o.label, ...(isBaseline ? { is_baseline: true } : {}), ...(Object.keys(interventions).length > 0 ? { interventions } : {}), ...out });
    edges.push({ from: decisionId, to: o.id, ...STRUCTURAL, provenance: { source: 'cee_hypothesis' } });
    for (const id of Object.keys(interventions)) edges.push({ from: o.id, to: id, ...STRUCTURAL, provenance: { source: 'cee_hypothesis' } });
  }


  // ── Identities (Track 2): what a quantity IS, defined as the sum or product of factors. ISL works it out exactly from
  // its parts' levels and never draws them, so the parts' edges are definitional, held at 1 with no existence doubt. A
  // definition that cannot be worked out as stated (a part unknown, units that do not compose, a stated level its parts
  // do not make, definitions defined by each other) is refused by name, and a chance resting on it is withheld below;
  // it is never filled in, rescaled or approximated by a drawn link.
  const declared = [
    ...model.factors.map((f) => ({ item: f, carrier: nodes.find((n) => n.id === f.id), unit: f.unit, label: f.label, level: f.value })),
    ...(aim === undefined ? [] : [{ item: aim, carrier: goalNode, unit: aim.target?.unit ?? null, label: aim.target?.quantity ?? aim.text,
      level: aim.target?.current ?? null }]),
  ].filter((d) => d.item.defined_as);
  const partsOf = new Map(declared.map((d) => [d.item.id, d.item.defined_as!.of] as const));
  const inCycle = (id: string, seen: ReadonlySet<string> = new Set()): boolean =>
    seen.has(id) || (partsOf.get(id) ?? []).some((p) => partsOf.has(p) && inCycle(p, new Set([...seen, id])));
  const identities = new Map<string, { readonly op: 'sum' | 'product'; readonly of: readonly string[]; readonly unit: string | null }>();
  for (const { item, carrier, unit, label, level } of declared) {
    const def = item.defined_as!;
    const { op, of } = def;
    const reason: WithheldReason | undefined = carrier === undefined || inCycle(item.id) ? 'identity_not_in_slice'
      : definitionCheck(model, def, item.id, unit, label, level).reason;
    if (reason !== undefined) { hold(item.id, reason); continue; }
    identities.set(item.id, { op, of, unit });
    // Who stated the DEFINITION (its own attribution), never who stated the quantity: an unverified one is no one's yet.
    carrier!.nonlinear_identity = { operation: op, factor_ids: [...of], stated_in_brief: stated(def.source) };
    const who = stated(def.source) ? { source: edited(def) ? 'user_specified' : 'brief_extraction', magnitude: 'user_stated' }
      : def.source === 'olumi' ? { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } : {};
    for (const part of of) {
      edges.push({ id: `${part}__${item.id}`, from: part, to: item.id, strength: { mean: 1, std: LLM_STRENGTH_STD_FLOOR }, exists_probability: 1,
        effect_direction: 'positive', provenance: { ...who, definitional: true } });
    }
  }
  /**
   * A link from a part into its defined quantity restates the definition when it says nothing else: a positive sign and,
   * if sized, the definition's own coefficient (1 for a sum; the other part's level for a product, at today's levels).
   * Anything else (a negative sign, another size) contradicts it, so the chance on it is withheld: never silently dropped.
   */
  const restates = (l: LivingModelT['links'][number], d: { op: 'sum' | 'product'; of: readonly string[]; unit: string | null }): boolean => {
    const e = l.effect;
    if (e.sign === '-') return false;
    const coefficient = d.op === 'sum' ? 1 : d.of.filter((p) => p !== l.from).reduce((a, p) => a * (model.factors.find((f) => f.id === p)?.value ?? NaN), 1);
    const same = (v: number | null) => v !== null && Math.abs(Math.abs(v) - coefficient) <= 1e-9 * Math.max(1, Math.abs(coefficient));
    // A spread the person stated (a Normal law, a range) says the link is uncertain; a definition is exact (buddy r2).
    if ((e.form === 'normal' || e.form === 'point') && e.sd !== null && e.sd > 0) return false;
    if (e.form === 'range' && (e.low !== null || e.high !== null) && !(same(e.low) && same(e.high))) return false;
    const size = e.form === 'point' || e.form === 'exact' || e.form === 'normal' || e.form === 'range' ? e.value : null;
    return (size === null || same(size)) && (e.unit === null || d.unit === null || sameUnit(e.unit, d.unit));
  };

  // ── Risks (Track 2): an EVENT that may happen within a window, sent as ISL's event_risk.v1 (#228), which owns its
  // semantics: occurrence drawn once per scenario, the stated chance scaled down while a mitigation is in place, and what
  // it does if it happens as ordinary links from it (per +1: it happening). Its chance, window and whose figures they are
  // are the person's or Olumi's as stated, never guessed (an Olumi chance is sent as Olumi's). A present condition is never
  // an event (Science §3C): the AI is told so, since no rule here can tell one from an event certain within its window
  // (p = 1, which ISL evaluates). A cause INTO an event (a cascade) is not in this slice (§9). Anything else is refused.
  const risks = new Set<string>();
  const refusedRisks = new Set<string>();
  for (const r of model.risks) {
    const { low, high } = r.occurrence;
    // The chance is owned FOR its window: Olumi's estimate of either makes the chance Olumi's (buddy, per-figure authorship).
    const basis = r.occurrence.estimate_by === 'olumi' || r.horizon_by === 'olumi' ? 'olumi' as const
      : stated(r.source) ? 'user' as const : r.source === 'olumi' ? 'olumi' as const : undefined;
    // A mitigation reaches ISL as a root switch whose only child is this risk. A switch has no unit, so its frame is 1 and
    // "in place" reaches the engine as 1, never 0.01 of a % (`capFor`).
    const switchOk = (id: string) => isSwitch(id) && !model.links.some((l) => l.from === id && l.to !== r.id);
    const block = basis === undefined || low === null || high === null || r.horizon_months === null ? undefined : {
      version: 1 as const, occurrence: { p_low: low, p_high: high, basis }, horizon: { months: r.horizon_months },
      ...(r.mitigations.length > 0 ? { mitigations: r.mitigations.map((m) => ({ factor_id: m.factor_id, occurrence_reduction: m.reduction })) } : {}),
    };
    const node: Rec = { id: r.id, kind: 'risk', label: r.label, event_risk: block, ...(r.quote !== null ? { source_quote: r.quote } : {}) };
    // DL lease 22 Oct (candidate 4b, Q2 0/14 Run ok): Olumi's chance counts only over the goal's current window, by the SAME
    // predicate readiness reads (`riskOccurrenceIsCurrent`), so the two cannot drift; off it the risk is held, never sent as
    // a level readiness then refuses as "no figure" (no window is ever guessed, AIE). DL ruling 23 Oct: mitigated or not, an
    // occurrence over another window is a wrong quantity, so a mitigated one is held too, with its preventer below.
    const reason: WithheldReason | undefined = low === null || high === null || r.horizon_months === null ? 'risk_occurrence_unknown'
      : basis === undefined ? 'risk_unattributed'
        : !EventRiskV1.safeParse(block).success || !r.mitigations.every((m) => switchOk(m.factor_id)) ? 'risk_not_in_slice'
          : !riskOccurrenceIsCurrent(node, { nodes, edges }) ? 'risk_window_not_goal_window' : undefined;
    if (reason === 'risk_window_not_goal_window') {
      // The preventer goes with its risk: a switch whose only child is this risk (`switchOk`) would otherwise reach nothing
      // (NO_PATH_TO_GOAL). Its node, every option's setting on it, its links, any limit on it and any line said about its
      // figure leave the engine graph and the AI's assumptions, and it is held by name. A switch that is also a part of a
      // definition reaches the goal through it, so it stays (Codex r1).
      for (const m of r.mitigations) {
        const id = m.factor_id;
        if (declared.some(({ item }) => item.defined_as!.of.includes(id))) continue;
        goal_constraints.splice(0, goal_constraints.length, ...goal_constraints.filter((c) => c.node_id !== id));
        assumed.splice(0, assumed.length, ...assumed.filter((x) => x.id !== id));
        nodes.splice(0, nodes.length, ...nodes.filter((n) => n.id !== id));
        for (const n of nodes) {
          const iv = n.kind === 'option' && typeof n.interventions === 'object' && n.interventions !== null ? n.interventions as Rec : undefined;
          if (iv === undefined || !(id in iv)) continue;
          delete iv[id];
          if (Object.keys(iv).length === 0) delete n.interventions;
        }
        edges.splice(0, edges.length, ...edges.filter((e) => e.to !== id && e.from !== id));
        caps.delete(id); current.delete(id);
        hold(id, 'risk_window_not_goal_window');
      }
    }
    if (reason !== undefined) { hold(r.id, reason); refusedRisks.add(r.id); continue; }
    risks.add(r.id);
    nodes.push(node);
    // The preventer's link: its strength is not read (the stated reduction is), so it carries no doubt of its own. Whose
    // reduction it is comes from the mitigation's OWN attribution, never the risk's (codex integration review, 21 Oct):
    // user/party → their words; Olumi → its estimate; unverified → no stamp (unknown), as for a link.
    for (const m of r.mitigations) {
      const who = stated(m.source) ? { source: edited(m) ? 'user_specified' : 'brief_extraction', magnitude: 'user_stated' }
        : m.source === 'olumi' ? { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } : {};
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
  const hedged = new Set(model.conditions.filter((c) => c.role === 'assumption').flatMap((c) => c.applies_to));
  for (const l of model.links) {
    // What a refused risk would do is said once, by the risk's own reason; a cause INTO an event is not in this slice.
    if (refusedRisks.has(l.from) && !refusedRisks.has(l.to) && !risks.has(l.to)) continue;
    if (risks.has(l.to) || refusedRisks.has(l.to)) { hold(l.id, 'risk_not_in_slice'); continue; }
    if (!causal.has(l.from) || !causal.has(l.to)) { hold(l.id, 'link_endpoint_unknown'); continue; }
    // A defined quantity is its definition: a link from one of its parts restates it (kept in the living model, never
    // counted twice); a link from anything else is a cause the definition leaves out, so the chance on it is withheld.
    const definition = identities.get(l.to);
    if (definition !== undefined) {
      hold(l.id, !definition.of.includes(l.from) ? 'identity_other_cause' : restates(l, definition) ? 'identity_restated' : 'identity_contradicted');
      continue;
    }
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
    // A point with the source's own standard deviation ("50 on average, standard deviation 10") keeps that SD (A5, 21 Oct:
    // the SD was saved and then replaced by half the effect). Its shape was not stated, so the Normal draw is Olumi's
    // assumption, said in the ledger below; the person's link is never promoted to a Normal law they stated (buddy 21:28Z).
    const statedSd = e.form === 'point' && e.value !== null && e.sd !== null && e.sd > 0 ? e.sd : null;
    // Whose SD it is, as for any figure: an unconfirmed source is never Olumi's (Codex r1 on #3606).
    const sdBy = (s: LivingSourceT): string => (s === 'olumi' ? 'Olumi\'s estimated' : stated(s) ? 'the stated' : 'the given (its source is not confirmed)');
    const sized = ratio === undefined ? undefined : ((e.form === 'point' || centred) && e.value !== null)
      ? { mean: sign * Math.abs(e.value) * ratio, std: (statedSd ?? Math.abs(e.value) / 2) * ratio }
      : (e.form === 'normal' && e.value !== null && e.sd !== null && e.sd > 0)
        ? { mean: sign * Math.abs(e.value) * ratio, std: e.sd * ratio }
        // Stated exact, but on a drawn link: kept at the floor spread so the model still runs, while its chance is withheld,
        // since any drawn spread can turn a deterministic "meets" into about 50% (AIE 17:59, point 4). The exact sum is the
        // one exact route.
        : (e.form === 'exact' && e.value !== null) ? { mean: sign * Math.abs(e.value) * ratio, std: LLM_STRENGTH_STD_FLOOR }
        : undefined;
    // A figure INTO the goal while the goal has no scale yet, because its target states no figure or its change target has no
    // level today to be measured from: the figure is kept and used once that input is given (DL 23 Oct, Q2 coaching zeros;
    // Track 3 funding/hiring). It is never called "not sized" (`linksAwaitingGoalInput`).
    const target = aim?.target ?? null;
    const intoFramelessGoal = from !== undefined && goal === undefined && goalNode !== undefined && l.to === goalNode.id;
    // Only a figure that would be sized once the goal has its scale (the branches of `sized` above); a link with no figure
    // of its own is unsized, and keeps that reason (Codex r1 on this fix).
    const drawable = ((e.form === 'point' || centred) && e.value !== null) || (e.form === 'normal' && e.value !== null && e.sd !== null && e.sd > 0)
      || (e.form === 'exact' && e.value !== null);
    const awaiting = !intoFramelessGoal || !drawable ? undefined
      : target === null || [target.value, target.low, target.high].every((v) => v === null) ? 'link_goal_target_unknown' as const
        : goalHeld === 'goal_level_unknown' ? 'link_goal_level_unknown' as const : undefined;
    if (ratio === undefined && (e.form === 'point' || e.form === 'normal' || e.form === 'exact' || centred)) hold(l.id, awaiting ?? 'link_frame_unknown');
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
          // Olumi's own centred link is never called "stated" (Codex on #3590): its figure and range are Olumi's estimate.
          ? (figureBy(e, l).source === 'olumi'
            ? `The calculation uses Olumi's estimated ${Math.abs(e.value!)} with Olumi's illustrative spread (half the estimated effect). Olumi's range, ${e.low} to ${e.high}, is kept with the model but is not used as a spread.`
            : `The calculation uses the stated ${Math.abs(e.value!)} with Olumi's illustrative spread (half the stated effect). The stated range, ${e.low} to ${e.high}, is kept with the model but is not used as a spread.`)
          : statedSd !== null
            ? `The calculation uses ${sdBy(figureBy(e, l).source)} standard deviation, ${statedSd}. Nobody stated the shape of the spread, so Olumi assumes a bell shape (Normal) around ${Math.abs(e.value!)}.`
            : 'Nobody stated how uncertain this strength is. Applied Olumi\'s illustrative spread (half the stated effect). It is not a measurement of anyone\'s confidence.' }] : []),
      // A stated effect asserts that the link exists: existence 1 is the stater's claim, never an Olumi default (Science,
      // 21 Oct). Olumi's own link, or one the person hedged (an assumption on it), keeps the default and says so.
      ...(stated(l.source) && !hedged.has(l.id) ? [] : [{ code: REPAIR_CODES.DEFAULT_EXISTS_PROBABILITY, layer: 'cee' as const,
        field_path: `${path}.exists_probability`, before: null, after: exists, severity: 'info' as const,
        reason: stated(l.source) ? 'The link was stated under an assumption. The calculation assumes it exists, as stated.'
          : 'Nobody stated how likely this link is to exist. Applied Olumi\'s untested default.' }]),
    ];
    // Whose SIZE this is (per figure): the person's link with Olumi's estimated size is an Olumi estimate; its existence
    // above stays the link's own claim.
    const sizedBy = figureBy(e, l);
    const who = stated(sizedBy.source) ? { source: edited(sizedBy) ? 'user_specified' : 'brief_extraction', magnitude: 'user_stated' }
      : sizedBy.source === 'olumi' ? { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } : {};
    // The size in the person's own units, as every existing reader of a sized link reads it (`natural_effect`: the target's
    // testability, the chance licence, the canvas): the change in `to` per +1 of `from`, and the β it was written for.
    // An option's own switch (`<option>__on`) has no unit; its change is said per 'switch', as legacy link-effect.ts says it.
    // An empty unit breaks the run-input contract, so the snapshot left the size out and no edit could be named (Compare C1).
    const natural_effect = { amount: sign * Math.abs(e.value!), amount_unit: to!.unit ?? '', per_source_change: 1,
      per_source_change_unit: from!.unit ?? (switches.has(l.from) ? 'switch' : ''), strength_mean: sized.mean, strength_mean_frame: 'edge_strength' as const };
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
      ...declared.flatMap(({ item }) => item.defined_as!.of.map((part) => ({ id: `${part}__${item.id}`, from: part, to: item.id }))),
      ...model.risks.flatMap((r) => r.mitigations.map((m) => ({ id: `${m.factor_id}__${r.id}`, from: m.factor_id, to: r.id })))];
    const onPath = new Set([goal.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const l of allLinks) if (onPath.has(l.to) && !onPath.has(l.from)) { onPath.add(l.from); grew = true; }
    }
    // An option moves the goal through what it sets, so it is on the path too (science check 5bbceeec, point 5).
    for (const o of model.options) if (o.settings.some((s) => onPath.has(s.factor_id))) onPath.add(o.id);
    // An outcome is drawn as one only where that moves no number (DL: a label never moves a number): on the path of a goal
    // whose level today is someone's (ISL anchors on it, so an outcome's missing base uncertainty cancels), with something
    // leading into it (ISL draws a root's level, never an outcome's). One an option sets is a lever, and one with a limit sent
    // is scored on its level (PLoT drops a time limit on an outcome), so each stays a factor; the living model keeps the label.
    const anchored = (goalNode.observed_state as Rec | undefined)?.source !== undefined;
    for (const f of model.factors) if (f.kind === 'outcome' && anchored && onPath.has(f.id) && edges.some((e) => e.to === f.id)
      && !setsFactor.has(f.id) && !goal_constraints.some((c) => c.node_id === f.id)) {
      const node = nodes.find((n) => n.id === f.id)!;
      node.kind = 'outcome';
      delete node.category;
    }
    const leftOut = withheld.some((w) => (w.reason === 'link_sign_unknown' || w.reason === 'link_endpoint_unknown' || w.reason === 'exact_not_drawable'
      || w.reason === 'identity_other_cause' || w.reason === 'identity_contradicted' || w.reason === 'risk_not_in_slice') && onPath.has(model.links.find((l) => l.id === w.id)?.to ?? ''))
      || withheld.some((w) => (IDENTITY_REFUSED.has(w.reason) || RISK_REFUSED.has(w.reason)) && onPath.has(w.id)) || [...droppedSettings].some((id) => onPath.has(id));
    // An unresolved PREREQUISITE on anything the chance rests on (the engine cannot hold one) withholds it, whoever raised it.
    // An applied ASSUMPTION carries a CONDITIONAL result, kept in the living model the AI reads and said with the result; a
    // CHALLENGE is said beside it. The AI declares the role; the source never decides it (AIE, 17:59 20 Oct).
    const pathLinks = new Set(allLinks.filter((l) => onPath.has(l.to)).map((l) => l.id));
    const conditioned = model.conditions.filter((c) => c.role === 'prerequisite' && c.applies_to.some((id) => onPath.has(id) || pathLinks.has(id)));
    for (const c of conditioned) hold(`condition:${c.text}`, 'condition_not_in_slice');
    if (leftOut || conditioned.length > 0) {
      for (const k of Object.keys(goalNode)) if (k.startsWith('goal_threshold') || k === 'goal_direction' || k === 'goal_deadline_as_stated' || k === 'goal_horizon') delete goalNode[k];
      hold(goal.id, 'chance_rests_on_withheld');
    }
  }

  const frames = new Map<string, Frame>(model.factors.flatMap((f) => (caps.has(f.id) ? [[f.id, { cap: caps.get(f.id)!, unit: f.unit }] as const] : [])));
  if (goal !== undefined) frames.set(goal.id, { cap: goal.cap, unit: goal.unit === '' ? null : goal.unit });
  return { graph: { nodes, edges, ...(goal_constraints.length > 0 ? { goal_constraints } : {}) }, withheld, frames, assumed };
}

/**
 * The links the mapper holds only because the goal has no scale yet (`link_goal_target_unknown`: no target figure;
 * `link_goal_level_unknown`: a change target with no level today), read from a stored graph's own living model, with
 * whose figure each carries and the input it awaits. The Run's withhold says this reason, never "not sized".
 */
export function linksAwaitingGoalInput(graph: unknown): Array<{ from: string; to: string; by: 'olumi' | 'stated' | 'given'; awaits: 'target' | 'level' }> {
  const living = LivingModel.safeParse(graph !== null && typeof graph === 'object' ? (graph as Rec).living_model : undefined);
  if (!living.success) return [];
  const mapped = mapLivingModel(living.data, savedGoal(graph));
  // The engine edge's own endpoints: an option's link leaves from its switch (`<option>__on`), as the Run reads it (Codex r1).
  const edgeOf = new Map(mapped.graph.edges.map((e) => [e.id, e] as const));
  return mapped.withheld.flatMap((w) => {
    if (w.reason !== 'link_goal_target_unknown' && w.reason !== 'link_goal_level_unknown') return [];
    const l = living.data.links.find((x) => x.id === w.id);
    const e = edgeOf.get(w.id);
    if (l === undefined || e === undefined || typeof e.from !== 'string' || typeof e.to !== 'string') return [];
    const source = figureBy(l.effect, l).source;
    return [{ from: e.from, to: e.to, by: source === 'olumi' ? 'olumi' as const : stated(source) ? 'stated' as const : 'given' as const,
      awaits: w.reason === 'link_goal_target_unknown' ? 'target' as const : 'level' as const }];
  });
}
