/**
 * THE DISPLAY PROJECTION (spike S1): CanonicalModel → the GraphV3 node/edge shape the canvas reads, plus a manifest.
 *
 * The display shows EVERY record; the calculation is the compiled subset (PL correction 1: hiding meaningful uncalculated
 * content repeats today's error). Each record appears exactly once in `items`, saying where it is drawn, whether it is IN
 * the calculation (and why not), and who authored it:
 *  · quantities are cards (an input is a factor, a derived quantity an outcome, and a coefficient, a mechanism's size, a
 *    factor whether given or worked out: Paul's test 27 Oct drew three worked-out sizes as outcomes), except a quantity
 *    whose only use is a coefficient (drawn on its link), a target, bound or window length (on its goal or limit card), an
 *    option's value (on its option card), or a risk's chance or severity (on its risk card);
 *  · relations and effect terms are links; goals, options and risks are their own cards; a limit with one figure on a whole
 *    quantity is a `goal_constraint`, which the canvas draws as the goal card's limit, never also a card (both drew the
 *    £200,000 budget twice on reopen, 27 Oct); every other limit is its own card, linked from what it measures;
 *  · qualitative records (claims, evidence, assumptions, dissent, conditions, left out) and preferences are not cards: the
 *    canvas draws them by id from the living model (`living_model.canonical`), so their items have no `shown_as` place.
 *    Their `concerns` stay in the manifest, never as links: a GraphV3 link is a causal claim, and a note is not one.
 *
 * Authorship is shown as stated: the person's (with their words) or Olumi's (provisional), as the AI wrote it (the A25
 * 'unverified' label is off the path, S1 strip, Paul 26 Oct). Each figure carries it in the canvas's own
 * fields: a value's `observed_state.source` (the brief's, the person's later figure, or Olumi's estimate), a goal's
 * `threshold_source`. Every figure an editor can change is on the field that editor reads, under its quantity's id
 * (a coefficient's id rides its link as `coefficient_id`), so an edit maps back to that ONE quantity.
 * A link carries NO strength (W3b, 26 Oct): the model holds no β for any link, and a bare ±1 drew every link at the canvas's
 * strongest band ("Very strong"). A link's sign is its `effect_direction`, and only where the model gives one; a causal
 * link's size is its coefficient in natural units (`natural_effect`, `coefficient_id`); a definition's part and a goal's
 * or limit's measure hold by arithmetic, so they say no size at all. The question's link to an option and an option's link
 * to what it sets are not causal claims, and the model states no sign for them, so they carry none.
 * The projection is derived, never read back: the canonical model is the one saved meaning.
 */
import { EventRiskV1 } from '../../schemas/event-risk.js';
import { resolveGoalThresholdCapWithProvenance } from '../../utils/goal-threshold-cap.js';
import type { CanonicalLimitT, CanonicalModelT, CanonicalQuantityT, NumericRelationT, QualitativeFamilyT } from './canonical.js';
import { CMP_WORDS, QUALITATIVE_FAMILIES, isInfluence } from './canonical.js';
import { compile, isApproximate, normalise, rangeDistOf, readRange, type CompileResult, type LawReading } from './compile.js';
import { parseUnit as parseUnitText, sameDims, type UnitParse } from './units.js';
import { directionUsed, rateOf as rateOfLink } from './links.js';
import { exactInitialValues } from './simulate/simulate.js';

type Rec = Record<string, unknown>;
/** structure: an exact constant the model's form needs; never drawn as anyone's estimate. */
export type DisplayAuthor = 'person' | 'olumi' | 'structure';
export type ItemFamily = 'quantity' | 'relation' | 'term' | 'goal' | 'limit' | 'preference' | 'option' | 'risk' | QualitativeFamilyT;
export type ProjectedItem = {
  record_id: string;
  family: ItemFamily;
  /** Where it is drawn: its own card or link, or on another card or link; none for a note or a preference (drawn from the model). */
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
const has = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
/** A unit as the engine reads it; an unmeasured factor (unit null, Box 1a) has none, so no scale is read into it. */
const parseUnit = (unit: string | null): UnitParse => (unit === null ? { ok: false, message: 'is not measured' } : parseUnitText(unit));
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
  const notCompiling = compiled.errors.length > 0;
  const whoOf = (rec: { author: string }, _id: string): DisplayAuthor => (rec.author === 'olumi' ? 'olumi' : rec.author === 'structure' ? 'structure' : 'person');
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
  /**
   * Who put the record on the board, in the canvas's origin vocabulary, by the same brief rule as its figure (`figureSource`):
   * the person's record whose words are not in their brief (an answer or a change they approved, a figure they typed) is
   * theirs as added (`user_set`), never "From your brief" (capacity, 27 Oct: "Staff absence", added in a later turn, was
   * marked "From your brief" beside its own "User edited" figure). Olumi's is Olumi's; a structural constant has none.
   */
  // W8 (DL, served 1c16eb41): a figure still to be asked of the person with no words of theirs claims no origin. It is not
  // "From your brief" (nothing there supports it), and it is not Olumi's either: canonical.ts `quote` is null for any
  // unanswered input, so asked with no quote cannot show who introduced it (PL/assessor AH-224727). A quoted record keeps the brief rule.
  const askedUnquoted = (rec: { author: string; quote: string | null; status?: unknown }) => rec.author === 'person' && rec.status === 'asked' && !has(rec.quote);
  const provenanceOf = (rec: { author: string; quote: string | null; status?: unknown }) => {
    const who = whoOf(rec, '');
    return who === 'structure' || askedUnquoted(rec) ? {} : { provenance: who === 'olumi' ? 'ai_inferred' : has(rec.quote) && !fromBrief(rec.quote) ? 'user_set' : 'from_brief' };
  };
  /** Whose figure it is, in the canvas's value vocabulary: none claimed for a structural constant. */
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
  /** The relations the engine calculates; a link in words (Box 1a) is drawn on its own, from → to, never through them. */
  const numeric: NumericRelationT[] = model.relations.filter((r): r is NumericRelationT => !isInfluence(r));
  const influences = model.relations.filter(isInfluence);
  /** A limit with one figure on a whole quantity is drawn as that quantity's goal constraint; every other limit is its own card. */
  const asConstraint = (l: CanonicalLimitT) => {
    const bound = l.measure ? Q.get(l.measure.bound) : undefined;
    return l.measure !== null && bound !== undefined && has(bound.value) && !(has(bound.low) && bound.low !== bound.high) && !has(l.measure.per);
  };
  /** The card a record is drawn on, as the projection draws it: a limit's by its form, every other record's its own id. */
  const cardOfRecord = (id: string) => { const l = model.limits.find((x) => x.id === id); return l === undefined ? id : asConstraint(l) ? l.measure!.quantity : `mp:limit:${l.id}`; };
  const influenceEnds = new Set(influences.flatMap((i) => [i.from, i.to]));
  /** A record by its own name, as the compiler names it in its reasons. */
  const labelOf = (id: string) => [...model.quantities, ...model.goals, ...model.limits, ...model.options, ...model.risks].find((r) => r.id === id)?.label ?? id;
  /**
   * WHY A GOAL OR LIMIT IS NOT CALCULATED (Q1 reader r2, PL 16:33): the compiler's own reasons, which name every link in words
   * and unsized risk its closure reaches; an aim or guardrail with no measure has no closure, so the links in words and risks
   * on it are named from the model, by the same labels. Said only where it is not calculated. Every reason is kept, an error's
   * too, each starting with a capital (DL, 28 Oct: correctness over shortening; shortening from the typed reasons is after the alpha).
   */
  const withheldReasonOf = (rec: { id: string; measure: unknown }, outcome: { status: string; reasons: readonly string[] } | undefined): Rec => {
    if (outcome === undefined || outcome.status === 'calculable') return {};
    const on = [...influences.filter((i) => i.to === rec.id).map((i) => `"${labelOf(i.from)} → ${labelOf(i.to)}"`),
      ...model.risks.filter((k) => k.effect_on === rec.id).map((k) => `the risk "${k.label}"`)];
    const linked = rec.measure === null && on.length > 0 ? [`It is linked in words from ${on.length === 1 ? on[0] : `${on.slice(0, -1).join(', ')} and ${on.at(-1)}`}.`] : [];
    return { withheld_reason: [...outcome.reasons.map((r) => r.charAt(0).toUpperCase() + r.slice(1)), ...linked].join(' ') };
  };
  // Every link is drawn (Paul: show, never hide; S1 strip): one whose size no one has given and whose direction is not stated
  // has no sign and no strength band (`rateLink`).

  const nodes: Rec[] = [];
  const edges: Rec[] = [];
  const goal_constraints: Rec[] = [];
  const items: ProjectedItem[] = [];

  // ── how each quantity is used, to decide where it is drawn ─────────────────────────────────────────────────────────
  const uses = new Map<string, Set<string>>();
  const use = (id: string, how: string) => { if (Q.has(id)) uses.set(id, new Set([...(uses.get(id) ?? []), how])); };
  const hostOf = new Map<string, { node?: string; edge?: string }>();
  /** An asked figure said on another card or link: its question goes on that card (C13, 27 Oct: a goal's asked target was asked nowhere). */
  const foldedQuestions: { host: { node?: string; edge?: string }; question: string }[] = [];
  /** A window's length or origin timing is consumed into its window, so it is in the calculation exactly when one of its
   *  owners is (a goal and a limit read over the same window both own it: the limit's never replaces the goal's). */
  const windowOwners = new Map<string, string[]>();
  const ownWindow = (t: string, owner: string) => windowOwners.set(t, [...(windowOwners.get(t) ?? []), owner]);
  /** A per-unit rate is drawn ONE way, on its driver's link (`links.ts`). */
  const rateOf = (r: CanonicalModelT['relations'][number]) => rateOfLink(r, Q);
  for (const r of numeric) {
    const rate = rateOf(r);
    const froms = rate ? [rate.driver] : r.form === 'definition' ? r.parts.map((p) => p.id) : r.form === 'effect' ? [r.base, ...r.terms.map((t) => t.driver)] : [r.start, ...r.inflows, ...r.outflows];
    const ids = froms.map((f) => edgeId(f, r.defines));
    relationEdgeIds.set(r.id, ids);
    froms.forEach((f) => use(f, 'node'));
    if (r.form === 'effect') r.terms.forEach((t, i) => { use(t.coefficient, 'coefficient'); hostOf.set(t.coefficient, { edge: ids[i + 1]! }); });
    if (rate) { use(rate.coefficient, 'coefficient'); hostOf.set(rate.coefficient, { edge: ids[0]! }); }
    use(r.defines, 'node');
  }
  // A link in words joins two cards: a quantity at either end keeps its own card (Box 1a).
  for (const i of influences) { use(i.from, 'node'); use(i.to, 'node'); relationEdgeIds.set(i.id, [edgeId(cardOfRecord(i.from), cardOfRecord(i.to))]); }
  for (const g of model.goals) if (g.measure) {
    use(g.measure.quantity, 'node');
    if (has(g.measure.per)) use(g.measure.per, 'node');
    for (const t of [g.measure.target, g.measure.window?.periods, g.measure.window?.origin_offset]) if (has(t)) { use(t, 'on_goal'); hostOf.set(t, { node: g.id }); }
    for (const t of [g.measure.window?.periods, g.measure.window?.origin_offset]) if (has(t)) ownWindow(t, g.id);
  }
  for (const l of model.limits) if (l.measure) {
    const lm = l.measure;
    use(lm.quantity, 'node');
    if (has(lm.per)) use(lm.per, 'node');
    for (const t of [lm.bound, lm.window?.periods, lm.window?.origin_offset]) if (has(t)) { use(t, 'on_limit'); hostOf.set(t, { node: lm.quantity }); }
    for (const t of [lm.window?.periods, lm.window?.origin_offset]) if (has(t)) ownWindow(t, l.id);
  }
  // A start timing given by a quantity ("when the extension opens") is said on the card whose start it sets, never a loose
  // card (C13, 27 Oct). Keyed per card, so one timing shared by two cards stays its own card.
  const ownTiming = (t: number | string, card: string) => { if (typeof t === 'string') { use(t, `starts:${card}`); hostOf.set(t, { node: card }); } };
  for (const o of model.options) for (const s of o.sets) { use(s.quantity, 'node'); if (has(s.to)) { use(s.to, 'on_option'); hostOf.set(s.to, { node: o.id }); } ownTiming(s.starts_after_periods, o.id); }
  for (const k of model.risks) { use(k.effect_on, 'node'); for (const t of [k.occurrence, k.severity]) if (has(t)) { use(t, 'on_risk'); hostOf.set(t, { node: k.id }); } ownTiming(k.starts_after_periods, k.id); }
  const folded = (id: string) => { const u = uses.get(id); return u !== undefined && u.size === 1 && !u.has('node') && hostOf.has(id); };
  /** A coefficient sizes a mechanism: drawn as one wherever it has a card, given or worked out, never as an outcome. */
  const isCoefficient = (id: string) => uses.get(id)?.has('coefficient') === true;

  /** The shared law's reading: the compiler's disclosure (with the domain) when the quantity is in the run, else the same law
   *  within the same domain (a chance's, a timing's or what the model declares), so a card's spread and centre never change
   *  only because the goal became calculable (numbers#4). */
  const lawFor = (q: CanonicalQuantityT): LawReading => {
    const c = compiled.conversions.find((x) => x.kind === 'range_law' && x.quantity === q.id);
    // The compiler reads a % range as a fraction (20–40 % is 0.2–0.4); the card says it in the unit it labels (Codex r1 #3709).
    const u = parseUnit(q.unit), k = u.ok ? u.unit.scale : 1;
    if (c && c.kind === 'range_law') {
      const r = c.reading;
      return k === 1 ? r : { ...r, centre: r.centre / k, sd_below: r.sd_below / k, sd_above: r.sd_above / k, sd: r.sd / k, lower: r.lower / k, upper: r.upper / k,
        mean: r.mean / k, sd_conditioned: r.sd_conditioned / k };
    }
    const inside = !has(q.value) || (q.low! < q.value && q.value < q.high!);
    const d = compiled.domains[q.id];
    const domain = d === undefined ? undefined : { ...(d.min === undefined ? {} : { min: d.min / k }), ...(d.max === undefined ? {} : { max: d.max / k }) };
    return inside ? readRange(rangeDistOf(q, 1, domain)) : { kind: 'held', reason: 'its most likely figure is not inside its range' };
  };
  const lawOf = (q: CanonicalQuantityT) => (has(q.low) && has(q.high) && q.low < q.high && (q.status === 'known' || q.status === 'estimated')
    ? { law: { author: 'olumi' as const, provisional: true as const, range_kind: q.range_kind, reading: lawFor(q) } } : {});
  const display = (q: CanonicalQuantityT): string => {
    if (q.unit === null) return 'not measured'; // an unmeasured factor has no scale to say a figure on (Box 1a)
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
    const cap = relative ? null : resolveGoalThresholdCapWithProvenance(undefined, raw, target.unit ?? undefined, undefined);
    const src = figureSource(target)['source'];
    return { goal_threshold_raw: raw,
      ...(cap !== null ? { goal_threshold: raw / cap.cap, goal_threshold_cap: cap.cap, goal_threshold_cap_provenance: cap.provenance } : {}),
      ...(src === 'brief_extraction' ? { threshold_source: 'brief_extraction' } : src === 'user_override' ? { threshold_source: 'user', success_threshold: raw }
        : src === 'cee_inference' ? { threshold_source: 'cee_inference' } : {}) };
  };

  /** What a derived figure is worked out from, by name: its relation's parts, base and drivers, or a stock's start and flows,
   *  each once (a driver with two terms is still one input: the goal said "Tech leads hired, Tech leads hired", 27 Oct). */
  const partsOf = new Map(numeric.map((r) => [r.defines, [...new Set(r.form === 'definition' ? r.parts.map((p) => p.id) : r.form === 'effect' ? [r.base, ...r.terms.map((t) => t.driver)] : [r.start, ...r.inflows, ...r.outflows])]] as const));
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
   * The goal as the model reads it, in the model's own terms (W3b, 26 Oct: the card said "from today" for a change measured
   * against "carry on as now", and dropped the window and who chose the measure): what a change is measured FROM, the window
   * it is read over (its periods as given, or null while asked), and whether the person or Olumi chose the measure. Facts
   * the model holds, nothing worked out; `goal_threshold_frame` keeps the contract's meaning for the target's figure.
   */
  const goalFactsOf = (g: CanonicalModelT['goals'][number]): Rec => {
    const m = g.measure;
    if (!m) return {};
    const ref = m.reference;
    const reference = m.frame === 'level' || ref === null ? {}
      : { goal_reference: ref.kind === 'now' ? { kind: 'now' }
        : ref.kind === 'option' ? { kind: 'option', option_id: ref.option, label: model.options.find((o) => o.id === ref.option)?.label ?? null }
          : { kind: 'value', quantity_id: ref.quantity, label: has(ref.quantity) ? Q.get(ref.quantity)?.label ?? null : null } };
    const w = m.window;
    const p = w ? Q.get(w.periods) : undefined;
    const periods = p && (p.status === 'known' || p.status === 'estimated') && has(p.value) && !(has(p.low) && has(p.high) && p.low !== p.high) ? p.value : null;
    const window = w ? { goal_window: { aggregation: m.aggregation, start: w.start, periods, period_unit: model.period, origin_event: w.origin_event } } : {};
    return { ...reference, ...window, goal_measure_by: m.measure_by };
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
  // The board's name is Olumi's short title, the question beneath it; a model saved before titles draws its question as
  // before. Olumi's coaching questions ride on it, at most the three the first screen shows (Paul 27 Oct).
  const title = has(model.title) && model.title.trim() !== '' ? model.title : null;
  nodes.push({ id: DECISION_NODE_ID, kind: 'decision', label: title ?? model.question, ...(title !== null ? { description: model.question } : {}),
    ...(model.coaching_questions.length > 0 ? { coaching_questions: model.coaching_questions.slice(0, 3) } : {}) });
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
      // Its label is a short title; beneath it, the person's own words (their quote), or nothing for Olumi's.
      id: g.id, kind: 'goal', label: g.label, ...(who === 'person' && has(g.quote) ? { description: g.quote } : {}), ...provenanceOf(g), ...quoteOf(g, g.id),
      ...participation(inCalc || (has(g.measure) && kept(per))),
      ...(g.measure ? { goal_direction: g.measure.cmp, goal_threshold_frame: g.measure.frame, ...(g.measure.frame === 'level' ? {} : { quantity_frame: 'level' }),
        ...(target ? { goal_threshold_unit: g.measure.frame === 'change_rel' ? (metricUnit ?? '1') : target.unit, display_value: `${g.measure.cmp} ${display(target)}` } : {}),
        ...(point !== null && target ? goalTarget(point, target, g.measure.frame) : {}) } : {}),
      ...(has(g.question) ? { user_questions: [g.question] } : {}),
      ...horizonOf(g),
      ...goalFactsOf(g),
      ...withheldReasonOf(g, per),
      // A total over a window or a per-quantity ratio is not the measured quantity's level today, and a change from a stated
      // value or from an option is not a change from today (integrated review 26 Oct: "Today: X" beside "up N% from today").
      ...(metric?.status === 'derived' && g.measure?.per === null && g.measure.aggregation !== 'sum' && goalUnit
        && (g.measure.frame === 'level' || g.measure.reference?.kind === 'now')
        ? { ...derivedObservation(metric, goalUnit), ...basisOf(metric) } : {}),
    });
    items.push({ record_id: g.id, family: 'goal', shown_as: { node: g.id }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: g.approval });
    // What the goal measures: no size and no sign ("keep costs under £8,000" was drawn as a "+").
    if (g.measure && Q.has(g.measure.quantity)) {
      edges.push({ ...link(g.measure.quantity, g.id, null, who, inCalc, { definitional: true }), id: edgeId(g.measure.quantity, g.id) });
    }
  }
  for (const o of model.options) {
    const inCalc = xo.has(o.id);
    const who = whoOf(o, o.id);
    const per = compiled.perOption.find((p) => p.option_id === o.id);
    const interventions: Rec = {};
    for (const s of o.sets) {
      const to = has(s.to) ? Q.get(s.to) : undefined;
      const starts = typeof s.starts_after_periods === 'string' ? Q.get(s.starts_after_periods) : undefined;
      // Its own label and words, so the card says the setting whether or not the set quantity has a card of its own (Q1, 28 Oct).
      const set = Q.get(s.quantity);
      // Words only for an explicit switch (structure-authored, 0 or 1); never a person's or Olumi's share that happens to be 0 or 1 (PL 03:12Z).
      // An exact setting only: a range around 0 or 1 is said as its range, never as "In use" (PL 03:58Z).
      const onOff = set !== undefined && set.author === 'structure' && (set.unit === '1' || set.unit === '') && (set.value === 0 || set.value === 1) && (to?.value === 0 || to?.value === 1)
        && !(has(to?.low) && has(to?.high) && to!.low !== to!.high);
      if (to) interventions[s.quantity] = { value: to.value, unit: to.unit, display: display(to), display_value: onOff ? (to.value === 1 ? 'In use' : 'Not in use') : display(to),
        label: set?.label ?? s.quantity, from_period: s.starts_after_periods, ...(starts ? { from_period_display: display(starts) } : {}), ...settingSource(to, o) };
    }
    nodes.push({
      id: o.id, kind: 'option', label: o.label, ...provenanceOf(o), ...quoteOf(o, o.id), ...participation(inCalc || (o.status === 'live' && kept(per))),
      // The baseline is the option the model declares carries on as now (Box 1a), never read from empty settings or a name.
      ...(o.carry_on === true ? { is_baseline: true } : {}), ...(Object.keys(interventions).length ? { interventions } : {}),
      ...(o.author === 'olumi' ? { proposed_by: 'olumi' } : {}),
    });
    items.push({ record_id: o.id, family: 'option', shown_as: { node: o.id }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: o.approval });
    // Neither link is a causal claim and the model states no sign for either (an option sets a figure, up or down): no sign.
    edges.push({ ...link(DECISION_NODE_ID, o.id, null, who, inCalc, {}), id: edgeId(DECISION_NODE_ID, o.id) });
    for (const s of o.sets) if (Q.has(s.quantity)) edges.push({ ...link(o.id, s.quantity, null, who, inCalc, {}), id: edgeId(o.id, s.quantity) });
  }

  /**
   * A figure on the field the card's value line and editor read, with whose it is: a point as given; a range at its centre
   * (the figure given, else the centre Olumi reads it around) with both ends as `range`. An asked or unknown quantity has
   * no figure, so only its unit is drawn; a derived one carries only an exact initial figure the engine can support.
   */
  const observedOf = (q: CanonicalQuantityT): Rec => {
    // Every card's figure is in its quantity's own unit (DL 23 Oct: the in-card editor reads it here, never the 0–1 model
    // scale), a question's or an unknown's too. A derived figure keeps its worked-out basis, never anyone's source stamp.
    // An unmeasured factor has no unit and no figure to observe (Box 1a).
    if (q.unit === null) return {};
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
    const inCalc = xq.has(q.id) || (windowOwners.get(q.id) ?? []).some((owner) => xg.has(owner) || xl.has(owner));
    const who = whoOf(q, q.id);
    const reason = q.status === 'asked' ? `Asked: ${q.question}` : q.status === 'derived' || q.status === 'known' || q.status === 'estimated'
      ? 'Nothing that can be worked out yet uses it.' : `${q.status.replace('_', ' ')}: ${q.basis}`;
    if (folded(q.id)) {
      const host = hostOf.get(q.id)!;
      if (q.status === 'asked' && has(q.question)) foldedQuestions.push({ host, question: q.question });
      items.push({ record_id: q.id, family: 'quantity', shown_as: host.edge ? { on_edge: host.edge } : { on_node: host.node }, in_calculation: inCalc, why_out: why(inCalc, reason), author: who, approval: q.approval, ...lawOf(q) });
      continue;
    }
    nodes.push({
      id: q.id, kind: q.status === 'derived' && !isCoefficient(q.id) ? 'outcome' : 'factor', label: q.label, ...provenanceOf(q), ...quoteOf(q, q.id),
      ...participation(inCalc || (!notCompiling && inModel.has(q.id) && !OUT_OF_ANALYSIS.has(q.status) && q.unit !== null)),
      ...(q.status !== 'derived' ? { category: controlled.has(q.id) ? 'controllable' : 'observable' } : {}),
      ...observedOf(q),
      // A figure still to be given or not known yet reads "?" on its card; its question and reason stay beside it (Q1, 28 Oct).
      display_value: q.status === 'asked' || q.status === 'unknown' ? '?' : display(q),
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
    // direction (issue 39); with none, a range's centre (the model's median) and with no range no sign (drawn unsigned,
    // never hidden). A given value keeps its own sign. A range across zero also says its direction is not settled, so the
    // canvas never draws it as settled (C13, 27 Oct).
    const stated = c && directionUsed(c) ? c.direction : null;
    const sign = stated === 'lowers' ? -1 : stated === 'raises' ? 1 : mid === null ? null : mid < 0 ? -1 : 1;
    const driverUnit = Q.get(driver)?.unit ?? '';
    const definedUnit = Q.get(defines)?.unit ?? '';
    // The link's figure is what the compiler uses, per ONE of the driver's unit, in the defined quantity's unit: the
    // coefficient's own unit scale applied (a 40 % rate moves 0.4 loaf/week per loaf/week; Codex r4 #3709), as lawFor does.
    const scaleOf = (unit: string | null) => { const u = parseUnit(unit); return u.ok ? u.unit.scale : 1; };
    const k = c ? scaleOf(c.unit) * scaleOf(driverUnit) / scaleOf(definedUnit) : 1;
    // Its real size, in natural units. No β is keyed to it: the model holds none, and the link carries no strength (W3b).
    const natural = c && has(c.value)
      ? { natural_effect: { amount: c.value * k, amount_unit: definedUnit, per_source_change: 1, per_source_change_unit: driverUnit,
        ...(has(c.low) && has(c.high) && c.low !== c.high ? { stated_range: { low: c.low * k, high: c.high * k, text: `${fmt(c.low)}–${fmt(c.high)}`, end: 'centre' } } : {}) } }
      : {};
    const reasoning = c ? `${display(c)} per ${driverUnit || 'unit'}${straddles ? '; its direction is not settled' : ''}${mid === null ? '; its size is not given yet' : ''}` : '';
    return { ...link(driver, defines, sign, who, inCalc, { ...natural, reasoning, ...(c ? { magnitude: c.author === 'olumi' ? 'olumi_estimate' : 'user_stated' } : {}) }),
      ...(straddles ? { direction_settled: false } : {}) };
  };

  // ── relations and effect terms: links ──────────────────────────────────────────────────────────────────────────────
  for (const r of model.relations) {
    if (isInfluence(r)) {
      // A link in words (Box 1a): from → to, its sign only where it states up or down, its basis as its reasoning; no size.
      const id = relationEdgeIds.get(r.id)![0]!;
      const sign = r.direction === 'up' ? 1 : r.direction === 'down' ? -1 : null;
      edges.push({ ...link(cardOfRecord(r.from), cardOfRecord(r.to), sign, whoOf(r, r.id), false, has(r.basis) ? { reasoning: r.basis } : {}), ...(sign === null ? { direction_settled: false } : {}),
        // Q1 reader r2: the link's own words, copied for the canvas's hover and detail (never a probability read from them).
        link_words: { direction: r.direction, confidence: r.confidence, basis: r.basis }, id });
      items.push({ record_id: r.id, family: 'relation', shown_as: { edge: id }, in_calculation: false, why_out: why(false, 'A link in words: drawn, never calculated.'), author: whoOf(r, r.id), approval: r.approval });
      continue;
    }
    const inCalc = xq.has(r.defines);
    const who = whoOf(r, r.id);
    const reason = 'What it works out is not used by anything that can be worked out yet.';
    const drawn: string[] = [];
    const ids = [...relationEdgeIds.get(r.id)!];
    const push = (e: Rec) => { const id = ids.shift()!; edges.push({ ...e, id }); drawn.push(id); return id; };
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
        items.push({ record_id: `${r.id}:${t.driver}`, family: 'term', shown_as: { edge: id }, in_calculation: inCalc, why_out: why(inCalc, reason), author: termWho, approval: t.approval });
      }
    }
    items.push({ record_id: r.id, family: 'relation', shown_as: { edge: drawn.join(' ') }, in_calculation: inCalc, why_out: why(inCalc, reason), author: who, approval: r.approval });
  }

  // ── limits: one figure on a whole quantity is a goal constraint; every other limit is its own card ───────────────────
  for (const l of model.limits) {
    const inCalc = xl.has(l.id);
    const who = whoOf(l, l.id);
    const lm = l.measure;
    const bound = lm ? Q.get(lm.bound) : undefined;
    const per = compiled.perLimit.find((p) => p.limit_id === l.id);
    if (lm && bound && has(bound.value) && asConstraint(l)) {
      const point = bound.value;
      // The canvas draws a goal constraint itself, as the goal card's limit: a card as well said it twice on reopen (27 Oct).
      goal_constraints.push({
        constraint_id: l.id, node_id: lm.quantity, operator: lm.cmp.startsWith('>') ? '>=' : '<=', ...(lm.cmp === '<' || lm.cmp === '>' ? { operator_as_stated: lm.cmp } : {}),
        value: point, label: l.label, unit: bound.unit, ...(who === 'person' && has(l.quote) ? { source_quote: l.quote.slice(0, 200) } : {}),
        provenance: who === 'olumi' ? 'inferred' : 'explicit',
      });
      items.push({ record_id: l.id, family: 'limit', shown_as: { constraint: l.id, on_node: lm.quantity }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: l.approval });
      continue;
    }
    // Any other limit is a card, its figure (a range, or a figure per unit) said in the model's own words; never an invented scale.
    const id = `mp:limit:${l.id}`;
    const figure = bound && (bound.status === 'known' || bound.status === 'estimated') && (has(bound.value) || (has(bound.low) && has(bound.high))) ? display(bound) : null;
    const description = !lm ? `${l.label} (no measure yet, so the result does not cover it).` : figure === null ? `${l.label} (its figure is not given yet).`
      : `${l.label}: ${Q.get(lm.quantity)?.label ?? lm.quantity}${has(lm.per) ? ` per ${Q.get(lm.per)?.label ?? lm.per}` : ''} ${CMP_WORDS[lm.cmp]} ${figure}.`;
    nodes.push({ id, kind: 'action', label: `Limit: ${l.label}`, description, ...provenanceOf(l), ...quoteOf(l, l.id), ...participation(inCalc || (has(lm) && kept(per))), ...withheldReasonOf(l, per) });
    // What the limit measures, as a goal's measure is drawn: no size and no sign.
    if (lm && Q.has(lm.quantity)) edges.push({ ...link(lm.quantity, id, null, who, inCalc, { definitional: true }), id: edgeId(lm.quantity, id) });
    items.push({ record_id: l.id, family: 'limit', shown_as: { node: id }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: l.approval });
  }

  // ── preferences: wishes without a threshold; the canvas draws them from the model ─────────────────────────────────────
  for (const p of model.preferences) {
    items.push({ record_id: p.id, family: 'preference', shown_as: {}, in_calculation: false, why_out: 'A preference: shown and reported, never calculated as a goal or a limit.', author: whoOf(p, p.id), approval: p.approval, concerns: [p.quantity] });
  }

  // ── risks ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * A risk's chance on the field the risk card reads (W3b, 26 Oct: the card said "Likelihood and impact not set yet" over a
   * chance the model holds): the canvas's event_risk.v1, its range (or point) as a fraction, whose it is, over the model's
   * own horizon, which is the window the model reads the chance over. Only where that horizon is a whole number of months
   * (a weekly model's is not) and the figure is someone's: never converted.
   */
  const eventRiskOf = (occ: CanonicalQuantityT | undefined): Rec => {
    if (!occ || x === null || (occ.status !== 'known' && occ.status !== 'estimated')) return {};
    const who = whoOf(occ, occ.id);
    const basis = who === 'person' ? 'user' : who === 'olumi' ? 'olumi' : null;
    const u = parseUnit(occ.unit);
    if (basis === null || !u.ok || Object.keys(u.unit.dims).length > 0) return {};
    const ranged = has(occ.low) && has(occ.high) && occ.low !== occ.high;
    const [lo, hi] = ranged ? [occ.low!, occ.high!] : has(occ.value) ? [occ.value, occ.value] : [null, null];
    const months = x.period_unit === 'month' ? x.periods : x.period_unit === 'year' ? x.periods * 12 : null;
    if (lo === null || hi === null || months === null) return {};
    const block = { version: 1, occurrence: { p_low: lo * u.unit.scale, p_high: hi * u.unit.scale, meaning: 'at_least_once_within_horizon', basis }, horizon: { months } };
    return EventRiskV1.safeParse(block).success ? { event_risk: block } : {};
  };
  /**
   * The sign of what a risk does if it happens, from its own figure against no change (0 added, × 1): a risk that multiplies
   * by 0.5 lowers what it moves. A given figure keeps its own sign; a range wholly on one side has that side's; one across no
   * change, or no figure at all, has none (W3b: every multiplying risk was drawn as a boost).
   */
  const riskSign = (k: CanonicalModelT['risks'][number], sev: CanonicalQuantityT | undefined): 1 | -1 | null => {
    if (!sev) return null;
    const u = parseUnit(sev.unit), scale = k.mode === 'multiply' && u.ok ? u.unit.scale : 1;
    const none = k.mode === 'multiply' ? 1 : 0;
    const side = (v: number): 1 | -1 | null => (v * scale < none ? -1 : v * scale > none ? 1 : null);
    if (has(sev.value)) return side(sev.value);
    if (!has(sev.low) || !has(sev.high)) return null;
    return side(sev.high) === -1 ? -1 : side(sev.low) === 1 ? 1 : null;
  };
  /** A risk's start given by a figure, with that figure: it is folded onto this card, so the card says it (PL #3859 AMEND). */
  const riskStartWords = (id: string): string => { const t = Q.get(id); return t ? `from "${t.label}" (${display(t)})` : `from "${id}"`; };
  const onCard = new Set([...model.quantities, ...model.goals, ...model.limits, ...model.options].map((r) => r.id));
  for (const k of model.risks) {
    const inCalc = xr.has(k.id);
    const who = whoOf(k, k.id);
    const occ = has(k.occurrence) ? Q.get(k.occurrence) : undefined;
    const sev = has(k.severity) ? Q.get(k.severity) : undefined;
    const effect = k.mode === 'add' ? 'adds' : k.mode === 'multiply' ? 'multiplies by' : 'its effect is';
    nodes.push({
      id: k.id, kind: 'risk', label: k.label, ...provenanceOf(k), ...quoteOf(k, k.id), ...participation(inCalc || (!notCompiling && inModel.has(k.effect_on))),
      ...eventRiskOf(occ),
      description: `Chance: ${occ ? display(occ) : 'not given'}. If it happens: ${effect} ${sev ? display(sev) : 'not given'}, ${typeof k.starts_after_periods === 'number' ? (k.starts_after_periods === 0 ? 'from the start' : `after ${k.starts_after_periods} ${model.period}s`) : riskStartWords(k.starts_after_periods)}.`,
    });
    items.push({ record_id: k.id, family: 'risk', shown_as: { node: k.id }, in_calculation: inCalc, why_out: why(inCalc, 'What it affects is not used by anything that can be worked out yet.'), author: who, approval: k.approval });
    // How it acts if it happens (adds, or multiplies), so the link can say "−" or "×" (C13, 27 Oct).
    if (has(k.occurrence) && has(k.severity) && has(k.mode) && Q.has(k.effect_on)) {
      edges.push({ ...link(k.id, k.effect_on, riskSign(k, sev), who, inCalc, { reasoning: 'if it happens' }), effect_mode: k.mode, id: edgeId(k.id, k.effect_on) });
    } else if (onCard.has(k.effect_on)) {
      // A risk no one can size, or one on an aim, a limit or an option (Box 1a): the same link to that card, signed by its own
      // direction where it states one, else unsettled.
      const sign = k.direction === 'up' ? 1 : k.direction === 'down' ? -1 : null, to = cardOfRecord(k.effect_on);
      edges.push({ ...link(k.id, to, sign, who, inCalc, { reasoning: 'if it happens' }), ...(has(k.mode) ? { effect_mode: k.mode } : {}), ...(sign === null ? { direction_settled: false } : {}),
        link_words: { direction: k.direction, confidence: null, basis: null }, id: edgeId(k.id, to) }); // a risk records no confidence or basis of its own
    }
  }

  // ── qualitative records: not cards; the canvas draws them by id from the model ────────────────────────────────────────
  for (const f of QUALITATIVE_FAMILIES) for (const rec of model[f] as readonly { id: string; author: string; quote: string | null; approval: 'proposed' | 'approved'; concerns: string[] }[]) {
    items.push({ record_id: rec.id, family: f, shown_as: {}, in_calculation: false, why_out: 'A note: shown beside the model, never calculated.', author: whoOf(rec, rec.id), approval: rec.approval, concerns: [...rec.concerns] });
  }

  // ── the situation, not the arithmetic (Paul's Q1 ruling, 28 Oct) ────────────────────────────────────────────────────
  // An on/off switch an option sets is said on that option's card, and an Olumi total worked out on the way to an aim is said
  // in that aim's "worked out from"; neither is its own card. Each link through one is drawn straight from what feeds it to
  // what it feeds, so every path from an option to an aim stays on the board. Never a figure of the person's, one with a
  // question, a coefficient, or anything an aim or limit measures; the model and the calculation are unchanged.
  const measured = new Set([...model.goals, ...model.limits].flatMap((g) => (g.measure ? [g.measure.quantity, g.measure.per] : [])).filter(has));
  for (const g of model.goals) if (g.measure?.reference?.kind === 'value' && has(g.measure.reference.quantity)) measured.add(g.measure.reference.quantity);
  const cardOf = new Map(nodes.map((n) => [n.id as string, n] as const));
  // A link in words is drawn from → to as the model states it, so neither end is ever folded into another link (Box 1a).
  const foldable = (q: CanonicalQuantityT) => cardOf.has(q.id) && q.author !== 'person' && !has(q.quote) && !has(q.party) && !has(q.question)
    && !measured.has(q.id) && q.kind !== 'coefficient' && !isCoefficient(q.id) && !influenceEnds.has(q.id);
  /** Everything a quantity's relation reads, its link sizes included (a total shared through a worked-out size, Codex r2 #3875 9). */
  const readsOf = new Map(numeric.map((r) => [r.defines, r.form === 'definition' ? r.parts.map((p) => p.id) : r.form === 'effect'
    ? [r.base, ...r.terms.flatMap((t) => [t.driver, t.coefficient])] : [r.start, ...r.inflows, ...r.outflows]] as const));
  /** Every quantity an aim's measure is worked out from, nearest first. */
  const upstream = (id: string): string[] => { const seen: string[] = []; const walk = (x: string) => { for (const p of readsOf.get(x) ?? []) if (!seen.includes(p)) { seen.push(p); walk(p); } }; walk(id); return seen; };
  /** What an aim's measure reads: its quantity, a per-unit denominator and a stated reference value (Codex r1 #3875 B5). */
  const measureReads = (g: CanonicalModelT['goals'][number]) => (g.measure ? [g.measure.quantity, g.measure.per,
    g.measure.reference?.kind === 'value' ? g.measure.reference.quantity : null].filter(has) : []);
  const goalUpstream = new Map(model.goals.filter((g) => has(g.measure))
    .map((g) => [g.id, [...new Set(measureReads(g).flatMap((m) => [m, ...upstream(m)]))]] as const));
  const optionsSetting = (id: string) => model.options.filter((o) => o.sets.some((s) => s.quantity === id)).map((o) => o.id).sort();
  /** Each option's setting of a switch turns it up from where it stands, so the option's link keeps the switch link's sign and
   *  size; one that turns it down (or holds it) keeps the switch its card (Codex r2 #3875 8). */
  const turnsUp = (q: CanonicalQuantityT) => model.options.every((o) => o.sets.every((s) => {
    if (s.quantity !== q.id) return true;
    const to = has(s.to) ? Q.get(s.to) : undefined;
    // An exact setting above where the switch stands. Any range keeps the switch drawn: a plausible span gives no bound, and
    // its ends are never read as one (Codex r3 6; PL 04:07Z).
    return to !== undefined && has(to.value) && !(has(to.low) && has(to.high) && to.low !== to.high) && to.value > q.value!;
  }));
  const switches = new Map(model.quantities.filter((q) => q.author === 'structure' && q.status === 'known' && q.kind === 'fact' && controlled.has(q.id) && has(q.value)
    && !(has(q.low) && has(q.high) && q.low !== q.high) && foldable(q) && turnsUp(q)).map((q) => [q.id, optionsSetting(q.id)[0]!] as const));
  /** A structural constant (a zero base, a unit conversion): arithmetic the model's form needs, never a lever. */
  const isConstant = (q: CanonicalQuantityT | undefined) => q !== undefined && q.author === 'structure' && q.status === 'known' && q.kind === 'fact' && !controlled.has(q.id) && foldable(q)
    // a constant a risk acts on is part of that risk's path to the aim: it stays drawn (Codex r2 #3875 7)
    && !model.risks.some((k) => k.effect_on === q.id);
  const definedBy = new Map(numeric.map((r) => [r.defines, r] as const));
  /** A total: a sum or product, or an amount added on a structural zero; a mechanism with a real base level stays its card. */
  const isTotal = (q: CanonicalQuantityT) => {
    const r = definedBy.get(q.id);
    return q.author === 'olumi' && q.status === 'derived' && q.kind === 'derived' && !controlled.has(q.id) && foldable(q) && r !== undefined
      && (r.form === 'definition' || (r.form === 'effect' && isConstant(Q.get(r.base)) && Q.get(r.base)!.value === 0));
  };
  // A total a risk acts on keeps its card: how the risk moves the aim depends on the total's own sign (Codex r3 7).
  const totals = new Map(model.quantities.filter((q) => isTotal(q) && !model.risks.some((k) => k.effect_on === q.id))
    .flatMap((q) => { const aim = [...goalUpstream].filter(([, up]) => up.includes(q.id)).map(([g]) => g).sort()[0]; return aim === undefined ? [] : [[q.id, aim] as const]; }));
  /** A constant used only inside totals goes with them: said in the aim's workings, with no link of its own. */
  const constants = new Map(model.quantities.filter((q) => isConstant(q) && numeric.some((r) => partsOf.get(r.defines)?.includes(q.id))
    && numeric.every((r) => !partsOf.get(r.defines)?.includes(q.id) || totals.has(r.defines)))
    .map((q) => [q.id, totals.get(numeric.find((r) => partsOf.get(r.defines)?.includes(q.id))!.defines)!] as const));
  const reasoningOf = (e: Rec) => String((e.provenance as Rec | undefined)?.['reasoning'] ?? '');
  const definitionalLink = (e: Rec) => (e.provenance as Rec | undefined)?.['definitional'] === true;
  /** A link that carries what feeds it one for one, in the same unit: a part added, or an effect's base level. A stock's
   *  start and inflows accumulate over periods, so a size per period never becomes the stock's own (Codex r1 #3875 B3). */
  const oneForOne = (e: Rec) => definitionalLink(e) && e.effect_direction === 'positive' && /^(added|base level)$/.test(reasoningOf(e));
  /** Two links make one only when at most one of them has a size, so the straight link never claims a size the model lacks. */
  const composable = (a: Rec, b: Rec) => oneForOne(a) || oneForOne(b) || (!has(a.coefficient_id) && !has(b.coefficient_id));
  const usedIds = new Set(edges.map((e) => e.id as string));
  const freshId = (from: string, to: string, via: string) => {
    let id = `${from}__${to}`;
    for (let n = 1; usedIds.has(id); n++) id = n === 1 ? `${from}__${to}__via__${via}` : `${from}__${to}__via__${via}__${n}`;
    usedIds.add(id);
    return id;
  };
  const replaced = new Map<string, string[]>();
  const offBoard = new Map<string, string>();
  for (const f of [...switches.keys(), ...totals.keys()].sort()) {
    const all = edges.filter((e) => e.to === f), outs = edges.filter((e) => e.from === f);
    // A constant's plain part into a total carries nothing to what the total feeds: it is said in the workings, never drawn.
    // A link with a size of its own (a coefficient, and any question on it) is never dropped (Codex r1 #3875 B1).
    const dropped = (a: Rec) => constants.has(a.from as string) && definitionalLink(a) && !has(a.coefficient_id);
    const ins = all.filter((a) => !dropped(a));
    // A switch is folded only when every link into it is an option setting it: anything else acting on it (a risk) keeps
    // the switch its card, never copying the option's size onto it (Codex r1 #3875 B4).
    const setters = new Set(optionsSetting(f));
    if (switches.has(f) && !ins.every((a) => setters.has(a.from as string))) continue;
    if (ins.length === 0 || outs.length === 0 || (totals.has(f) && !ins.every((a) => outs.every((b) => composable(a, b))))) continue;
    for (const a of all) if (dropped(a)) replaced.set(a.id as string, []);
    const label = Q.get(f)?.label ?? f;
    const made = ins.flatMap((a) => outs.map((b) => {
      const id = freshId(a.from as string, b.to as string, f);
      replaced.set(a.id as string, [...(replaced.get(a.id as string) ?? []), id]);
      replaced.set(b.id as string, [...(replaced.get(b.id as string) ?? []), id]);
      // A switch's link is the option's own (its size per the option's setting); a total's keeps the one size it can still say.
      if (switches.has(f)) return { ...b, from: a.from, id };
      // How a risk acts (adds, multiplies) is said of what it acts on, never of what that total then feeds.
      const own = oneForOne(a) ? b : a;
      const { effect_direction: _sign, effect_mode: _mode, ...rest } = own;
      const sign = has(a.effect_direction) && has(b.effect_direction) ? (a.effect_direction === b.effect_direction ? 'positive' : 'negative') : null;
      const { definitional: _def, ...provenance } = own.provenance as Rec;
      return { ...rest, from: a.from, to: b.to, id, ...(sign === null ? {} : { effect_direction: sign }),
        provenance: { ...provenance, reasoning: `${reasoningOf(a) || 'used'} in “${label}”${reasoningOf(b) ? `, then ${reasoningOf(b)}` : ''}`,
          ...(definitionalLink(a) && definitionalLink(b) ? { definitional: true } : {}) } };
    }));
    // Where the link out of it was drawn: the replacements keep the drawing order of what they now reach.
    const at = edges.findIndex((e) => e.from === f);
    const kept = edges.filter((e) => e.to !== f && e.from !== f);
    kept.splice(edges.slice(0, at).filter((e) => e.to !== f && e.from !== f).length, 0, ...made);
    edges.splice(0, edges.length, ...kept);
    offBoard.set(f, switches.get(f) ?? totals.get(f)!);
  }
  // A constant leaves the board with the totals it fed, once none of its links is drawn.
  for (const [c, aim] of constants) if (!edges.some((e) => e.from === c || e.to === c) && [...offBoard.keys()].some((t) => partsOf.get(t)?.includes(c))) offBoard.set(c, aim);
  const resolve = (id: string): string[] => (replaced.has(id) ? replaced.get(id)!.flatMap(resolve) : [id]);
  if (offBoard.size > 0) {
    nodes.splice(0, nodes.length, ...nodes.filter((n) => !offBoard.has(n.id as string)));
    for (const it of items) {
      if (it.shown_as.edge !== undefined) it.shown_as = { ...it.shown_as, edge: it.shown_as.edge.split(' ').flatMap(resolve).join(' ') };
      // A link drawn only from a constant now drawn nowhere: the record is said where its total is.
      const host = it.shown_as.edge === '' ? offBoard.get(numeric.find((r) => r.id === it.record_id || it.record_id.startsWith(`${r.id}:`))?.defines ?? '') : undefined;
      if (host !== undefined) it.shown_as = { on_node: host };
      if (it.shown_as.on_edge !== undefined) it.shown_as = { ...it.shown_as, on_edge: resolve(it.shown_as.on_edge)[0]! };
      if (it.family === 'quantity' && offBoard.has(it.record_id) && it.shown_as.node === it.record_id) it.shown_as = { on_node: offBoard.get(it.record_id)! };
    }
    // Each aim says the totals it is worked out through, by name, so nothing folded off the board goes unsaid.
    for (const g of model.goals) {
      const off = (goalUpstream.get(g.id) ?? []).filter((t) => offBoard.has(t) && !switches.has(t));
      const inside = off.filter((t) => totals.has(t));
      const m = g.measure?.quantity;
      if (inside.length === 0 || !has(m)) continue;
      const card = cardOf.get(g.id)!;
      const own = partsOf.has(m) ? [workedOutWords(m)] : [];
      card.value_basis = { kind: 'worked_out', from: [...new Set([...(partsOf.get(m) ?? []), ...off])],
        words: [...own, ...inside.map((t) => `${Q.get(t)?.label ?? t}: ${workedOutWords(t).replace(/^W/, 'w')}`)].join('; ') };
    }
  }

  for (const { host, question } of foldedQuestions) {
    const node = host.node !== undefined ? offBoard.get(host.node) ?? host.node : undefined;
    const edge = host.edge !== undefined ? resolve(host.edge)[0] : undefined;
    const on = node !== undefined ? nodes.find((n) => n.id === node) : edges.find((e) => e.id === edge);
    if (on) on.user_questions = [...new Set([...((on.user_questions as string[] | undefined) ?? []), question])];
  }
  return { graph: { nodes, edges, goal_constraints }, items };
}

/** A link: no strength (the model holds no β), its sign only where the model gives one (null: no direction is drawn). */
function link(from: string, to: string, sign: 1 | -1 | null, who: DisplayAuthor, inCalc: boolean, extra: Rec): Rec {
  const { reasoning, magnitude, definitional, ...rest } = extra;
  const provenance = {
    source: who === 'person' ? 'brief_extraction' : 'cee_hypothesis',
    ...(has(reasoning) ? { reasoning } : {}), ...(has(magnitude) ? { magnitude } : {}), ...(definitional === true ? { definitional: true } : {}), ...rest,
  };
  return {
    from, to, exists_probability: 1, ...(sign === null ? {} : { effect_direction: sign > 0 ? 'positive' : 'negative' }),
    provenance, origin: inCalc ? 'model_program:calculation' : 'model_program:display',
  };
}
