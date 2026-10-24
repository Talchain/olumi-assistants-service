/**
 * THE COMPILER (spike S1): CanonicalModel → ExecutableModel, with TYPED OUTCOMES.
 *
 *   compile(model, { sourceText }) → { executable, perGoal, perLimit, perOption, joint, within_limits, coverage, errors,
 *                                     blockers, unverified, preferences, conversions, implicit_as_stated }
 *
 * Four kinds of outcome, never confused:
 *  · ERRORS are the draft's own mistakes (an undefined id, a unit that does not combine, a cycle not through a stock, an
 *    Olumi figure without a range, a person's item without their words, a condition that is both a goal and a limit, an ask
 *    for the result itself). Each is one plain sentence naming the items, so the AI can repair it in the same turn. Any error
 *    → `executable: null`. Having no goal, or an aim with no measure, is NEVER an error (phase 0b: forced goals were the only
 *    unfaithful drafts).
 *  · ASKS are legitimate, successful outcomes: a figure only the person can give. Each ask fills EXACTLY ONE quantity
 *    (an update's postimage sets it) and lists what it feeds; each goal lists its own asks, so "answer these and the chance
 *    appears" is true by construction. What the chance waits on is typed (`blockers`); the code writes no question: the AI
 *    asks in its own words (simplify v1 A4). An asked fact is NEVER removed or given a value by the compiler: finite numerical
 *    agreement cannot prove cancellation or its domain (the buddy's BLOCK, upheld by the DL). Cancellation may only ever be
 *    PROVEN from the canonical forms with its domain conditions, and only after a PL review: not built.
 *  · WITHHELD goals rest on a quantity that is `unknown` or `unsupported`, a range the ruled law holds, or a window or timing
 *    that is a range; the reason says which. Withheld items are echoed in `executable.withheld` and `coverage`.
 *  · UNVERIFIED items are the person's by their author, but their quote is not in the person's words (`sourceText`). They
 *    still calculate, and are never shown as the person's (`project.ts`).
 *
 * The joint and the limits are never computed over a partial subset (PL correction 2): `joint` and `within_limits` say
 * whether the simulator's joint figures stand for ALL measured goals and ALL measured limits; `coverage` says what the run
 * covers and leaves out ("covers productivity and budget only").
 *
 * % figures are converted to fractions here, and every range carries the ruled range law, both explicitly and as Olumi's
 * (`conversions`), so the executable model has one number per unit and the person's bounds are never their law.
 */
import {
  APPROXIMATE_FIGURE, CanonicalModel, FIGURE_STATUSES, WITHHOLDING_STATUSES, QUALITATIVE_FAMILIES,
  type CanonicalModelT, type CanonicalQuantityT, type CanonicalRelationT, type CanonicalWindowT, type CanonicalOptionSetT,
  type CanonicalGoalT, type CanonicalLimitT,
} from './canonical.js';
import type { ExecutableModel, Quantity as XQuantity, Goal as XGoal, Limit as XLimit, Option as XOption, Risk as XRisk, Dist, Domain, Withheld, FixedAuthor } from './executable.js';
import { parseUnit, multiply, divide, sameDims, isDimensionless, showUnit, perPeriod, isCalendarConversion, TIME_DIMS, DIMENSIONLESS_UNIT, type Unit } from './units.js';
import { rangeLaw, type RangeReading, type RangeDist } from './simulate/range-law.js';
import { withUsedDirections } from './links.js';

/** The law's reading of an uncertain range, or HELD when the law has no room for it (its domain leaves no probability). */
export type LawReading = Extract<RangeReading, { kind: 'normal' }> | { kind: 'held'; reason: string };

export type CompileErrorCode =
  | 'schema' | 'bad_id' | 'duplicate_id' | 'undefined_ref' | 'unit_unreadable' | 'unit_mismatch' | 'figure_status'
  | 'olumi_no_range' | 'missing_quote' | 'range_order' | 'no_relation' | 'relation_on_figure' | 'two_relations'
  | 'relation_shape' | 'cycle' | 'goal_and_limit' | 'goal_shape' | 'asks_for_result' | 'window' | 'timing' | 'option_shape'
  | 'set_derived' | 'option_reaches_no_goal' | 'set_reaches_nothing' | 'risk_shape' | 'not_applicable_used'
  | 'after_horizon' | 'fact_estimated' | 'coefficient_kind' | 'structure_value' | 'label' | 'range_kind' | 'asked_no_question';
export type CompileError = { code: CompileErrorCode; message: string; items: string[] };
export type Outcome = 'calculable' | 'asks' | 'withheld';
export type GoalOutcome = {
  goal_id: string;
  status: Outcome;
  reasons: string[];
  /** The asked quantities this goal waits on: answer exactly these (and nothing is withheld) and its chance appears. */
  asks: string[];
  /** Reserved for a cancellation PROVEN from the canonical forms (PL review first; not built): always [] now. */
  cancelled: string[];
  /** True for an aim with no measure yet: left out of the chance, with a coaching question. */
  needs_measure: boolean;
  /** True for a level with no deadline that changes over time: it needs a window, with a coaching question. */
  needs_deadline: boolean;
  /** Olumi-authored quantities, relations and effect terms (`relation_id:driver`) the goal rests on: shown as provisional. */
  olumi_inputs: string[];
  /** The person's items it rests on whose quote is not in their words. */
  unverified_inputs: string[];
  /** Assumptions and conditions that concern what the goal rests on, and the goal's own stated assumptions. */
  rests_on: string[];
  /** Left-out parts of the aim this measure does not cover: said with its chance ("productivity only"). */
  excludes: string[];
};
export type LimitOutcome = { limit_id: string; status: Outcome; reasons: string[]; asks: string[]; cancelled: string[]; needs_measure: boolean };
export type OptionOutcome = { option_id: string; status: Outcome | 'not_compared'; reasons: string[]; asks: string[] };
/**
 * ONE THING THE RESULT WAITS ON (simplify v1 A4): typed, in the model's order, never ranked and never worded by the code.
 * `id` is the record (a quantity, goal or limit; '(model)' when there is no goal); `scope` the goals, limits and live options
 * it holds up. asked: a figure only the person can give (the AI's own question may be on the record). range_kind: their
 * range, with no word on whether its ends are hard. recount: their count, given below 0. measure: an aim or guardrail with no
 * measure. deadline: an aim or guardrail that changes over time with no deadline. no_goal: no aim at all. unknown: a figure it
 * rests on that no one can give or responsibly estimate yet; never the person's to answer (its basis says why).
 */
export type BlockerCode = 'asked' | 'range_kind' | 'recount' | 'measure' | 'deadline' | 'no_goal' | 'unknown';
export type Blocker = { id: string; code: BlockerCode; scope: string[] };
export type Conversion =
  | { kind: 'percent'; quantity: string; from: string; to: string; factor: number; author: 'olumi' }
  | { kind: 'range_law'; quantity: string; low: number; high: number; range_kind: 'bounds' | 'plausible'; domain: Domain | null; reading: Extract<RangeReading, { kind: 'normal' }>; author: 'olumi'; provisional: true };
export type CompileResult = {
  executable: ExecutableModel | null;
  perGoal: GoalOutcome[];
  perLimit: LimitOutcome[];
  perOption: OptionOutcome[];
  /** Whether the simulator's `joint` stands for every measured goal. `leaves_out`: aims with no measure yet. */
  joint: { status: Outcome; goal_ids: string[]; leaves_out: string[]; asks: string[]; reasons: string[] };
  /** Whether the simulator's `within_limits` stands for every measured limit. `leaves_out`: guardrails with no measure yet. */
  within_limits: { status: Outcome; limit_ids: string[]; leaves_out: string[]; asks: string[]; reasons: string[] };
  /** What this run covers and what it leaves out, by label ("covers productivity and budget only"). */
  coverage: { covers: string[]; leaves_out: Withheld[] };
  errors: CompileError[];
  blockers: Blocker[];
  unverified: { id: string; quote: string }[];
  /** Wishes without a threshold: shown and reported, never a goal or a limit. */
  preferences: { id: string; quantity: string; direction: 'lower' | 'higher'; label: string }[];
  /** Every conversion Olumi makes on the way to the simulator, as Olumi's provisional reading (DL ruling 4). */
  conversions: Conversion[];
  /** True when the model names no option, so the executable runs one implicit "as things stand" option. */
  implicit_as_stated: boolean;
  /** Every quantity a measured goal, a measured limit or a live option rests on, whether or not it can be worked out yet:
   *  what the calculation is built from once its questions are answered (the display's "in the model"). */
  in_model: string[];
};

/**
 * THE RULED RANGE LAW is ONE shared function, S2's (`simulate/range-law.ts`, PL ruling B): the compiler, the simulator and
 * every disclosure read a range through it. The compiler adds what only it can know: the range's kind from the person's words
 * (bounds | plausible; an unclear one is asked) and its domain (a chance in [0, 1], a non-negative count), both carried on the
 * range itself. The law (S2 9d34ef05 onward) has no point fallback: an uncertain range is always a spread, conditioned on a
 * person's bounds or on its domain, and its disclosure reports the CONDITIONED moments (`mean`, `sd_conditioned`).
 */
export const rangeDistOf = (q: Pick<CanonicalQuantityT, 'low' | 'high' | 'value' | 'author' | 'range_kind'>, scale = 1, domain?: Domain): RangeDist => ({
  kind: 'range', low: q.low! * scale, high: q.high! * scale, ...(q.value !== null ? { mode: q.value * scale } : {}),
  basis: q.author === 'person' ? 'person_range' : 'olumi_estimate', range_kind: q.range_kind ?? 'plausible', ...(domain ? { domain } : {}),
});
/** The shared law's reading of an uncertain range (low < high). Where the law has no room (no probability inside the range's
 *  domain) it refuses, and the range is HELD: what rests on it is withheld with that reason, never given a figure. */
export function readRange(d: RangeDist): LawReading {
  try {
    const r = rangeLaw(d);
    if (r.kind === 'normal') return r;
    return { kind: 'held', reason: `the range ${d.low} to ${d.high} is not uncertain, so it cannot be read as a spread` }; // the law's point is only low = high
  } catch {
    return { kind: 'held', reason: `the range ${d.low} to ${d.high} has no room inside what it can be (${d.domain?.min ?? '−∞'} to ${d.domain?.max ?? '∞'})` };
  }
}

export const AS_STATED_OPTION_ID = 'as_stated';
const ID_RE = /^[a-z][a-z0-9_]*$/;
const has = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
/** The one form a quote is compared in: case, curly quotes, dashes and white space folded (compile and the card alike). */
export const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const direction = (cmp: string) => (cmp.startsWith('>') ? 'up' : 'down');
const isPowerOfTen = (v: number) => v > 0 && Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-12;

/** Schema-check unknown JSON (the AI's raw output), then compile. A schema failure is an error the AI can act on. */
export function compileJson(input: unknown, opts: CompileOptions = {}): CompileResult {
  const parsed = CanonicalModel.safeParse(input);
  if (parsed.success) return compile(parsed.data, opts);
  return {
    executable: null, perGoal: [], perLimit: [], perOption: [],
    joint: { status: 'withheld', goal_ids: [], leaves_out: [], asks: [], reasons: ['The model does not compile yet.'] },
    within_limits: { status: 'withheld', limit_ids: [], leaves_out: [], asks: [], reasons: ['The model does not compile yet.'] },
    coverage: { covers: [], leaves_out: [] },
    errors: parsed.error.issues.slice(0, 20).map((i) => ({
      code: 'schema' as const, message: `The model's shape is wrong at ${i.path.join('.') || 'its top level'}: ${i.message}.`, items: [],
    })),
    blockers: [], unverified: [], preferences: [], conversions: [], implicit_as_stated: false, in_model: [],
  };
}

type Win = { start_period: number; periods: number };
type WinState = { win: Win | null; blockers: string[]; withheld: string[]; deadline?: true };
type Measure = { quantity: string; per: string | null; cmp: string; target: string; aggregation: string; window: CanonicalWindowT | null };

/** The id an option's inline value compiles to. */
export const inlineQuantityId = (optionId: string, quantity: string) => `${optionId}__${quantity}`;

/**
 * An option's inline value ("raise the price to 3.50") becomes a named quantity of its own, with the set's author and words,
 * so every number the simulator reads is a named, authored quantity. A person's figure is known, a structural switch is
 * known (author structure), Olumi's setting on its OWN option is its proposal (known), Olumi's figure on a person's option
 * is an estimate (ranged), and no figure is an ask.
 */
export function normalise(model: CanonicalModelT): CanonicalModelT {
  const Q = new Map(model.quantities.map((q) => [q.id, q] as const));
  const extra: CanonicalQuantityT[] = [];
  const options = model.options.map((o) => ({
    ...o,
    sets: o.sets.map((s): CanonicalOptionSetT => {
      if (has(s.to)) return s;
      const id = inlineQuantityId(o.id, s.quantity);
      const target = Q.get(s.quantity);
      const fig = has(s.value) || has(s.low) || has(s.high);
      const proposal = s.author === 'olumi' && o.author === 'olumi';
      const status = !fig ? 'asked' : s.author === 'olumi' && !proposal ? 'estimated' : 'known';
      extra.push({
        id, label: `${o.label}: ${target?.label ?? s.quantity}`, unit: target?.unit ?? '1',
        kind: status === 'estimated' ? 'coefficient' : 'fact',
        value: s.value, low: s.low, high: s.high, range_kind: s.range_kind, status, question: s.question,
        basis: status === 'estimated' ? `Olumi's estimate of what "${o.label}" sets this to.` : proposal ? `Olumi's proposed setting for its option "${o.label}".` : s.author === 'structure' ? `"${o.label}" switched on.` : null,
        direction: null, stated_date: null, author: s.author, party: null, quote: s.quote, approval: o.approval, author_id: o.author_id,
      });
      return { ...s, to: id, value: null, low: null, high: null, range_kind: null, question: null };
    }),
  }));
  const named = extra.length ? { ...model, quantities: [...model.quantities, ...extra], options } : model;
  // A figure labelled structure that is no structural constant ("current output = 12", stated by no one) is the person's
  // to give: always asked of them, never Olumi's fixed figure nor read as theirs (Codex r4–r7 #3709).
  const asked = named.quantities.map((q) => (q.author === 'structure' && q.kind === 'fact' && q.status === 'known' && has(q.value) && !has(q.low) && !has(q.high)
    && !isStructuralConstant(named, q) ? structureAsked(q) : q));
  // A direction the model does not use is not kept, so the card never states a sign the model does not use (issue 40).
  return withUsedDirections(asked.some((q, i) => q !== named.quantities[i]) ? { ...named, quantities: asked } : named);
}

/**
 * THE STRUCTURAL ADMISSION, shared by the first draft (`normalise`, saved as read: `draft.ts`) and mechanism completion
 * (`answer.ts`): a figure is a structural constant only by its declared meaning, never because it looks like one:
 *  · an exact calendar conversion (12 month/year, 52 week/year);
 *  · a power of ten that IS its unit's scale (100 %, 1000 g/kg: the constant times its unit's scale is exactly 1), never 1;
 *  · 0 or 1 on a quantity an option switches (what it sets, or its switched-on figure);
 *  · 0 as an additive identity: an effect's base, a part of a sum, a stock's start ("nothing extra yet");
 *  · 1 in unit "1" only, by exact unit algebra: a part of a product, or the base of an effect or a part of a sum whose every
 *    other term is dimensionless ("current productivity, indexed" = 1, the 1 of "1 + growth"); 1 with any unit ("one
 *    customer", "current customers = 1") never is one.
 * Any other figure labelled structure ("current output = 12", "budget for the year" = 1 year) is the person's to give.
 */
export function isStructuralConstant(model: CanonicalModelT, q: CanonicalQuantityT): boolean {
  const u = parseUnit(q.unit);
  if (!has(q.value) || !u.ok) return false;
  const v = q.value;
  if (isCalendarConversion(v, u.unit)) return true;
  if (v !== 1 && isPowerOfTen(v) && Math.abs(v * u.unit.scale - 1) < 1e-9) return true;
  if ((v === 0 || v === 1) && model.options.some((o) => o.sets.some((s) => s.quantity === q.id || s.to === q.id))) return true;
  const used = (as: (r: CanonicalModelT['relations'][number]) => boolean) => model.relations.some(as);
  const base = (r: CanonicalModelT['relations'][number]) => r.form === 'effect' && r.base === q.id;
  const sumPart = (r: CanonicalModelT['relations'][number]) => r.form === 'definition' && r.op === 'sum' && r.parts.some((p) => p.id === q.id);
  if (v === 0) return used((r) => base(r) || sumPart(r) || (r.form === 'stock' && r.start === q.id));
  if (v !== 1 || !(isDimensionless(u.unit) && u.unit.scale === 1)) return false;
  // 1 in unit "1", by exact unit algebra: a product's part, or the base of an effect or a part of a sum whose every other
  // term is dimensionless too (an index or multiplier built from today's 1). Any unit on it is a count or level.
  const unitOf = (id: string): Unit | undefined => { const x = model.quantities.find((y) => y.id === id); const p = x === undefined ? undefined : parseUnit(x.unit); return p?.ok === true ? p.unit : undefined; };
  const free = (...ids: string[]) => { const us = ids.map(unitOf); return us.every((x) => x !== undefined) && isDimensionless(us.reduce((a, b) => multiply(a!, b!), DIMENSIONLESS_UNIT)!); };
  return used((r) => (r.form === 'definition' && r.op === 'product' && r.parts.some((p) => p.id === q.id))
    || (r.form === 'definition' && r.op === 'sum' && r.parts.some((p) => p.id === q.id) && r.parts.every((p) => p.id === q.id || free(p.id)))
    || (r.form === 'effect' && r.base === q.id && r.terms.every((t) => free(t.driver, t.coefficient))));
}
/** A figure only the person can give: asked, with no question of the code's (the AI asks in its own words). */
export const structureAsked = (q: CanonicalQuantityT): CanonicalQuantityT => ({ ...q, kind: 'fact', status: 'asked', author: 'person', value: null, low: null, high: null,
  range_kind: null, basis: null, quote: null, question: null });

/** A figure the person gave as approximate (the host's mark, `APPROXIMATE_FIGURE`): theirs, a point, a range asked for. */
export const isApproximate = (q: CanonicalQuantityT): boolean => q.author === 'person' && q.basis === APPROXIMATE_FIGURE && q.status === 'known' && q.value !== null && q.low === null;

/** `asksNeedQuestions` (a FIRST draft only, `draft.ts`): every figure that waits on the person carries the question that asks for
 *  it, so no goal waits on an ask no one can see. A saved model and an update are compiled as before (A4: the AI asks in its own words). */
export type CompileOptions = { readonly sourceText?: string; readonly asksNeedQuestions?: boolean };

export function compile(input: CanonicalModelT, opts: CompileOptions = {}): CompileResult {
  const model = normalise(input);
  const errors: CompileError[] = [];
  const err = (code: CompileErrorCode, message: string, items: string[]) => errors.push({ code, message, items });
  if (opts.asksNeedQuestions === true) for (const q of model.quantities) if (q.status === 'asked' && (q.question ?? '').trim() === '')
    err('asked_no_question', `"${q.label}" (${q.id}) waits on the person but has no question. If it is theirs to give, ask the one plain question that would give it. If it is not (the starting level of a setting only the options change, or a whole such as 100 %), it is a structural constant: author structure, known, one exact figure.`, [q.id]);

  // ── ids and labels ─────────────────────────────────────────────────────────────────────────────────────────────────
  const allIds = new Map<string, string>();
  const families: [string, readonly { id: string }[]][] = [
    ['quantity', model.quantities], ['relation', model.relations], ['goal', model.goals], ['limit', model.limits],
    ['preference', model.preferences], ['option', model.options], ['risk', model.risks],
    ...QUALITATIVE_FAMILIES.map((f) => [f, model[f]] as [string, { id: string }[]]),
  ];
  for (const [family, recs] of families) for (const r of recs) {
    if (!ID_RE.test(r.id)) err('bad_id', `The ${family} id "${r.id}" must be lowercase letters, digits and underscores, starting with a letter.`, [r.id]);
    if (allIds.has(r.id)) err('duplicate_id', `The id "${r.id}" is used twice (a ${allIds.get(r.id)} and a ${family}); give each record its own id.`, [r.id]);
    else allIds.set(r.id, family);
  }
  for (const r of [...model.quantities, ...model.goals, ...model.limits, ...model.risks]) if (r.label.trim() === '') err('label', `"${r.id}" has no label; give it a short name in the person's words.`, [r.id]);
  const Q = new Map(model.quantities.map((q) => [q.id, q] as const));
  const name = (id: string) => (Q.has(id) ? `"${Q.get(id)!.label}" (${id})` : `"${id}"`);
  const isQ = (ref: string, where: string, owner: string): boolean => {
    if (Q.has(ref)) return true;
    err('undefined_ref', `${where} names "${ref}", which is not a quantity in the model; add it as a quantity or use an existing id.`, [owner, ref]);
    return false;
  };
  /** What a measured goal reads: its quantity, rate denominator, target and, for a change from a stated value, that reference. */
  const goalRoots = (g: CanonicalGoalT): string[] => (g.measure
    ? [g.measure.quantity, ...(has(g.measure.per) ? [g.measure.per] : []), g.measure.target,
      ...(g.measure.reference?.kind === 'value' && has(g.measure.reference.quantity) ? [g.measure.reference.quantity] : [])]
    : []);
  const limitRoots = (l: CanonicalLimitT): string[] => (l.measure ? [l.measure.quantity, ...(has(l.measure.per) ? [l.measure.per] : []), l.measure.bound] : []);

  // ── units ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const U = new Map<string, Unit>();
  for (const q of model.quantities) {
    const p = parseUnit(q.unit);
    if (p.ok) U.set(q.id, p.unit);
    else err('unit_unreadable', `The unit "${q.unit}" of ${name(q.id)} ${p.message}.`, [q.id]);
  }
  const period: Unit = { dims: { [model.period]: 1 }, scale: 1 };
  const unitsOk = (...refs: string[]) => refs.every((r) => U.has(r));

  // ── quotes: absent on a person's item = an error; not in their words = UNVERIFIED (a typed outcome) ────────────────
  const source = has(opts.sourceText) ? norm(opts.sourceText) : null;
  const unverified: { id: string; quote: string }[] = [];
  const needQuote = (rec: { author: string; quote: string | null }, what: string, item: string) => {
    if (rec.author !== 'person') return;
    if (!has(rec.quote) || rec.quote.trim() === '') err('missing_quote', `${what} is the person's but has no quote: copy their exact words, or make it Olumi's (author olumi).`, [item]);
    else if (source !== null && !source.includes(norm(rec.quote))) unverified.push({ id: item, quote: rec.quote });
  };

  // ── which quantities hold windows and timings ──────────────────────────────────────────────────────────────────────
  const windowed = [
    ...model.goals.filter((g) => has(g.measure?.window)).map((g) => ({ id: g.id, w: g.measure!.window! })),
    ...model.limits.filter((l) => has(l.measure?.window)).map((l) => ({ id: l.id, w: l.measure!.window! })),
  ];
  const timings = [...model.options.flatMap((o) => o.sets.map((s) => s.starts_after_periods)), ...model.risks.map((k) => k.starts_after_periods)].filter((t): t is string => typeof t === 'string');
  /** Window lengths and origin timings: whole periods, consumed into the window. */
  const windowQs = new Set(windowed.flatMap(({ w }) => [w.periods, ...(has(w.origin_offset) ? [w.origin_offset] : [])]));
  /** Set and risk timings that name a quantity: a fixed one resolves to a whole period; an uncertain one goes into the run. */
  const timingQs = new Set(timings);
  /** Settings of Olumi's own options: its proposal, exact by definition. */
  const proposals = new Set(model.options.filter((o) => o.author === 'olumi').flatMap((o) => o.sets.map((s) => s.to)).filter(has));
  for (const o of model.options) if (o.author !== 'olumi') for (const s of o.sets) if (has(s.to)) proposals.delete(s.to);

  // ── relations ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const R = new Map<string, CanonicalRelationT>();
  for (const r of model.relations) {
    if (!isQ(r.defines, `The relation "${r.id}"`, r.id)) continue;
    if (R.has(r.defines)) { err('two_relations', `${name(r.defines)} is worked out by two relations ("${R.get(r.defines)!.id}" and "${r.id}"); keep one.`, [r.defines, r.id]); continue; }
    R.set(r.defines, r);
  }

  // ── quantities: status, author and kind ↔ figures ──────────────────────────────────────────────────────────────────
  for (const q of model.quantities) {
    const fig = has(q.value) || has(q.low) || has(q.high);
    const n = name(q.id);
    if (has(q.low) !== has(q.high)) err('range_order', `${n} has only one end of its range; give both low and high, or neither.`, [q.id]);
    if (has(q.low) && has(q.high) && q.low > q.high) err('range_order', `${n} has low ${q.low} above high ${q.high}.`, [q.id]);
    if (has(q.value) && has(q.low) && has(q.high) && (q.value < q.low || q.value > q.high)) err('range_order', `${n} has its figure ${q.value} outside its range ${q.low}–${q.high}.`, [q.id]);
    else if (has(q.value) && has(q.low) && has(q.high) && q.low < q.high && (q.value === q.low || q.value === q.high)) {
      err('range_order', `${n} has its most likely figure ${q.value} at an end of its range ${q.low}–${q.high}; give a most likely figure strictly inside the range, or none (null).`, [q.id]);
    }
    const ranged = has(q.low) && has(q.high) && q.low < q.high;
    if (ranged && q.author === 'olumi' && !has(q.range_kind)) err('range_kind', `${n} is Olumi's range without its kind; say plausible (a rough span) or bounds (hard ends).`, [q.id]);
    if (!ranged && has(q.range_kind)) err('range_kind', `${n} has a range kind but no range; set range_kind null.`, [q.id]);
    // Kind and status agree: derived status ⇔ kind derived, except a link's size, which stays a coefficient when derived.
    if (q.status === 'derived' && q.kind === 'fact') err('figure_status', `${n} is worked out by its relation, so its kind is derived (or coefficient, when it is the size of a link), not fact.`, [q.id]);
    if (q.kind === 'derived' && q.status !== 'derived') err('figure_status', `${n} has kind derived but status ${q.status}; a derived quantity is worked out by exactly one relation (status derived), otherwise it is a fact or a coefficient.`, [q.id]);
    if (q.status === 'derived') {
      if (!R.has(q.id)) err('no_relation', `${n} is marked derived but no relation works it out; add its definition, effect or stock, or give its figure.`, [q.id]);
      if (fig) err('figure_status', `${n} is derived, so its figures must be null (its relation works them out).`, [q.id]);
      continue;
    }
    if (R.has(q.id)) { err('relation_on_figure', `${n} has a relation ("${R.get(q.id)!.id}") but is marked ${q.status}; mark it derived with null figures, or remove the relation.`, [q.id, R.get(q.id)!.id]); continue; }
    if (q.author === 'structure') {
      // Its meaning is checked in `normalise` (`isStructuralConstant`): one that is no structural constant is already asked.
      if (q.status !== 'known' || !has(q.value) || has(q.low)) err('structure_value', `${n} is a structural constant, so it is known with one exact figure and no range.`, [q.id]);
      if (q.kind !== 'fact') err('structure_value', `${n} is a structural constant, so its kind is fact (a coefficient is a mechanism's size, never structural: the person's figure or Olumi's ranged estimate).`, [q.id]);
      continue;
    }
    if (q.status === 'known') {
      if (!fig) err('figure_status', `${n} is marked known but has no figure; give the person's figure, or mark it asked with a question.`, [q.id]);
      else if (q.author === 'olumi') {
        const point = has(q.value) && !has(q.low);
        const dateReading = point && (windowQs.has(q.id) || timingQs.has(q.id)) && Number.isInteger(q.value) && has(q.basis);
        const proposal = point && proposals.has(q.id);
        if (!dateReading && !proposal) err('olumi_no_range', `${n} is Olumi's figure marked known; Olumi's figures are estimates: mark it estimated with low and high, or, for an exact constant such as 12 month/year, an option switch or the starting level of a setting only the options change, make its author structure.`, [q.id]);
      }
      needQuote(q, n, q.id);
    } else if (q.status === 'estimated') {
      if (q.kind === 'fact') err('fact_estimated', `${n} is a fact about the person's own situation, so only they can give it: mark it asked with one question. Olumi estimates only coefficients (the size of a mechanism).`, [q.id]);
      if (q.author !== 'olumi') err('figure_status', `${n} is the person's figure marked estimated; mark it known with their quote (their own range in low and high).`, [q.id]);
      else if (!has(q.low) || !has(q.high)) err('olumi_no_range', `${n} is Olumi's estimate without both low and high; give a range as wide as what is genuinely unknown.`, [q.id]);
      if (!has(q.basis)) err('figure_status', `${n} is Olumi's estimate with no basis; say in one sentence what it rests on.`, [q.id]);
    } else {
      if (fig) err('figure_status', `${n} is marked ${q.status} but has a figure; a figure in hand is known (the person's) or estimated (Olumi's).`, [q.id]);
      // An asked figure needs no question of the AI's: what waits on it is typed, and the AI asks in its own words (A4).
      if (q.status !== 'asked' && !has(q.basis)) err('figure_status', `${n} is ${q.status} with no basis; say why in one sentence.`, [q.id]);
    }
  }

  // ── relations: references, forms, units, quotes ────────────────────────────────────────────────────────────────────
  const instant = new Map<string, string[]>();   // same-period dependencies
  const lagged = new Map<string, string[]>();    // stock flows: through the stock, so never a cycle
  for (const r of R.values()) {
    const at = `The relation "${r.id}" for ${name(r.defines)}`;
    needQuote(r, at, r.id);
    const d = U.get(r.defines);
    if (r.form === 'definition') {
      const parts = r.parts.map((p) => p.id);
      if (!parts.every((p) => isQ(p, at, r.id))) continue;
      instant.set(r.defines, parts);
      if (r.op === 'sum') {
        if (!r.parts.some((p) => p.sign === 1)) { err('relation_shape', `${at} is a sum with no part added; at least one part has sign 1.`, [r.id]); continue; }
        if (!d || !unitsOk(...parts)) continue;
        for (const p of parts) if (!sameDims(U.get(p)!, d)) {
          err('unit_mismatch', `${at} is a sum, but part ${name(p)} is ${showUnit(U.get(p)!)} while ${name(r.defines)} is ${showUnit(d)}; the parts of a sum share one unit.`, [r.id, p, r.defines]);
        }
      } else {
        if (!r.parts.some((p) => p.power === 1)) { err('relation_shape', `${at} is a product with no part multiplied; at least one part has power 1.`, [r.id]); continue; }
        if (!d || !unitsOk(...parts)) continue;
        const got = r.parts.reduce((acc, p) => (p.power === 1 ? multiply(acc, U.get(p.id)!) : divide(acc, U.get(p.id)!)), { dims: {}, scale: 1 } as Unit);
        if (!sameDims(got, d)) err('unit_mismatch', `${at} is a product whose parts make ${showUnit(got)}, but ${name(r.defines)} is ${showUnit(d)}.`, [r.id, r.defines, ...parts]);
      }
    } else if (r.form === 'effect') {
      const refs = [r.base, ...r.terms.flatMap((t) => [t.coefficient, t.driver])];
      if (!refs.every((x) => isQ(x, at, r.id))) continue;
      instant.set(r.defines, refs);
      for (const t of r.terms) needQuote(t, `The link from ${name(t.driver)} in "${r.id}"`, `${r.id}:${t.driver}`);
      for (const t of r.terms) {
        const c = Q.get(t.coefficient)!;
        if (c.kind !== 'coefficient' || c.author === 'structure') err('coefficient_kind', `${name(t.coefficient)} is the size of the link from ${name(t.driver)} in "${r.id}", so it is a coefficient of uncertain size (kind coefficient, never structure). If the relation is exact, write it as a definition (a signed sum or a product), not an effect.`, [t.coefficient, r.id]);
      }
      if (!d || !unitsOk(...refs)) continue;
      if (!sameDims(U.get(r.base)!, d)) err('unit_mismatch', `${at}: its base ${name(r.base)} is ${showUnit(U.get(r.base)!)} but ${name(r.defines)} is ${showUnit(d)}.`, [r.id, r.base, r.defines]);
      for (const t of r.terms) {
        const got = multiply(U.get(t.coefficient)!, U.get(t.driver)!);
        if (!sameDims(got, d)) err('unit_mismatch', `${at}: coefficient ${name(t.coefficient)} (${showUnit(U.get(t.coefficient)!)}) × driver ${name(t.driver)} (${showUnit(U.get(t.driver)!)}) is ${showUnit(got)}, but ${name(r.defines)} is ${showUnit(d)}; the coefficient's unit is the defined unit per the driver's unit.`, [r.id, t.coefficient, t.driver]);
      }
    } else {
      const flows = [...r.inflows, ...r.outflows];
      if (!isQ(r.start, at, r.id) || !flows.every((x) => isQ(x, at, r.id))) continue;
      instant.set(r.defines, [r.start]);
      lagged.set(r.defines, flows);
      if (!d || !unitsOk(r.start, ...flows)) continue;
      if (!sameDims(U.get(r.start)!, d)) err('unit_mismatch', `${at}: its start ${name(r.start)} is ${showUnit(U.get(r.start)!)} but the stock is ${showUnit(d)}.`, [r.id, r.start]);
      const want = perPeriod(d, model.period);
      for (const f of flows) if (!sameDims(U.get(f)!, want)) {
        err('unit_mismatch', `${at}: flow ${name(f)} is ${showUnit(U.get(f)!)} but a flow of this stock is ${showUnit(want)} (the stock's unit per ${model.period}; a stock × a rate per ${model.period} is one); convert it with a structural quantity such as 12 month/year.`, [r.id, f]);
      }
    }
  }

  // ── cycles: only through a stock ───────────────────────────────────────────────────────────────────────────────────
  const state = new Map<string, 1 | 2>();
  const reported = new Set<string>();
  const visit = (q: string, path: string[]) => {
    if (state.get(q) === 2) return;
    if (state.get(q) === 1) {
      const loop = [...path.slice(path.indexOf(q)), q];
      const key = [...new Set(loop)].sort().join(',');
      if (!reported.has(key)) {
        reported.add(key);
        err('cycle', `${loop.map(name).join(' → ')} goes round in a circle within one period; break it, or carry it through a stock (a level that changes period by period).`, [...new Set(loop)]);
      }
      return;
    }
    state.set(q, 1);
    for (const dep of instant.get(q) ?? []) visit(dep, [...path, q]);
    state.set(q, 2);
  };
  for (const q of instant.keys()) visit(q, []);

  // ── upstream closures (for reach and for what withholds what) ──────────────────────────────────────────────────────
  const risksOn = new Map<string, string[]>();
  for (const k of model.risks) if (Q.has(k.effect_on)) risksOn.set(k.effect_on, [...(risksOn.get(k.effect_on) ?? []), k.id]);
  const riskById = new Map(model.risks.map((k) => [k.id, k] as const));
  const riskInputs = (k: CanonicalModelT['risks'][number]) => [k.occurrence, k.severity, ...(typeof k.starts_after_periods === 'string' ? [k.starts_after_periods] : [])].filter((x) => Q.has(x));
  const upstream = (roots: readonly string[]): Set<string> => {
    const seen = new Set<string>();
    const stack = roots.filter((r) => Q.has(r));
    while (stack.length) {
      const q = stack.pop()!;
      if (seen.has(q)) continue;
      seen.add(q);
      stack.push(...(instant.get(q) ?? []), ...(lagged.get(q) ?? []));
      for (const rid of risksOn.get(q) ?? []) stack.push(...riskInputs(riskById.get(rid)!));
    }
    return seen;
  };

  // ── timing: a whole period, or a quantity holding one ──────────────────────────────────────────────────────────────
  const fixedTimings = new Set<string>();
  /** A whole period; or, for an uncertain timing, the quantity's id (S2 samples it; its whole-period reading is the PL's). */
  const timingOf = (t: number | string, at: string, item: string): number | string | null => {
    if (typeof t === 'number') { if (t < 0) err('timing', `${at} starts after ${t} periods; the count starts at 0 (from the start).`, [item]); return t; }
    if (!isQ(t, `${at}'s timing`, item)) return null;
    const q = Q.get(t)!;
    if (U.has(t) && !sameDims(U.get(t)!, period)) { err('timing', `${at}'s timing ${name(t)} is ${showUnit(U.get(t)!)}; it counts ${model.period}s from now.`, [item, t]); return null; }
    if (!FIGURE_STATUSES.has(q.status)) return null; // asked, unknown or unsupported: an ask or a withholding, through its closure
    if (has(q.low) && has(q.high) && q.low !== q.high) {
      if (q.low < 0) err('timing', `${at}'s timing ${name(t)} starts at ${q.low}; a timing counts ${model.period}s from now, 0 or more.`, [item, t]);
      return t; // uncertain: a range read through the shared law, like any other (an unclear kind is asked, a held one withholds)
    }
    const v = q.value ?? q.low!;
    if (!Number.isInteger(v) || v < 0) { err('timing', `${at}'s timing ${name(t)} is ${v}; it must be a whole number of ${model.period}s from now, 0 or more.`, [item, t]); return null; }
    fixedTimings.add(t);
    return v;
  };

  // ── goals and limits: what the person is trying to achieve vs a condition the plan must not break ──────────────────
  const GOAL_VS_LIMIT = 'A goal is what the person is trying to achieve; a limit is a condition the plan must not break (a budget, a time cap); a preference has no threshold.';
  const figureOf = (id: string) => { const q = Q.get(id); return q && has(q.value) && !has(q.low) ? q.value : null; };
  for (const g of model.goals) for (const l of model.limits) {
    const m = g.measure;
    const lm = l.measure;
    if (!m || !lm || m.quantity !== lm.quantity || direction(m.cmp) !== direction(lm.cmp)) continue;
    const sameBound = m.target === lm.bound || (figureOf(m.target) !== null && figureOf(m.target) === figureOf(lm.bound));
    if (sameBound) err('goal_and_limit', `${name(m.quantity)} ${m.cmp} its figure appears as both a goal ("${g.label}") and a limit ("${l.label}"). ${GOAL_VS_LIMIT} Keep it as the one the person describes and remove the other.`, [g.id, l.id]);
  }
  const resolveWindow = (w: CanonicalWindowT, at: string, item: string): WinState => {
    const st: WinState = { win: null, blockers: [], withheld: [] };
    if (w.start < 0) { err('window', `${at} opens ${w.start} periods after its origin; it must be 0 or later.`, [item]); return st; }
    if (has(w.origin_event) && !has(w.origin_offset)) { err('window', `${at} counts from "${w.origin_event}" but names no quantity for when it happens; add one in ${model.period}s (asked if not stated).`, [item]); return st; }
    const slot = (ref: string, what: string, min: number): number | null => {
      if (!isQ(ref, `${at}'s ${what}`, item)) return null;
      const q = Q.get(ref)!;
      if (U.has(ref) && !sameDims(U.get(ref)!, period)) { err('window', `${at}'s ${what} ${name(ref)} is ${showUnit(U.get(ref)!)}; it counts ${model.period}s.`, [item, ref]); return null; }
      if (q.status === 'derived') { err('window', `${at}'s ${what} ${name(ref)} is derived; a window needs a figure.`, [item, ref]); return null; }
      if (q.status === 'asked') { st.blockers.push(ref); return null; }
      if (!FIGURE_STATUSES.has(q.status)) { st.withheld.push(`${at}'s ${what} "${q.label}" is ${q.status.replace('_', ' ')}: ${q.basis}`); return null; }
      if (has(q.low) && has(q.high) && q.low !== q.high) { st.withheld.push(`${at}'s ${what} "${q.label}" is a range (${q.low}–${q.high} ${q.unit}); the calculation needs one whole number of ${model.period}s.`); return null; }
      const v = q.value ?? q.low!;
      if (!Number.isInteger(v) || v < min) { err('window', `${at}'s ${what} ${name(ref)} is ${v}; it must be a whole number of ${model.period}s, at least ${min} (a finer period, such as week, can hold a part ${model.period}).`, [item, ref]); return null; }
      return v;
    };
    const offset = has(w.origin_offset) ? slot(w.origin_offset, 'origin timing', 0) : 0;
    const periods = slot(w.periods, 'length', 1);
    if (offset !== null && periods !== null && !st.blockers.length && !st.withheld.length) st.win = { start_period: offset + w.start, periods };
    return st;
  };
  const targetUnitOk = (m: Measure, against: string) => {
    const qu = U.get(m.quantity)!;
    const tu = U.get(against)!;
    if (has(m.per)) return U.has(m.per) && sameDims(tu, divide(qu, U.get(m.per)!));
    return m.aggregation === 'sum' ? sameDims(tu, multiply(qu, period)) || (sameDims(tu, qu) && !Object.keys(qu.dims).some((k) => TIME_DIMS.has(k))) : sameDims(tu, qu);
  };
  /** Shared checks for a goal's or a limit's measure; returns its window state. */
  const measureChecks = (m: Measure, against: string, at: string, item: string, roots: readonly string[], frameWithheld: string[], relative = false): WinState | null => {
    if (!roots.every((x) => isQ(x, at, item))) return null;
    if (Q.get(m.quantity)!.status === 'asked') err('asks_for_result', `${at} measures ${name(m.quantity)}, which is asked: that asks the person for the result itself. Model what drives it (its definition, effect or stock), or leave the aim with measure null and a question.`, [item, m.quantity]);
    if (has(m.per) && m.aggregation === 'every') err('goal_shape', `${at} is a rate over the window (per ${name(m.per)}), which needs end, sum, mean, max or min, not every.`, [item]);
    if (unitsOk(m.quantity, against) && (!has(m.per) || U.has(m.per)) && !relative && !targetUnitOk(m, against)) {
      err('unit_mismatch', `${at} compares ${name(m.quantity)}${has(m.per) ? ` per ${name(m.per)}` : ''} (${showUnit(has(m.per) && U.has(m.per) ? divide(U.get(m.quantity)!, U.get(m.per)!) : U.get(m.quantity)!)}) with ${name(against)} (${showUnit(U.get(against)!)}); for "${m.aggregation}" the figure is in ${m.aggregation === 'sum' && !has(m.per) ? `the quantity's unit × ${model.period}` : "the quantity's unit"}.`, [item, m.quantity, against]);
    }
    if (has(m.window)) { const st = resolveWindow(m.window, at, item); st.withheld.push(...frameWithheld); return st; }
    // A static level with no deadline is read once, at period 0, with every option's change in effect. A level that
    // changes over time (it rests on a stock) has no single reading without a deadline: a typed blocker, never a guess.
    const moves = [...upstream(roots)].some((x) => R.get(x)?.form === 'stock');
    return moves ? { win: null, blockers: [], withheld: frameWithheld, deadline: true } : { win: { start_period: 0, periods: 1 }, blockers: [], withheld: frameWithheld };
  };

  const goalWin = new Map<string, WinState>();
  for (const g of model.goals) {
    const at = `The goal "${g.label}" (${g.id})`;
    needQuote(g, at, g.id);
    if (!has(g.measure)) continue; // an aim with no measure yet is VALID: coached, left out of the chance, never forced
    const m = g.measure;
    const frameWithheld: string[] = [];
    if (m.frame === 'change_rel') {
      if (U.has(m.target) && !isDimensionless(U.get(m.target)!)) err('unit_mismatch', `${at} is a relative change, so its target ${name(m.target)} is a fraction ("1") or a percentage ("%"), not ${showUnit(U.get(m.target)!)}.`, [g.id, m.target]);
    }
    const ref = m.reference;
    if (m.frame === 'level' && has(ref)) err('goal_shape', `${at} is a level but names a reference; make it a change (change_abs or change_rel), or set its reference to null.`, [g.id]);
    if (m.frame !== 'level' && !has(ref)) err('goal_shape', `${at} is a change but names no reference; say what it is a change from (now, an option such as carrying on as now, or a stated value).`, [g.id]);
    if (m.frame !== 'level' && has(m.per)) frameWithheld.push(`${at} is a change in a rate over the window, which is not supported yet.`);
    if (m.frame !== 'level' && has(ref)) {
      if (ref.kind === 'value') {
        if (!has(ref.quantity)) err('goal_shape', `${at} is a change from a stated value but names no quantity for it.`, [g.id]);
        else if (isQ(ref.quantity, `${at}'s reference`, g.id) && unitsOk(ref.quantity, m.quantity) && !sameDims(U.get(ref.quantity)!, U.get(m.quantity)!)) {
          err('unit_mismatch', `${at} is a change from ${name(ref.quantity)} (${showUnit(U.get(ref.quantity)!)}), which must be in the unit of ${name(m.quantity)} (${showUnit(U.get(m.quantity)!)}).`, [g.id, ref.quantity]);
        }
      } else if (ref.kind === 'option') {
        const o = model.options.find((x) => x.id === ref.option);
        if (!o) err('undefined_ref', `${at} is a change from the option "${ref.option ?? ''}", which is not an option in the model.`, [g.id]);
        else if (o.sets.length) frameWithheld.push(`${at} is a change from "${o.label}", which changes things itself; comparing on the same draws is supported only against an option that changes nothing (carrying on as now).`);
        else if (Q.has(m.quantity) && model.risks.some((k) => upstream([m.quantity]).has(k.effect_on))) frameWithheld.push(`${at} is a change from "${o.label}", and a risk affects it; comparing with another option on the same draws under a risk is not supported yet.`);
      }
    }
    for (const a of m.assumptions) if (!model.assumptions.some((x) => x.id === a)) err('undefined_ref', `${at} rests on the assumption "${a}", which is not an assumption record.`, [g.id, a]);
    for (const x of m.exclusions) if (!model.left_out.some((y) => y.id === x)) err('undefined_ref', `${at} leaves out "${x}", which is not a left_out record.`, [g.id, x]);
    const st = measureChecks(m, m.target, at, g.id, goalRoots(g), frameWithheld, m.frame === 'change_rel');
    if (st) goalWin.set(g.id, st);
  }
  const limitWin = new Map<string, WinState>();
  for (const l of model.limits) {
    const at = `The limit "${l.label}" (${l.id})`;
    needQuote(l, at, l.id);
    if (!has(l.measure)) continue; // a guardrail with no measure yet is VALID: reported as not covered, never given a scale
    const st = measureChecks({ ...l.measure, target: l.measure.bound }, l.measure.bound, at, l.id, limitRoots(l), []);
    if (st) limitWin.set(l.id, st);
  }
  const wins = [...goalWin.values(), ...limitWin.values()].map((s) => s.win).filter(has);
  const horizon = wins.length ? Math.max(...wins.map((w) => w.start_period + w.periods)) : 0;

  // ── options ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const measured = model.goals.filter((g) => has(g.measure) && goalRoots(g).every((x) => Q.has(x)));
  const measuredLimits = model.limits.filter((l) => has(l.measure) && limitRoots(l).every((x) => Q.has(x)));
  const goalReach = upstream(measured.flatMap(goalRoots));
  const limitReach = upstream(measuredLimits.flatMap(limitRoots));
  // Never pressure invention: with no goal, or an aim with no measure yet (an option may act on it), no reach errors fire.
  const reachable = model.goals.length > 0 && model.goals.every((g) => has(g.measure)) && measured.length + measuredLimits.length > 0;
  const optionIds = new Set(model.options.map((o) => o.id));
  const labels = new Map<string, string>();
  const setTiming = new Map<string, (number | string | null)[]>();
  for (const o of model.options) {
    const at = `The option "${o.label}" (${o.id})`;
    needQuote(o, at, o.id);
    if (o.label.trim() === '') err('option_shape', `The option ${o.id} has no name; use the person's exact name for it.`, [o.id]);
    const key = norm(o.label);
    if (labels.has(key)) err('option_shape', `${at} has the same name as "${labels.get(key)}"; each option needs its own name.`, [o.id, labels.get(key)!]);
    labels.set(key, o.id);
    if (has(o.developed_from) && !optionIds.has(o.developed_from)) err('undefined_ref', `${at} is developed from "${o.developed_from}", which is not an option.`, [o.id]);
    let reaches = false;
    const times: (number | string | null)[] = [];
    o.sets.forEach((s, i) => {
      const from = timingOf(s.starts_after_periods, `${at}'s setting of ${name(s.quantity)}`, o.id);
      times.push(from);
      const to = s.to ?? '';
      if (!isQ(s.quantity, at, o.id) || !isQ(to, at, o.id)) return;
      if (Q.get(s.quantity)!.status === 'derived') err('set_derived', `${at} sets ${name(s.quantity)}, which is worked out by its relation; set one of its inputs instead.`, [o.id, s.quantity]);
      if (unitsOk(s.quantity, to) && !sameDims(U.get(s.quantity)!, U.get(to)!)) err('unit_mismatch', `${at} sets ${name(s.quantity)} (${showUnit(U.get(s.quantity)!)}) to ${name(to)} (${showUnit(U.get(to)!)}); they need one unit.`, [o.id, s.quantity, to]);
      if (o.sets.slice(0, i).some((x) => x.quantity === s.quantity && x.starts_after_periods === s.starts_after_periods)) err('option_shape', `${at} sets ${name(s.quantity)} twice from the same period; keep one.`, [o.id, s.quantity]);
      if (horizon > 0 && typeof from === 'number' && from >= horizon) err('after_horizon', `${at} sets ${name(s.quantity)} after ${from} ${model.period}s, beyond the model's ${horizon}.`, [o.id]);
      if (goalReach.has(s.quantity) || limitReach.has(s.quantity)) reaches = true;
      else if (reachable) err('set_reaches_nothing', `${at} sets ${name(s.quantity)}, which reaches no goal or limit; link it to what it changes, or drop the setting.`, [o.id, s.quantity]);
    });
    setTiming.set(o.id, times);
    if (reachable && o.sets.length && !reaches && o.status === 'live') {
      err('option_reaches_no_goal', `${at} changes nothing a goal or limit depends on; link what it changes to a goal's or a limit's quantity.`, [o.id]);
    }
  }

  // ── risks ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const riskTiming = new Map<string, number | string | null>();
  for (const k of model.risks) {
    const at = `The risk "${k.label}" (${k.id})`;
    needQuote(k, at, k.id);
    const from = timingOf(k.starts_after_periods, at, k.id);
    riskTiming.set(k.id, from);
    if (!isQ(k.occurrence, at, k.id) || !isQ(k.severity, at, k.id) || !isQ(k.effect_on, at, k.id)) continue;
    if (horizon > 0 && typeof from === 'number' && from >= horizon) err('after_horizon', `${at} takes effect after ${from} ${model.period}s, beyond the model's ${horizon}.`, [k.id]);
    const ou = U.get(k.occurrence);
    if (ou && !isDimensionless(ou)) err('risk_shape', `${at}: its chance ${name(k.occurrence)} is ${showUnit(ou)}; a chance is a pure number ("1", or "%").`, [k.id, k.occurrence]);
    const occ = Q.get(k.occurrence)!;
    if (ou && isDimensionless(ou)) for (const v of [occ.value, occ.low, occ.high]) if (has(v) && (v * ou.scale < 0 || v * ou.scale > 1)) {
      err('risk_shape', `${at}: its chance ${name(k.occurrence)} has ${v}${ou.scale === 1 ? '' : ' %'}, outside 0 to ${ou.scale === 1 ? '1' : '100 %'}.`, [k.id, k.occurrence]);
      break;
    }
    if (unitsOk(k.severity, k.effect_on)) {
      const want = k.mode === 'add' ? U.get(k.effect_on)! : { dims: {}, scale: 1 };
      if (!sameDims(U.get(k.severity)!, want)) err('unit_mismatch', `${at}: its severity ${name(k.severity)} is ${showUnit(U.get(k.severity)!)}; to ${k.mode === 'add' ? 'add to' : 'multiply'} ${name(k.effect_on)} it must be ${showUnit(want)}.`, [k.id, k.severity, k.effect_on]);
    }
  }

  // ── preferences, qualitative records: references and authorship ───────────────────────────────────────────────────
  for (const p of model.preferences) { needQuote(p, `The preference "${p.id}"`, p.id); isQ(p.quantity, `The preference "${p.id}"`, p.id); }
  for (const f of QUALITATIVE_FAMILIES) for (const rec of model[f]) {
    needQuote(rec, `The ${f.replace('_', ' ')} record "${rec.id}"`, rec.id);
    for (const c of rec.concerns) if (!allIds.has(c)) err('undefined_ref', `The ${f.replace('_', ' ')} record "${rec.id}" concerns "${c}", which is not in the model.`, [rec.id, c]);
  }

  // ── not applicable means unused ────────────────────────────────────────────────────────────────────────────────────
  const used = new Map<string, string>();
  for (const r of R.values()) for (const x of [...(instant.get(r.defines) ?? []), ...(lagged.get(r.defines) ?? [])]) used.set(x, r.id);
  for (const g of measured) for (const x of goalRoots(g)) used.set(x, g.id);
  for (const l of measuredLimits) for (const x of limitRoots(l)) used.set(x, l.id);
  for (const { id, w } of windowed) for (const x of [w.periods, w.origin_offset]) if (has(x)) used.set(x, id);
  for (const o of model.options) for (const s of o.sets) { used.set(s.quantity, o.id); if (has(s.to)) used.set(s.to, o.id); }
  for (const k of model.risks) for (const x of [k.occurrence, k.severity, k.effect_on]) used.set(x, k.id);
  for (const q of model.quantities) if (q.status === 'not_applicable' && used.has(q.id)) {
    err('not_applicable_used', `${name(q.id)} is marked not applicable but "${used.get(q.id)}" uses it; remove it from there, or give it a status that has a figure.`, [q.id, used.get(q.id)!]);
  }

  /** Window lengths, origin timings and set/risk timings that nothing else reads: consumed into the windows and timings. */
  const consumedOnly = new Set([...windowQs, ...fixedTimings].filter((id) => ![...R.values()].some((r) => [...(instant.get(r.defines) ?? []), ...(lagged.get(r.defines) ?? []), r.defines].includes(id))
    && ![...measured.flatMap(goalRoots), ...measuredLimits.flatMap(limitRoots)].includes(id)
    && !model.options.some((o) => o.sets.some((x) => x.quantity === id || x.to === id))
    && !model.risks.some((k) => [k.occurrence, k.severity, k.effect_on].includes(id))));

  // ── the ruled range law, for every range (a held range withholds what rests on it) ─────────────────────────────────
  const chances = new Set(model.risks.map((k) => k.occurrence));
  /** A count of things (one plain unit, not time or money): never negative. */
  const isCount = (q: CanonicalQuantityT): boolean => {
    const d = U.get(q.id) ? Object.entries(U.get(q.id)!.dims) : [];
    return !chances.has(q.id) && d.length === 1 && d[0][1] === 1 && !TIME_DIMS.has(d[0][0]) && !['gbp', 'usd', 'eur'].includes(d[0][0]);
  };
  /**
   * Truncation only for a mathematical domain: a chance lies in [0, 1]; a count of things is never negative; an elapsed
   * time (a set's or risk's timing) is 0 or more (the PL's ruling, 23 Oct). Each is Olumi's conversion, disclosed.
   */
  const domainOf = (q: CanonicalQuantityT): Domain | undefined => (chances.has(q.id) ? { min: 0, max: 1 } : timingQs.has(q.id) || isCount(q) ? { min: 0 } : undefined);
  /**
   * A count whose WHOLE range lies below 0 contradicts what it can be (the PL's ruling, 23 Oct): never pinned near 0, never
   * made positive. Its words and range stay as given; the person's is asked again, Olumi's is held as unsupported.
   */
  const contradictory = new Map(model.quantities.filter((q) => FIGURE_STATUSES.has(q.status) && isCount(q) && has(q.low) && has(q.high) && q.high < 0)
    .map((q) => [q.id, `"${q.label}" is given as ${q.low}–${q.high} ${q.unit}, but a count cannot be below 0`] as const));
  /** A person's range whose words do not say whether its ends are hard: an UNRESOLVED reading, a blocker (PL ruling B). */
  const unresolved = new Set(model.quantities.filter((q) => FIGURE_STATUSES.has(q.status) && q.author === 'person' && has(q.low) && has(q.high) && q.low < q.high && !has(q.range_kind) && !windowQs.has(q.id) && !contradictory.has(q.id))
    .map((q) => q.id));
  const readings = new Map<string, LawReading>();
  for (const q of model.quantities) if (FIGURE_STATUSES.has(q.status) && has(q.low) && has(q.high) && q.low < q.high && U.has(q.id) && !windowQs.has(q.id)
    && !contradictory.has(q.id) && (!has(q.value) || (q.low < q.value && q.value < q.high))) {
    readings.set(q.id, readRange(rangeDistOf(q, U.get(q.id)!.scale, domainOf(q))));
  }
  const held = new Map([...[...readings].filter(([, r]) => r.kind === 'held').map(([id, r]) => [id, (r as { reason: string }).reason] as const),
    ...[...contradictory].filter(([id]) => Q.get(id)!.author !== 'person').map(([id, why]) => [id, `${why}; Olumi's range is unsupported`] as const)]);
  /** The person's contradictory counts: theirs to give again, with the reason. */
  const recheck = new Map([...contradictory].filter(([id]) => Q.get(id)!.author === 'person'));

  // ── typed outcomes: what each goal, limit and option rests on ──────────────────────────────────────────────────────
  const unverifiedIds = new Set(unverified.map((u) => u.id));
  const withholds = (q: CanonicalQuantityT) => WITHHOLDING_STATUSES.has(q.status) || held.has(q.id);
  const isAsk = (q: CanonicalQuantityT) => q.status === 'asked' || unresolved.has(q.id) || recheck.has(q.id);
  const blockersOf = (closure: Iterable<string>) => [...closure].map((x) => Q.get(x)).filter((q): q is CanonicalQuantityT => !!q && (isAsk(q) || withholds(q)));
  const describe = (q: CanonicalQuantityT) => (q.status === 'asked' ? `needs "${q.label}".` : held.has(q.id) ? `rests on "${q.label}": ${held.get(q.id)}; give a most likely figure, or ask`
    : unresolved.has(q.id) ? `needs how to read "${q.label}" (firm ends, or a rough estimate).` : recheck.has(q.id) ? `needs "${q.label}" again: ${recheck.get(q.id)}.`
      : `rests on "${q.label}", which is ${q.status.replace('_', ' ')}: ${q.basis}`);
  const outcomeOf = (closure: Set<string>, win?: WinState): { status: Outcome; reasons: string[]; asks: string[] } => {
    const blockers = blockersOf([...closure, ...(win?.blockers ?? [])]);
    const withheld = [...(win?.withheld ?? []), ...blockers.filter(withholds).map(describe)];
    const asked = [...new Map(blockers.filter((q) => isAsk(q) && !withholds(q)).map((q) => [q.id, q] as const)).values()];
    const reasons = [...withheld, ...asked.map(describe), ...(win?.deadline ? ['It changes over time, so it needs a deadline.'] : [])];
    return { status: withheld.length ? 'withheld' : asked.length || win?.deadline ? 'asks' : 'calculable', reasons, asks: asked.map((q) => q.id) };
  };
  const relationsIn = (closure: Set<string>) => [...closure].filter((q) => R.has(q)).map((q) => R.get(q)!);
  const olumiInputs = (closure: Set<string>) => [
    ...[...closure].filter((x) => Q.get(x)!.author === 'olumi' && FIGURE_STATUSES.has(Q.get(x)!.status)),
    ...relationsIn(closure).flatMap((r) => [
      ...(r.author === 'olumi' ? [r.id] : []),
      ...(r.form === 'effect' ? r.terms.filter((t) => t.author === 'olumi').map((t) => `${r.id}:${t.driver}`) : []),
    ]),
  ];
  const touchedBy = (closure: Set<string>, own: string) => new Set([...closure, own, ...relationsIn(closure).flatMap((r) => [r.id, ...(r.form === 'effect' ? r.terms.map((t) => `${r.id}:${t.driver}`) : [])])]);
  const restsOn = (touched: Set<string>, own: string[] = []) => [...new Set([...own, ...[...model.assumptions, ...model.conditions].filter((a) => a.concerns.some((c) => touched.has(c))).map((a) => a.id)])];

  /** A window's own figures that are unknown (no figure, no question): what the goal or limit rests on, so it is listed (#3723). */
  const unknownWindowRefs = (w: CanonicalWindowT | null | undefined) => [w?.periods, w?.origin_offset].filter((x): x is string => has(x) && Q.get(x)?.status === 'unknown');
  const goalClosure = new Map<string, Set<string>>();
  const perGoal: GoalOutcome[] = model.goals.map((g) => {
    if (!has(g.measure)) {
      return { goal_id: g.id, status: 'asks', reasons: [`"${g.label}" has no measure yet, so it is left out of the chance.`], asks: [], cancelled: [], needs_measure: true, needs_deadline: false, olumi_inputs: [], unverified_inputs: unverifiedIds.has(g.id) ? [g.id] : [], rests_on: restsOn(new Set([g.id])), excludes: [] };
    }
    const closure = upstream(goalRoots(g));
    const w = goalWin.get(g.id);
    goalClosure.set(g.id, new Set([...closure, ...(w?.blockers ?? []), ...unknownWindowRefs(g.measure.window)]));
    const touched = touchedBy(closure, g.id);
    for (const x of [g.measure.window?.periods, g.measure.window?.origin_offset]) if (has(x)) touched.add(x);
    return { goal_id: g.id, ...outcomeOf(closure, w), cancelled: [], needs_measure: false, needs_deadline: w?.deadline === true, olumi_inputs: olumiInputs(closure), unverified_inputs: [...touched].filter((x) => unverifiedIds.has(x)), rests_on: restsOn(touched, g.measure.assumptions), excludes: [...g.measure.exclusions] };
  });
  const limitClosure = new Map<string, Set<string>>();
  const perLimit: LimitOutcome[] = model.limits.map((l) => {
    if (!has(l.measure)) return { limit_id: l.id, status: 'asks', reasons: [`"${l.label}" has no measure yet, so the result does not cover it.`], asks: [], cancelled: [], needs_measure: true };
    const closure = upstream(limitRoots(l));
    const w = limitWin.get(l.id);
    limitClosure.set(l.id, new Set([...closure, ...(w?.blockers ?? []), ...unknownWindowRefs(l.measure.window)]));
    return { limit_id: l.id, ...outcomeOf(closure, w), cancelled: [], needs_measure: false };
  });
  const optionClosure = new Map(model.options.map((o) => [o.id, upstream([...o.sets.map((s) => s.to).filter(has), ...o.sets.map((s) => s.starts_after_periods).filter((t): t is string => typeof t === 'string')])] as const));
  const perOption: OptionOutcome[] = model.options.map((o) => {
    if (o.status !== 'live') return { option_id: o.id, status: 'not_compared', reasons: [o.status === 'ruled_out' ? `"${o.label}" is ruled out, kept in view.` : `"${o.label}" is removed from the comparison.`], asks: [] };
    return { option_id: o.id, ...outcomeOf(optionClosure.get(o.id)!) };
  });

  const result: CompileResult = {
    executable: null, perGoal, perLimit, perOption,
    joint: { status: 'asks', goal_ids: [], leaves_out: [], asks: [], reasons: [] },
    within_limits: { status: 'calculable', limit_ids: [], leaves_out: [], asks: [], reasons: [] },
    coverage: { covers: [], leaves_out: [] },
    errors, blockers: [], unverified,
    preferences: model.preferences.map((p) => ({ id: p.id, quantity: p.quantity, direction: p.direction, label: Q.get(p.quantity)?.label ?? p.quantity })),
    conversions: [], implicit_as_stated: model.options.length === 0,
    in_model: [...new Set([...goalClosure.values(), ...limitClosure.values(),
      ...model.options.filter((o) => o.status === 'live').map((o) => optionClosure.get(o.id)!)].flatMap((c) => [...c]))],
  };

  // ── the executable subset: only supported goals, limits and inputs ────────────────────────────────────────────────
  const build = (goals: CanonicalGoalT[], limits: CanonicalLimitT[], options: CanonicalModelT['options'], conversions?: Conversion[]): ExecutableModel => {
    const included = upstream([...goals.flatMap(goalRoots), ...limits.flatMap(limitRoots)]);
    const xRisks = new Set<string>();
    const xSets = new Map<string, Set<number>>();
    for (let changed = true; changed;) {
      changed = false;
      for (const o of options) o.sets.forEach((s, i) => {
        const taken = xSets.get(o.id) ?? new Set<number>();
        if (!included.has(s.quantity) || taken.has(i)) return;
        taken.add(i); xSets.set(o.id, taken); changed = true;
        const when = setTiming.get(o.id)?.[i];
        for (const x of upstream([s.to ?? '', ...(typeof when === 'string' ? [when] : [])])) included.add(x);
      });
      for (const k of model.risks) if (!xRisks.has(k.id) && included.has(k.effect_on)) {
        xRisks.add(k.id); changed = true;
        const when = riskTiming.get(k.id);
        for (const x of upstream([k.occurrence, k.severity, ...(typeof when === 'string' ? [when] : [])])) included.add(x);
      }
    }
    const quantities: XQuantity[] = [];
    for (const q of model.quantities.filter((x) => included.has(x.id) && !consumedOnly.has(x.id))) {
      const u = U.get(q.id)!;
      const unit = u.scale === 1 ? q.unit : showUnit({ dims: u.dims, scale: 1 });
      const r = R.get(q.id);
      if (conversions && u.scale !== 1) conversions.push({ kind: 'percent', quantity: q.id, from: q.unit, to: unit, factor: u.scale, author: 'olumi' });
      const law = readings.get(q.id);
      if (conversions && law?.kind === 'normal') conversions.push({ kind: 'range_law', quantity: q.id, low: q.low! * u.scale, high: q.high! * u.scale, range_kind: q.range_kind ?? 'plausible', domain: domainOf(q) ?? null, reading: law, author: 'olumi', provisional: true });
      const base = { id: q.id, label: q.label, unit, reading: 'state' as const }; // readings are set by `setReadings` once the subset is final
      if (r === undefined) quantities.push({ ...base, dist: distOf(q, u.scale, domainOf(q)) });
      else if (r.form === 'stock') quantities.push({ ...base, stock: { start: r.start, inflows: [...r.inflows], outflows: [...r.outflows] } });
      else if (r.form === 'effect') quantities.push({ ...base, equation: { form: 'effect', base: r.base, terms: r.terms.map((t) => ({ coefficient: t.coefficient, driver: t.driver })) } });
      else quantities.push(...lowerDefinition(base, r, (ids) => showUnit({ dims: ids.reduce((a, i) => multiply(a, U.get(i)!), { dims: {}, scale: 1 } as Unit).dims, scale: 1 })));
    }
    const xOptions: XOption[] = model.options.length === 0
      ? [{ id: AS_STATED_OPTION_ID, label: 'As things stand', sets: [] }]
      : options.map((o) => ({ id: o.id, label: o.label, sets: o.sets.flatMap((s, i) => (xSets.get(o.id)?.has(i) ? [{ quantity: s.quantity, to: s.to ?? '', from_period: setTiming.get(o.id)?.[i] ?? 0 }] : [])) }));
    const xGoals: XGoal[] = goals.map((g) => ({
      id: g.id, label: g.label, quantity: lowerChange(g, quantities, xOptions), ...(has(g.measure!.per) ? { per: g.measure!.per } : {}),
      cmp: g.measure!.cmp, target: g.measure!.target, aggregation: g.measure!.aggregation, window: goalWin.get(g.id)!.win!,
      ...(g.measure!.window === null ? { no_deadline: true as const } : {}),
    }));
    const xLimits: XLimit[] = limits.map((l) => ({
      id: l.id, label: l.label, quantity: l.measure!.quantity, ...(has(l.measure!.per) ? { per: l.measure!.per } : {}),
      cmp: l.measure!.cmp, bound: l.measure!.bound, aggregation: l.measure!.aggregation, window: limitWin.get(l.id)!.win!,
      ...(l.measure!.window === null ? { no_deadline: true as const } : {}),
    }));
    const xRiskList: XRisk[] = model.risks.filter((k) => xRisks.has(k.id)).map((k) => ({ id: k.id, occurrence: k.occurrence, severity: k.severity, effect_on: k.effect_on, mode: k.mode, from_period: riskTiming.get(k.id) ?? 0 }));
    setReadings(quantities);
    return { periods: horizon, period_unit: model.period, quantities, goals: xGoals, limits: xLimits, options: xOptions, risks: xRiskList, withheld: [] };
  };

  // Finite probes cannot establish an identity or its domain. Missing facts stay asked;
  // no diagnostic agreement may remove an ask or substitute an invented production value.

  // ── joint, limits, coverage, blockers ─────────────────────────────────────────────────────────────────────────────
  const worst = (xs: { status: Outcome }[]): Outcome => (xs.some((x) => x.status === 'withheld') ? 'withheld' : xs.some((x) => x.status === 'asks') ? 'asks' : 'calculable');
  const measuredOutcomes = perGoal.filter((p) => !p.needs_measure);
  const measuredLimitOutcomes = perLimit.filter((p) => !p.needs_measure);
  const label = (id: string) => model.goals.find((g) => g.id === id)?.label ?? model.limits.find((l) => l.id === id)?.label ?? id;
  result.joint = {
    status: measuredOutcomes.length ? worst(measuredOutcomes) : 'asks',
    goal_ids: measuredOutcomes.map((p) => p.goal_id),
    leaves_out: perGoal.filter((p) => p.needs_measure).map((p) => p.goal_id),
    asks: [...new Set(measuredOutcomes.flatMap((p) => p.asks))],
    reasons: measuredOutcomes.length
      ? measuredOutcomes.filter((p) => p.status !== 'calculable').map((p) => `The chance of meeting every goal together waits on "${label(p.goal_id)}".`)
      : ['No aim has a measure yet, so there is no chance to work out.'],
  };
  result.within_limits = {
    status: worst(measuredLimitOutcomes),
    limit_ids: measuredLimitOutcomes.map((p) => p.limit_id),
    leaves_out: perLimit.filter((p) => p.needs_measure).map((p) => p.limit_id),
    asks: [...new Set(measuredLimitOutcomes.flatMap((p) => p.asks))],
    reasons: measuredLimitOutcomes.filter((p) => p.status !== 'calculable').map((p) => `Staying within the limits waits on "${label(p.limit_id)}".`),
  };
  const feedsOf = (id: string) => [
    ...perGoal.filter((p) => goalClosure.get(p.goal_id)?.has(id)).map((p) => p.goal_id),
    ...perLimit.filter((p) => limitClosure.get(p.limit_id)?.has(id)).map((p) => p.limit_id),
    ...model.options.filter((o) => o.status === 'live' && optionClosure.get(o.id)!.has(id)).map((o) => o.id),
  ];
  // What the result waits on, typed and in the model's order (no ranking, no words): the AI asks in its own (A4).
  const blocker = (id: string, code: BlockerCode, scope: string[]): Blocker => ({ id, code, scope });
  result.blockers = [
    ...(model.goals.length === 0 ? [blocker('(model)', 'no_goal', [])] : []),
    ...model.goals.flatMap((g) => [...(!has(g.measure) ? [blocker(g.id, 'measure', [g.id])] : []), ...(goalWin.get(g.id)?.deadline === true ? [blocker(g.id, 'deadline', [g.id])] : [])]),
    ...model.limits.flatMap((l) => [...(!has(l.measure) ? [blocker(l.id, 'measure', [l.id])] : []), ...(limitWin.get(l.id)?.deadline === true ? [blocker(l.id, 'deadline', [l.id])] : [])]),
    ...model.quantities.flatMap((q) => [
      // Every figure the result rests on with none in hand waits (served funding dead end: two unknowns, nothing listed):
      // asked, theirs to give; unknown, where a goal, limit or option rests on it, no one's to give yet.
      ...(q.status === 'asked' ? [blocker(q.id, 'asked', feedsOf(q.id))] : q.status === 'unknown' && feedsOf(q.id).length > 0 ? [blocker(q.id, 'unknown', feedsOf(q.id))] : []),
      ...(unresolved.has(q.id) ? [blocker(q.id, 'range_kind', feedsOf(q.id))] : []),
      ...(recheck.has(q.id) ? [blocker(q.id, 'recount', feedsOf(q.id))] : []),
    ]),
  ];
  const withheldList: Withheld[] = [
    ...perGoal.filter((p) => p.status !== 'calculable').map((p) => ({ id: p.goal_id, kind: 'goal' as const, label: label(p.goal_id), reason: p.reasons.join(' ') })),
    ...perLimit.filter((p) => p.status !== 'calculable').map((p) => ({ id: p.limit_id, kind: 'limit' as const, label: label(p.limit_id), reason: p.reasons.join(' ') })),
    ...perOption.filter((p) => p.status !== 'calculable').map((p) => ({ id: p.option_id, kind: 'option' as const, label: model.options.find((o) => o.id === p.option_id)!.label, reason: p.reasons.join(' ') })),
  ];

  if (errors.length) {
    for (const p of perGoal) { p.status = 'withheld'; p.reasons = ['The model has errors to fix first.', ...p.reasons]; }
    result.joint = { ...result.joint, status: 'withheld', reasons: ['The model has errors to fix first.'] };
    return result;
  }

  const goodGoals = model.goals.filter((g, i) => perGoal[i].status === 'calculable' && has(g.measure));
  const goodLimits = model.limits.filter((l, i) => perLimit[i].status === 'calculable' && has(l.measure));
  const goodOptions = model.options.filter((o, i) => perOption[i].status === 'calculable');
  result.coverage = { covers: [...goodGoals.map((g) => g.label), ...goodLimits.map((l) => l.label)], leaves_out: withheldList.filter((w) => w.kind !== 'option') };
  // A run needs something to check (a goal, or limits only) and something to compare.
  if ((!goodGoals.length && !goodLimits.length) || (model.options.length > 0 && !goodOptions.length)) return result;

  const conversions: Conversion[] = [];
  const x = build(goodGoals, goodLimits, goodOptions, conversions);
  const inRun = new Set(x.risks.map((k) => k.id));
  x.withheld = [
    ...withheldList,
    ...model.risks.filter((k) => !inRun.has(k.id)).map((k) => ({ id: k.id, kind: 'risk' as const, label: k.label, reason: 'It affects nothing this run works out.' })),
  ];
  result.executable = x;
  result.conversions = conversions;
  return result;
}

/**
 * A signed sum or a product of powers ±1, lowered to the executable model's definition ops (difference and ratio take the
 * first part against the rest): several added parts with subtracted ones get an exact intermediate `<q>__plus`; several
 * multiplied parts with divided ones get `<q>__times`. Both are exact, Olumi-free and drawn by nobody.
 */
function lowerDefinition(base: Omit<XQuantity, 'equation' | 'dist' | 'stock'>, r: Extract<CanonicalRelationT, { form: 'definition' }>, unitOfProduct: (ids: string[]) => string): XQuantity[] {
  if (r.op === 'sum') {
    const pos = r.parts.filter((p) => p.sign === 1).map((p) => p.id);
    const neg = r.parts.filter((p) => p.sign === -1).map((p) => p.id);
    if (!neg.length) return [{ ...base, equation: { form: 'definition', op: 'sum', parts: pos } }];
    if (pos.length === 1) return [{ ...base, equation: { form: 'definition', op: 'difference', parts: [pos[0], ...neg] } }];
    const plus = `${base.id}__plus`;
    return [{ ...base, id: plus, label: `${base.label} (parts added)`, equation: { form: 'definition', op: 'sum', parts: pos } }, { ...base, equation: { form: 'definition', op: 'difference', parts: [plus, ...neg] } }];
  }
  const num = r.parts.filter((p) => p.power === 1).map((p) => p.id);
  const den = r.parts.filter((p) => p.power === -1).map((p) => p.id);
  if (!den.length) return [{ ...base, equation: { form: 'definition', op: 'product', parts: num } }];
  if (num.length === 1) return [{ ...base, equation: { form: 'definition', op: 'ratio', parts: [num[0], ...den] } }];
  const times = `${base.id}__times`;
  return [{ ...base, id: times, label: `${base.label} (parts multiplied)`, unit: unitOfProduct(num), equation: { form: 'definition', op: 'product', parts: num } }, { ...base, equation: { form: 'definition', op: 'ratio', parts: [times, ...den] } }];
}

/**
 * A CHANGE GOAL, LOWERED INTO DEFINITIONS (plan r3 #1), so the executable model's forms are unchanged:
 *   change_abs: `<goal>__change` = difference(X, reference)
 *   change_rel: `<goal>__change_rel` = ratio(`<goal>__change`, reference)
 * The reference is a stated quantity, or a SHADOW of X computed on the SAME draws (common random numbers):
 *   now: X today, before any option or risk: inputs at their baseline, a stock at its start (`<q>__today`);
 *   option (one that changes nothing, i.e. carrying on as now): X's path with no option's sets (`<q>__sq`), stocks included.
 * An input an option sets is split once into `<q>__base` (its figure, drawn once) and `<q>` = sum(`<q>__base`), which the
 * option overrides; every shadow reads `<q>__base`, so the baseline is never re-drawn.
 */
function lowerChange(g: CanonicalGoalT, quantities: XQuantity[], options: XOption[]): string {
  const m = g.measure!;
  if (m.frame === 'level' || !m.reference) return m.quantity;
  const byId = new Map(quantities.map((q) => [q.id, q] as const));
  const put = (q: XQuantity) => { const i = quantities.findIndex((x) => x.id === q.id); if (i >= 0) quantities[i] = q; else quantities.push(q); byId.set(q.id, q); };
  const setTargets = new Set(options.flatMap((o) => o.sets.map((s) => s.quantity)));
  const baseOf = (u: string): string => {
    const q = byId.get(u)!;
    if (!q.dist || !setTargets.has(u)) return u;
    const id = `${u}__base`;
    put({ id, label: `${q.label} (before any option)`, unit: q.unit, reading: 'state', dist: q.dist });
    put({ id: u, label: q.label, unit: q.unit, reading: 'state', equation: { form: 'definition', op: 'sum', parts: [id] } });
    return id;
  };
  const mode = m.reference.kind === 'now' ? 'today' : 'sq';
  const suffix = mode === 'today' ? 'today' : 'if carrying on as now';
  const shadow = (u: string): string => {
    const q = byId.get(u)!;
    if (q.dist) return baseOf(u);
    if (byId.has(`${u}__base`) && q.equation?.form === 'definition' && q.equation.parts[0] === `${u}__base`) return `${u}__base`;
    const id = `${u}__${mode}`;
    if (byId.has(id)) return id;
    if (q.stock) {
      if (mode === 'today') return shadow(q.stock.start);
      put({ id, label: `${q.label} ${suffix}`, unit: q.unit, reading: 'state', stock: { start: q.stock.start, inflows: [], outflows: [] } }); // reserved: a stock may feed its own flows
      put({ id, label: `${q.label} ${suffix}`, unit: q.unit, reading: 'state', stock: { start: shadow(q.stock.start), inflows: q.stock.inflows.map(shadow), outflows: q.stock.outflows.map(shadow) } });
      return id;
    }
    const e = q.equation!;
    put({ id, label: `${q.label} ${suffix}`, unit: q.unit, reading: 'state', equation: e.form === 'definition' ? { form: 'definition', op: e.op, parts: e.parts.map(shadow) } : { form: 'effect', base: shadow(e.base), terms: e.terms.map((t) => ({ coefficient: shadow(t.coefficient), driver: shadow(t.driver) })) } });
    return id;
  };
  const reference = m.reference.kind === 'value' ? m.reference.quantity! : shadow(m.quantity);
  const unit = byId.get(m.quantity)!.unit;
  const delta = `${g.id}__change`;
  put({ id: delta, label: `${g.label}: change`, unit, reading: 'state', equation: { form: 'definition', op: 'difference', parts: [m.quantity, reference] } });
  if (m.frame === 'change_abs') return delta;
  const rel = `${g.id}__change_rel`;
  put({ id: rel, label: `${g.label}: change as a share`, unit: '1', reading: 'state', equation: { form: 'definition', op: 'ratio', parts: [delta, reference] } });
  return rel;
}

/**
 * THE READING CONVENTION (executable.ts; DL ruling 1, PL ruling A): STRUCTURAL ONLY. A stock is state; its inflows and
 * outflows are flows, and so is anything that depends, within one period, on one; everything else is state. Options and
 * risks never change a reading, so adding an option never changes another option's question.
 */
function setReadings(quantities: XQuantity[]): void {
  const flow = new Set<string>(quantities.flatMap((q) => (q.stock ? [...q.stock.inflows, ...q.stock.outflows] : [])));
  const deps = (q: XQuantity): string[] => (q.equation?.form === 'definition' ? q.equation.parts : q.equation?.form === 'effect' ? [q.equation.base, ...q.equation.terms.flatMap((t) => [t.coefficient, t.driver])] : []);
  for (let changed = true; changed;) {
    changed = false;
    for (const q of quantities) if (!q.stock && !flow.has(q.id) && deps(q).some((d) => flow.has(d))) { flow.add(q.id); changed = true; }
  }
  for (const q of quantities) q.reading = q.stock ? 'state' : flow.has(q.id) ? 'flow' : 'state';
}

const FIXED_AUTHOR: Record<CanonicalQuantityT['author'], FixedAuthor> = { person: 'person', olumi: 'olumi', structure: 'structure' };

/** A figure → its description: fixed (with its author), or a range whose law S2 takes from the ruled conversion. */
function distOf(q: CanonicalQuantityT, scale: number, domain?: Domain): Dist {
  if (q.low !== null && q.high !== null && q.low !== q.high) return rangeDistOf(q, scale, domain);
  return { kind: 'fixed', value: (q.value ?? q.low!) * scale, author: FIXED_AUTHOR[q.author] };
}
