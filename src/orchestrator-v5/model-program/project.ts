/**
 * THE DISPLAY PROJECTION (spike S1): CanonicalModel → the GraphV3 node/edge shape the canvas reads, plus a manifest.
 *
 * The display shows EVERY record; the calculation is the compiled subset (PL correction 1: hiding meaningful uncalculated
 * content repeats today's error). Each record appears exactly once in `items`, saying where it is drawn, whether it is IN
 * the calculation (and why not), and who authored it:
 *  · quantities are cards (an input is a factor, a derived quantity an outcome), except a quantity whose only use is a
 *    coefficient (drawn on its link), a target, bound or window length (on its goal or limit card), an option's value (on
 *    its option card), or a risk's chance or severity (on its risk card);
 *  · relations and effect terms are links; goals, options and risks are their own cards; limits are `goal_constraints`;
 *  · qualitative records (claims, evidence, assumptions, dissent, conditions, left out) are display-only text cards
 *    (`action`, the canvas's text card), always `retained_excluded`. Their `concerns` stay in the manifest, never as links:
 *    a GraphV3 link is a causal claim, and a note is not one.
 *
 * Authorship is shown as stated: the person's (with their words), Olumi's (provisional), or UNVERIFIED (said to be the
 * person's but their words were not found), which is never shown as theirs. Each figure carries it in the canvas's own
 * fields: a value's `observed_state.source` (the brief's, the person's later figure, or Olumi's estimate), a goal's
 * `threshold_source`. Every figure an editor can change is on the field that editor reads, under its quantity's id
 * (a coefficient's id rides its link as `coefficient_id`), so an edit maps back to that ONE quantity.
 * The projection is derived, never read back: the canonical model is the one saved meaning.
 */
import { LLM_STRENGTH_STD_FLOOR } from '../../cee/constants.js';
import { resolveGoalThresholdCapWithProvenance } from '../../utils/goal-threshold-cap.js';
import type { CanonicalModelT, CanonicalQuantityT, QualitativeFamilyT } from './canonical.js';
import { QUALITATIVE_FAMILIES } from './canonical.js';
import { compile, isApproximate, normalise, rangeDistOf, readRange, type CompileResult, type LawReading } from './compile.js';
import { parseUnit, sameDims } from './units.js';
import { directionUsed, rateOf as rateOfLink } from './links.js';
import { exactInitialValues } from './simulate/simulate.js';

type Rec = Record<string, unknown>;
/** structure: an exact constant the model's form needs; never drawn as anyone's estimate. */
export type DisplayAuthor = 'person' | 'olumi' | 'unverified' | 'structure';
export type ItemFamily = 'quantity' | 'relation' | 'term' | 'goal' | 'limit' | 'preference' | 'option' | 'risk' | QualitativeFamilyT;
export type ProjectedItem = {
  record_id: string;
  family: ItemFamily;
  /** Where it is drawn: its own card or link, or on another card or link. */
  shown_as: { node?: string; edge?: string; on_node?: string; on_edge?: string; constraint?: string };
  in_calculation: boolean;
  why_out: string | null;
  author: DisplayAuthor;
  approval: 'proposed' | 'approved';
  concerns?: string[];
  /** For a range: the ruled law Olumi reads it by, always Olumi's and provisional, never the person's calibration. */
  law?: { author: 'olumi'; provisional: true; range_kind: 'bounds' | 'plausible' | null; reading: LawReading };
};
export type Projection = {
  graph: { nodes: Rec[]; edges: Rec[]; goal_constraints: Rec[] };
  items: ProjectedItem[];
};

export const DECISION_NODE_ID = 'mp:decision';
export const WAITING_WORDS = 'Waiting for your answer';
const STRUCTURE_WORDS = 'Fixed by how the model is built';
/** A figure no one can give yet: it is left out of the analysis, never waiting for an answer. */
const OUT_OF_ANALYSIS = new Set(['unknown', 'unsupported', 'not_applicable']);
const QUAL_PREFIX: Record<QualitativeFamilyT, string> = {
  claims: 'Claim', evidence: 'Evidence', assumptions: 'Assumption', dissent: 'Disagreement', conditions: 'Condition', left_out: 'Left out',
};
const has = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-GB') : String(Number(n.toPrecision(4))));

/** Olumi's figure in the canvas's value vocabulary (the canvas reads it as Olumi's estimate). */
const OLUMIS_FIGURE = { source: 'cee_inference', extractionType: 'inferred' } as const;

/** `brief`: the person's first words. A figure of theirs quoted from it is the brief's; one given later (an answer, a card
 * edit) is theirs as entered. Absent: every quoted figure of theirs is read as the brief's. */
export function project(input: CanonicalModelT, compiled: CompileResult = compile(input), opts: { readonly brief?: string } = {}): Projection {
  const model = normalise(input); // an option's inline value is a named quantity, drawn on its option card
  const x = compiled.executable;
  const initial = x === null ? new Map<string, number>() : exactInitialValues(x);
  const xq = new Set(x?.quantities.map((q) => q.id) ?? []);
  const xg = new Set(x?.goals.map((g) => g.id) ?? []);
  const xl = new Set(x?.limits.map((l) => l.id) ?? []);
  const xo = new Set(x?.options.map((o) => o.id) ?? []);
  const xr = new Set(x?.risks.map((r) => r.id) ?? []);
  const unverified = new Set(compiled.unverified.map((u) => u.id));
  const notCompiling = compiled.errors.length > 0;
  const whoOf = (rec: { author: string }, id: string): DisplayAuthor => (rec.author === 'olumi' ? 'olumi' : rec.author === 'structure' ? 'structure' : unverified.has(id) ? 'unverified' : 'person');
  /** The canvas's origin vocabulary; a structural constant has none (it is nobody's figure, never "AI inferred"). */
  const provenanceOf = (who: DisplayAuthor) => (who === 'structure' ? {} : { provenance: who === 'person' ? 'from_brief' : who === 'unverified' ? 'unverified_brief' : 'ai_inferred' });
  const quoteOf = (rec: { author: string; quote: string | null }, id: string) => (whoOf(rec, id) === 'person' && has(rec.quote) ? { source_quote: rec.quote } : {});
  /** In the analysis (`included`): what the calculation uses now, or will once its questions are answered; only what is
   *  genuinely left out (a note, a preference, an aim with no measure, a figure that is unknown or unsupported, a model that
   *  does not compile) is `retained_excluded` (Lenses fit 2, DL 23 Oct). */
  const participation = (inAnalysis: boolean) => ({ analysis_participation: inAnalysis ? 'included' : 'retained_excluded' });
  const inModel = new Set(compiled.in_model);
  /** A goal, limit or option the compiler keeps (calculable, or waiting on answers), never one it withholds. */
  const kept = (outcome: { status: string } | undefined) => !notCompiling && outcome !== undefined && outcome.status !== 'withheld' && outcome.status !== 'not_compared';
  const Q = new Map(model.quantities.map((q) => [q.id, q] as const));
  const why = (inCalc: boolean, reason: string) => (inCalc ? null : notCompiling ? 'The model does not compile yet.' : reason);
  const plain = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const fromBrief = (quote: string | null) => opts.brief === undefined || (has(quote) && plain(opts.brief).includes(plain(quote)));
  /** Whose figure it is, in the canvas's value vocabulary: none claimed for a structural constant or unverified words. */
  const figureSource = (q: CanonicalQuantityT): Rec => {
    const who = whoOf(q, q.id);
    if (who === 'olumi') return OLUMIS_FIGURE;
    if (who !== 'person') return {};
    return fromBrief(q.quote) ? { source: 'brief_extraction', extractionType: 'explicit' } : { source: 'user_override' };
  };
  /** Edge ids: `from__to`, and a second link between the same two cards (a part used twice) gets its own. */
  const edgeIds = new Map<string, number>();
  const edgeId = (from: string, to: string) => {
    const base = `${from}__${to}`;
    const n = (edgeIds.get(base) ?? 0) + 1;
    edgeIds.set(base, n);
    return n === 1 ? base : `${base}__${n}`;
  };
  /** Each relation's links, in drawing order, with their ids: computed once, so a coefficient's host is its own link. */
  const relationEdgeIds = new Map<string, string[]>();
  /** Links whose size no one has given (not worked out by a relation) and whose direction is not stated: no one can give their
   *  sign, so they are not drawn (issue 39). */
  const undrawn = new Set<string>();
  const unsigned = (id: string) => { const c = Q.get(id); return c !== undefined && c.status !== 'derived' && !has(c.value) && !(has(c.low) && has(c.high)) && c.direction === null; };

  const nodes: Rec[] = [];
  const edges: Rec[] = [];
  const goal_constraints: Rec[] = [];
  const items: ProjectedItem[] = [];

  // ── how each quantity is used, to decide where it is drawn ─────────────────────────────────────────────────────────
  const uses = new Map<string, Set<string>>();
  const use = (id: string, how: string) => { if (Q.has(id)) uses.set(id, new Set([...(uses.get(id) ?? []), how])); };
  const hostOf = new Map<string, { node?: string; edge?: string }>();
  /** A window's length or origin timing is consumed into its window, so it is in the calculation exactly when its owner is. */
  const windowOwner = new Map<string, string>();
  /** A per-unit rate is drawn ONE way, on its driver's link (`links.ts`). */
  const rateOf = (r: CanonicalModelT['relations'][number]) => rateOfLink(r, Q);
  for (const r of model.relations) {
    const rate = rateOf(r);
    const froms = rate ? [rate.driver] : r.form === 'definition' ? r.parts.map((p) => p.id) : r.form === 'effect' ? [r.base, ...r.terms.map((t) => t.driver)] : [r.start, ...r.inflows, ...r.outflows];
    const ids = froms.map((f) => edgeId(f, r.defines));
    relationEdgeIds.set(r.id, ids);
    froms.forEach((f) => use(f, 'node'));
    if (r.form === 'effect') r.terms.forEach((t, i) => { use(t.coefficient, 'coefficient'); hostOf.set(t.coefficient, { edge: ids[i + 1]! }); if (unsigned(t.coefficient)) undrawn.add(ids[i + 1]!); });
    if (rate) { use(rate.coefficient, 'coefficient'); hostOf.set(rate.coefficient, { edge: ids[0]! }); if (unsigned(rate.coefficient)) undrawn.add(ids[0]!); }
    use(r.defines, 'node');
  }
  for (const g of model.goals) if (g.measure) {
    use(g.measure.quantity, 'node');
    if (has(g.measure.per)) use(g.measure.per, 'node');
    for (const t of [g.measure.target, g.measure.window?.periods, g.measure.window?.origin_offset]) if (has(t)) { use(t, 'on_goal'); hostOf.set(t, { node: g.id }); }
    for (const t of [g.measure.window?.periods, g.measure.window?.origin_offset]) if (has(t)) windowOwner.set(t, g.id);
  }
  for (const l of model.limits) if (l.measure) {
    const lm = l.measure;
    use(lm.quantity, 'node');
    if (has(lm.per)) use(lm.per, 'node');
    for (const t of [lm.bound, lm.window?.periods, lm.window?.origin_offset]) if (has(t)) { use(t, 'on_limit'); hostOf.set(t, { node: lm.quantity }); }
    for (const t of [lm.window?.periods, lm.window?.origin_offset]) if (has(t)) windowOwner.set(t, l.id);
  }
  for (const o of model.options) for (const s of o.sets) { use(s.quantity, 'node'); if (has(s.to)) { use(s.to, 'on_option'); hostOf.set(s.to, { node: o.id }); } }
  for (const k of model.risks) { use(k.effect_on, 'node'); for (const t of [k.occurrence, k.severity]) { use(t, 'on_risk'); hostOf.set(t, { node: k.id }); } }
  const folded = (id: string) => { const u = uses.get(id); return u !== undefined && u.size === 1 && !u.has('node') && hostOf.has(id); };

  const chances = new Set(model.risks.map((k) => k.occurrence));
  /** The shared law's reading: the compiler's disclosure (with the domain) when the quantity is in the run, else the same law. */
  const lawFor = (q: CanonicalQuantityT): LawReading => {
    const c = compiled.conversions.find((x) => x.kind === 'range_law' && x.quantity === q.id);
    if (c && c.kind === 'range_law') {
      // The compiler reads a % range as a fraction (20–40 % is 0.2–0.4); the card says it in the unit it labels (Codex r1 #3709).
      const u = parseUnit(q.unit), k = u.ok ? u.unit.scale : 1, r = c.reading;
      return k === 1 ? r : { ...r, centre: r.centre / k, sd: r.sd / k, lower: r.lower / k, upper: r.upper / k, mean: r.mean / k, sd_conditioned: r.sd_conditioned / k };
    }
    const inside = !has(q.value) || (q.low! < q.value && q.value < q.high!);
    return inside ? readRange(rangeDistOf(q, 1, chances.has(q.id) ? { min: 0, max: 1 } : undefined)) : { kind: 'held', reason: 'its most likely figure is not inside its range' };
  };
  const lawOf = (q: CanonicalQuantityT) => (has(q.low) && has(q.high) && q.low < q.high && (q.status === 'known' || q.status === 'estimated')
    ? { law: { author: 'olumi' as const, provisional: true as const, range_kind: q.range_kind, reading: lawFor(q) } } : {});
  const display = (q: CanonicalQuantityT): string => {
    const unit = q.unit === '1' ? '' : ` ${q.unit}`;
    const owner = q.author === 'olumi' ? (q.status === 'estimated' ? ', Olumi\'s estimate' : ', Olumi\'s reading') : isApproximate(q) ? `, for now — you said “${q.quote}”` : '';
    if (q.status === 'asked') return WAITING_WORDS;
    if (q.status === 'derived') return workedOutWords(q.id);
    if (q.status === 'unknown' || q.status === 'unsupported' || q.status === 'not_applicable') return q.status.replace('_', ' ');
    if (has(q.low) && has(q.high) && q.low !== q.high) {
      // A range is not a law: the person's (or Olumi's) bounds, then Olumi's provisional reading of them, said as Olumi's.
      const r = lawFor(q);
      // The disclosure says the CONDITIONED moments (what the draws have) and where the spread is kept, as Olumi's.
      const kept = (lo: number, hi: number) => (Number.isFinite(lo) && Number.isFinite(hi) ? `, kept between ${fmt(lo)} and ${fmt(hi)}`
        : Number.isFinite(lo) ? `, never below ${fmt(lo)}` : Number.isFinite(hi) ? `, never above ${fmt(hi)}` : '');
      const law = q.author === 'person' && !has(q.range_kind) ? 'how to read it is asked'
        : r.kind === 'normal' ? `Olumi reads it as a spread around ${fmt(r.mean)} (sd ${fmt(r.sd_conditioned)})${kept(r.lower, r.upper)}, provisionally`
          : 'Olumi cannot use it as a spread yet';
      return `${has(q.value) ? `about ${fmt(q.value)}, ` : ''}${fmt(q.low)}–${fmt(q.high)}${unit}${owner}; ${law}`;
    }
    return `${fmt(q.value ?? q.low!)}${unit}${owner}`;
  };

  /**
   * A goal's target as today's core goal carries it: raw in its frame, its scale (the shared cap rule, for a level or an
   * absolute change) and whose figure it is. A relative change is a FRACTION of today's level by contract (10 % → 0.1,
   * said "up 10% from today"), never on a cap scale, and its unit is the measured quantity's (Lenses fit 2, DL 23 Oct).
   */
  const goalTarget = (stated: number, target: CanonicalQuantityT, frame: string): Rec => {
    const unit = parseUnit(target.unit);
    const relative = frame === 'change_rel';
    const raw = relative && unit.ok ? stated * unit.unit.scale : stated;
    const cap = relative ? null : resolveGoalThresholdCapWithProvenance(undefined, raw, target.unit, undefined);
    const src = figureSource(target)['source'];
    return { goal_threshold_raw: raw,
      ...(cap !== null ? { goal_threshold: raw / cap.cap, goal_threshold_cap: cap.cap, goal_threshold_cap_provenance: cap.provenance } : {}),
      ...(src === 'brief_extraction' ? { threshold_source: 'brief_extraction' } : src === 'user_override' ? { threshold_source: 'user', success_threshold: raw }
        : src === 'cee_inference' ? { threshold_source: 'cee_inference' } : {}) };
  };

  /** What a derived figure is worked out from, by name: its relation's parts, base and drivers, or a stock's start and flows. */
  const partsOf = new Map(model.relations.map((r) => [r.defines, r.form === 'definition' ? r.parts.map((p) => p.id) : r.form === 'effect' ? [r.base, ...r.terms.map((t) => t.driver)] : [r.start, ...r.inflows, ...r.outflows]] as const));
  const workedOutWords = (id: string) => {
    const names = (partsOf.get(id) ?? []).map((p) => Q.get(p)?.label ?? p);
    return names.length === 0 ? 'Worked out from its inputs' : `Worked out from ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`}`;
  };
  /**
   * Whose a figure is when no person or Olumi gave it (Lenses fit 2, DL 23 Oct): worked out from its parts, fixed by how the
   * model is built, or waiting for the person's answer. Said on the card as `value_basis`, never as anyone's estimate.
   */
  const basisOf = (q: CanonicalQuantityT): Rec => (q.status === 'derived' ? { value_basis: { kind: 'worked_out', from: partsOf.get(q.id) ?? [], words: workedOutWords(q.id) } }
    : q.status === 'asked' ? { value_basis: { kind: 'waiting_for_answer', words: WAITING_WORDS, ...(has(q.question) ? { question: q.question } : {}) } }
      : q.author === 'structure' ? { value_basis: { kind: 'structure', words: STRUCTURE_WORDS } } : {});
  /** The engine's exact initial figure, converted back to the card's unit. No source stamp: it was worked out. */
  const derivedObservation = (q: CanonicalQuantityT, unit = q.unit): Rec => {
    const value = initial.get(q.id), own = parseUnit(q.unit), shown = parseUnit(unit);
    if (value === undefined || !own.ok || !shown.ok || !sameDims(own.unit, shown.unit)) return {};
    const raw = value / shown.unit.scale;
    return Number.isFinite(raw) ? { observed_state: { value: raw, raw_value: raw, unit } } : {};
  };
  /**
   * The existing horizon reader says “within N months”, as the person's own: only a fixed window from now that they stated,
   * on a goal reached by then (max), can mean that (integrated review 26 Oct: a "never below" or average goal was read as a
   * deadline, and Olumi's reading of a date was shown as theirs). A level at the window's end (end) is a different event, met
   * only if it holds at month N (buddy BLOCK 26 Oct). Every other timing stays in the result's own words.
   */
  const horizonOf = (g: CanonicalModelT['goals'][number]): Rec => {
    const w = g.measure?.window;
    if (!w || w.origin_event !== null || w.origin_offset !== null || w.start !== 0 || g.measure!.aggregation !== 'max') return {};
    const q = Q.get(w.periods);
    if (!q || q.status !== 'known' || whoOf(q, q.id) !== 'person' || (has(q.low) && has(q.high) && q.low !== q.high)) return {};
    const value = q.value ?? q.low, u = parseUnit(q.unit);
    if (!has(value) || !Number.isInteger(value) || value <= 0 || !u.ok || u.unit.scale !== 1) return {};
    const dims = Object.entries(u.unit.dims);
    if (dims.length !== 1 || dims[0]![1] !== 1) return {};
    // Years and months have an exact conversion. Weeks do not have an exact number of months.
    const months = dims[0]![0] === 'month' ? value : dims[0]![0] === 'year' ? value * 12 : null;
    return months === null || !Number.isInteger(months) ? {} : { goal_horizon: { months }, goal_horizon_months: months };
  };
  /**
   * An option's setting in the canvas's intervention vocabulary: the figure's own author, or, for a structural switch (0 or
   * 1, none or one), the option's, since setting it IS what the option says ("set by ‘Add one specialist’, from your brief").
   */
  const settingSource = (to: CanonicalQuantityT, o: CanonicalModelT['options'][number]): Rec => {
    const own = to.author !== 'structure';
    const who = own ? whoOf(to, to.id) : whoOf(o, o.id);
    const words = `Set by ‘${o.label}’`;
    if (who === 'olumi') return { source: 'cee_hypothesis', source_words: `${words}, Olumi’s figure` };
    if (who !== 'person') return {};
    return fromBrief(own ? to.quote : o.quote) ? { source: 'brief_extraction', source_words: `${words}, from your brief` } : { source: 'user_specified', source_words: `${words}, as you gave it` };
  };

  // ── the question, goals, options ───────────────────────────────────────────────────────────────────────────────────
  nodes.push({ id: DECISION_NODE_ID, kind: 'decision', label: model.question });
  for (const g of model.goals) {
    const per = compiled.perGoal.find((p) => p.goal_id === g.id);
    const inCalc = xg.has(g.id);
    const who = whoOf(g, g.id);
    const target = g.measure ? Q.get(g.measure.target) : undefined;
    const point = target && has(target.value) && !has(target.low) ? target.value : null;
    const metric = g.measure ? Q.get(g.measure.quantity) : undefined;
    const metricUnit = metric?.unit;
    const goalUnit = g.measure?.frame === 'change_rel' ? metricUnit : target?.unit;
    nodes.push({
      id: g.id, kind: 'goal', label: g.label, ...provenanceOf(who), ...quoteOf(g, g.id), ...participation(inCalc || (has(g.measure) && kept(per))),
      ...(g.measure ? { goal_direction: g.measure.cmp, goal_threshold_frame: g.measure.frame, ...(g.measure.frame === 'level' ? {} : { quantity_frame: 'level' }),
        ...(target ? { goal_threshold_unit: g.measure.frame === 'change_rel' ? (metricUnit ?? '1') : target.unit, display_value: `${g.measure.cmp} ${display(target)}` } : {}),
        ...(point !== null && target ? goalTarget(point, target, g.measure.frame) : {}) } : {}),
      ...(has(g.question) ? { user_questions: [g.question] } : {}),
      ...horizonOf(g),
      // A total over a window or a per-quantity ratio is not the measured quantity's level today, and a change from a stated
      // value or from an option is not a change from today (integrated review 26 Oct: "Today: X" beside "up N% from today").
      ...(metric?.status === 'derived' && g.measure?.per === null && g.measure.aggregation !== 'sum' && goalUnit
        && (g.measure.frame === 'level' || g.measure.reference?.kind === 'now')
        ? { ...derivedObservation(metric, goalUnit), ...basisOf(metric) } : {}),
    });
    items.push({ record_id: g.id, family: 'goal', shown_as: { node: g.id }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: g.approval });
    if (g.measure && Q.has(g.measure.quantity)) {
      edges.push({ ...link(g.measure.quantity, g.id, 1, who, inCalc, { definitional: true }), id: edgeId(g.measure.quantity, g.id) });
    }
  }
  for (const o of model.options) {
    const inCalc = xo.has(o.id);
    const who = whoOf(o, o.id);
    const per = compiled.perOption.find((p) => p.option_id === o.id);
    const interventions: Rec = {};
    for (const s of o.sets) {
      const to = has(s.to) ? Q.get(s.to) : undefined;
      if (to) interventions[s.quantity] = { value: to.value, unit: to.unit, display: display(to), from_period: s.starts_after_periods, ...settingSource(to, o) };
    }
    nodes.push({
      id: o.id, kind: 'option', label: o.label, ...provenanceOf(who), ...quoteOf(o, o.id), ...participation(inCalc || (o.status === 'live' && kept(per))),
      ...(o.sets.length === 0 ? { is_baseline: true } : {}), ...(Object.keys(interventions).length ? { interventions } : {}),
      ...(o.author === 'olumi' ? { proposed_by: 'olumi' } : {}),
    });
    items.push({ record_id: o.id, family: 'option', shown_as: { node: o.id }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: o.approval });
    edges.push({ ...link(DECISION_NODE_ID, o.id, 1, who, inCalc, {}), id: edgeId(DECISION_NODE_ID, o.id) });
    for (const s of o.sets) if (Q.has(s.quantity)) edges.push({ ...link(o.id, s.quantity, 1, who, inCalc, {}), id: edgeId(o.id, s.quantity) });
  }

  /**
   * A figure on the field the card's value line and editor read, with whose it is: a point as given; a range at its centre
   * (the figure given, else the centre Olumi reads it around) with both ends as `range`. An asked or unknown quantity has
   * no figure, so only its unit is drawn; a derived one carries only an exact initial figure the engine can support.
   */
  const observedOf = (q: CanonicalQuantityT): Rec => {
    // Every card's figure is in its quantity's own unit (DL 23 Oct: the in-card editor reads it here, never the 0–1 model
    // scale), a question's or an unknown's too. A derived figure keeps its worked-out basis, never anyone's source stamp.
    if (q.status !== 'known' && q.status !== 'estimated') return q.status === 'derived' ? derivedObservation(q) : { observed_state: { unit: q.unit } };
    const ranged = has(q.low) && has(q.high) && q.low !== q.high;
    const r = ranged ? lawFor(q) : undefined;
    const centre = has(q.value) ? q.value : r?.kind === 'normal' ? r.mean : ranged ? (q.low! + q.high!) / 2 : null;
    if (centre === null) return { observed_state: { unit: q.unit } };
    // A figure given keeps whose it is; a centre read from a bare range is Olumi's, the range and its words staying theirs
    // (DL 24 Oct, board 3de98183: "$40,000 to $50,000" showed 45,000 as their figure).
    return { observed_state: { value: centre, raw_value: centre, unit: q.unit, ...(has(q.value) ? figureSource(q) : OLUMIS_FIGURE),
      ...(ranged ? { range: { low: q.low, high: q.high } } : {}) } };
  };

  // ── quantities ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const controlled = new Set(model.options.flatMap((o) => o.sets.map((s) => s.quantity)));
  for (const q of model.quantities) {
    const owner = windowOwner.get(q.id);
    const inCalc = xq.has(q.id) || (owner !== undefined && (xg.has(owner) || xl.has(owner)));
    const who = whoOf(q, q.id);
    const reason = q.status === 'asked' ? `Asked: ${q.question}` : q.status === 'derived' || q.status === 'known' || q.status === 'estimated'
      ? 'Nothing that can be worked out yet uses it.' : `${q.status.replace('_', ' ')}: ${q.basis}`;
    if (folded(q.id)) {
      const host = hostOf.get(q.id)!;
      items.push({ record_id: q.id, family: 'quantity', shown_as: host.edge ? (undrawn.has(host.edge) ? {} : { on_edge: host.edge }) : { on_node: host.node }, in_calculation: inCalc, why_out: why(inCalc, reason), author: who, approval: q.approval, ...lawOf(q) });
      continue;
    }
    nodes.push({
      id: q.id, kind: q.status === 'derived' ? 'outcome' : 'factor', label: q.label, ...provenanceOf(who), ...quoteOf(q, q.id),
      ...participation(inCalc || (!notCompiling && inModel.has(q.id) && !OUT_OF_ANALYSIS.has(q.status))),
      ...(q.status !== 'derived' ? { category: controlled.has(q.id) ? 'controllable' : 'observable' } : {}),
      ...observedOf(q),
      display_value: display(q),
      ...basisOf(q),
      ...(has(q.basis) ? { description: q.basis } : {}),
      ...(q.status === 'asked' && has(q.question) ? { user_questions: [q.question] } : {}),
    });
    items.push({ record_id: q.id, family: 'quantity', shown_as: { node: q.id }, in_calculation: inCalc, why_out: why(inCalc, reason), author: who, approval: q.approval, ...lawOf(q) });
  }

  /** A rate's link, driver → what it moves: its size in natural units, its sign from that size, whose size it is. */
  const rateLink = (driver: string, coefficient: string, defines: string, who: DisplayAuthor, inCalc: boolean): Rec => {
    const c = Q.get(coefficient);
    const mid = c ? (c.value ?? (has(c.low) && has(c.high) ? (c.low + c.high) / 2 : null)) : null;
    const straddles = c && has(c.low) && has(c.high) && c.low < 0 && c.high > 0;
    // A size with no figure (no value; no range, or one across zero) has no sign of its own: the link takes its stated
    // direction (issue 39). A given value always keeps its own sign (Codex r1 #3734).
    const stated = c && directionUsed(c) ? c.direction : null;
    const sign = stated === 'lowers' ? -1 : stated === 'raises' ? 1 : mid !== null && mid < 0 ? -1 : 1;
    const driverUnit = Q.get(driver)?.unit ?? '';
    const definedUnit = Q.get(defines)?.unit ?? '';
    // The link's figure is what the compiler uses, per ONE of the driver's unit, in the defined quantity's unit: the
    // coefficient's own unit scale applied (a 40 % rate moves 0.4 loaf/week per loaf/week; Codex r4 #3709), as lawFor does.
    const scaleOf = (unit: string) => { const u = parseUnit(unit); return u.ok ? u.unit.scale : 1; };
    const k = c ? scaleOf(c.unit) * scaleOf(driverUnit) / scaleOf(definedUnit) : 1;
    const natural = c && has(c.value)
      ? { natural_effect: { amount: c.value * k, amount_unit: definedUnit, per_source_change: 1, per_source_change_unit: driverUnit, strength_mean: sign, strength_mean_frame: 'edge_strength',
        ...(has(c.low) && has(c.high) && c.low !== c.high ? { stated_range: { low: c.low * k, high: c.high * k, text: `${fmt(c.low)}–${fmt(c.high)}`, end: 'centre' } } : {}) } }
      : {};
    const reasoning = c ? `${display(c)} per ${driverUnit || 'unit'}${straddles ? '; its direction is not settled' : ''}${mid === null ? '; its size is not given yet' : ''}` : '';
    return link(driver, defines, sign, who, inCalc, { ...natural, reasoning, ...(c ? { magnitude: c.author === 'olumi' ? 'olumi_estimate' : 'user_stated' } : {}) });
  };

  // ── relations and effect terms: links ──────────────────────────────────────────────────────────────────────────────
  for (const r of model.relations) {
    const inCalc = xq.has(r.defines);
    const who = whoOf(r, r.id);
    const reason = 'What it works out is not used by anything that can be worked out yet.';
    const drawn: string[] = [];
    const ids = [...relationEdgeIds.get(r.id)!];
    const push = (e: Rec) => { const id = ids.shift()!; if (undrawn.has(id)) return id; edges.push({ ...e, id }); drawn.push(id); return id; };
    const rate = rateOf(r);
    if (rate) {
      push({ ...rateLink(rate.driver, rate.coefficient, r.defines, who, inCalc), coefficient_id: rate.coefficient });
    } else if (r.form === 'definition') {
      for (const p of r.parts) {
        const sign = 'sign' in p ? p.sign : p.power;
        const words = r.op === 'sum' ? (sign > 0 ? 'added' : 'subtracted') : sign === 1 ? 'multiplied' : sign === -1 ? 'divided by' : `raised to the power ${sign}`;
        push(link(p.id, r.defines, sign < 0 ? -1 : 1, who, inCalc, { definitional: true, reasoning: words }));
      }
    } else if (r.form === 'stock') {
      push(link(r.start, r.defines, 1, who, inCalc, { definitional: true, reasoning: 'starting level' }));
      for (const f of r.inflows) push(link(f, r.defines, 1, who, inCalc, { definitional: true, reasoning: `inflow per ${model.period}` }));
      for (const f of r.outflows) push(link(f, r.defines, -1, who, inCalc, { definitional: true, reasoning: `outflow per ${model.period}` }));
    } else {
      push(link(r.base, r.defines, 1, who, inCalc, { definitional: true, reasoning: 'base level' }));
      for (const t of r.terms) {
        const termWho = whoOf(t, `${r.id}:${t.driver}`);
        const id = push({ ...rateLink(t.driver, t.coefficient, r.defines, termWho, inCalc), coefficient_id: t.coefficient });
        items.push({ record_id: `${r.id}:${t.driver}`, family: 'term', shown_as: undrawn.has(id) ? {} : { edge: id }, in_calculation: inCalc, why_out: why(inCalc, reason), author: termWho, approval: t.approval });
      }
    }
    items.push({ record_id: r.id, family: 'relation', shown_as: { edge: drawn.join(' ') }, in_calculation: inCalc, why_out: why(inCalc, reason), author: who, approval: r.approval });
  }

  // ── limits: the canvas's goal constraints ──────────────────────────────────────────────────────────────────────────
  for (const l of model.limits) {
    const inCalc = xl.has(l.id);
    const who = whoOf(l, l.id);
    const lm = l.measure;
    const bound = lm ? Q.get(lm.bound) : undefined;
    const per = compiled.perLimit.find((p) => p.limit_id === l.id);
    const point = bound && has(bound.value) && !(has(bound.low) && bound.low !== bound.high) ? bound.value : null;
    if (lm && point !== null && !has(lm.per)) {
      goal_constraints.push({
        constraint_id: l.id, node_id: lm.quantity, operator: lm.cmp.startsWith('>') ? '>=' : '<=', ...(lm.cmp === '<' || lm.cmp === '>' ? { operator_as_stated: lm.cmp } : {}),
        value: point, label: l.label, unit: bound!.unit, ...(who === 'person' && has(l.quote) ? { source_quote: l.quote.slice(0, 200) } : {}),
        provenance: who === 'olumi' ? 'inferred' : 'explicit',
      });
      items.push({ record_id: l.id, family: 'limit', shown_as: { constraint: l.id, on_node: lm.quantity }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: l.approval });
    } else {
      // A guardrail with no measure yet, or one whose figure is not given: a text card, never an invented scale.
      const id = `mp:limit:${l.id}`;
      nodes.push({ id, kind: 'action', label: `Limit: ${l.label}`, description: lm ? `${l.label} (its figure is not given yet).` : `${l.label} (no measure yet, so the result does not cover it).`, ...provenanceOf(who), ...quoteOf(l, l.id), ...participation(inCalc || (has(lm) && kept(per))) });
      items.push({ record_id: l.id, family: 'limit', shown_as: { node: id }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: l.approval });
    }
  }

  // ── preferences: wishes without a threshold, drawn as text cards ─────────────────────────────────────────────────────
  for (const p of model.preferences) {
    const who = whoOf(p, p.id);
    const q = Q.get(p.quantity);
    nodes.push({ id: p.id, kind: 'action', label: `Preference: ${p.direction} ${q?.label ?? p.quantity}`, description: `Would like ${q?.label ?? p.quantity} ${p.direction}. Shown beside the result; not a goal or a limit.`, ...provenanceOf(who), ...quoteOf(p, p.id), ...participation(false) });
    items.push({ record_id: p.id, family: 'preference', shown_as: { node: p.id }, in_calculation: false, why_out: 'A preference: shown and reported, never calculated as a goal or a limit.', author: who, approval: p.approval, concerns: [p.quantity] });
  }

  // ── risks ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  for (const k of model.risks) {
    const inCalc = xr.has(k.id);
    const who = whoOf(k, k.id);
    const occ = Q.get(k.occurrence);
    const sev = Q.get(k.severity);
    nodes.push({
      id: k.id, kind: 'risk', label: k.label, ...provenanceOf(who), ...quoteOf(k, k.id), ...participation(inCalc || (!notCompiling && inModel.has(k.effect_on))),
      description: `Chance: ${occ ? display(occ) : 'not given'}. If it happens: ${k.mode === 'add' ? 'adds' : 'multiplies by'} ${sev ? display(sev) : 'not given'}, ${typeof k.starts_after_periods === 'number' ? (k.starts_after_periods === 0 ? 'from the start' : `after ${k.starts_after_periods} ${model.period}s`) : `from "${Q.get(k.starts_after_periods)?.label ?? k.starts_after_periods}"`}.`,
    });
    items.push({ record_id: k.id, family: 'risk', shown_as: { node: k.id }, in_calculation: inCalc, why_out: why(inCalc, 'What it affects is not used by anything that can be worked out yet.'), author: who, approval: k.approval });
    if (Q.has(k.effect_on)) edges.push({ ...link(k.id, k.effect_on, k.mode === 'add' && sev && (sev.value ?? sev.high ?? 0) < 0 ? -1 : 1, who, inCalc, { reasoning: 'if it happens' }), id: edgeId(k.id, k.effect_on) });
  }

  // ── qualitative records: display-only text cards ───────────────────────────────────────────────────────────────────
  for (const f of QUALITATIVE_FAMILIES) for (const rec of model[f] as readonly (Rec & { id: string; author: string; quote: string | null; approval: 'proposed' | 'approved'; concerns: string[] })[]) {
    const who = whoOf(rec, rec.id);
    const text = f === 'dissent' ? `${String(rec.holder)}: ${String(rec.position)}` : String(rec.text);
    const extra = f === 'left_out' ? ` Why: ${String(rec.why)}` : f === 'evidence' && has(rec.source) ? ` Source: ${String(rec.source)}` : '';
    nodes.push({ id: rec.id, kind: 'action', label: `${QUAL_PREFIX[f]}: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`, description: `${text}${extra}`, ...provenanceOf(who), ...quoteOf(rec, rec.id), ...participation(false) });
    items.push({ record_id: rec.id, family: f, shown_as: { node: rec.id }, in_calculation: false, why_out: 'A note: shown beside the model, never calculated.', author: who, approval: rec.approval, concerns: [...rec.concerns] });
  }

  return { graph: { nodes, edges, goal_constraints }, items };
}

function link(from: string, to: string, sign: 1 | -1, who: DisplayAuthor, inCalc: boolean, extra: Rec): Rec {
  const { reasoning, magnitude, definitional, ...rest } = extra;
  const provenance = who === 'unverified' ? undefined : {
    source: who === 'person' ? 'brief_extraction' : 'cee_hypothesis',
    ...(has(reasoning) ? { reasoning } : {}), ...(has(magnitude) ? { magnitude } : {}), ...(definitional === true ? { definitional: true } : {}), ...rest,
  };
  return {
    from, to, strength: { mean: sign, std: LLM_STRENGTH_STD_FLOOR }, exists_probability: 1, effect_direction: sign > 0 ? 'positive' : 'negative',
    ...(provenance ? { provenance } : {}), origin: inCalc ? 'model_program:calculation' : who === 'unverified' ? 'model_program:unverified' : 'model_program:display',
  };
}
