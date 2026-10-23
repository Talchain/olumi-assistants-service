/**
 * THE COMPILER (spike S1): CanonicalModel → ExecutableModel, with TYPED OUTCOMES.
 *
 *   compile(model, { sourceText }) → { executable, perGoal, perLimit, perOption, joint, within_limits, errors, asks,
 *                                     coaching, unverified, conversions, implicit_as_stated }
 *
 * Four kinds of outcome, never confused:
 *  · ERRORS are the draft's own mistakes (an undefined id, a unit that does not combine, a cycle not through a stock, an
 *    Olumi figure without a range, a person's item without their words, a condition that is both a goal and a limit). Each
 *    is one plain sentence naming the items, so the AI can repair it in the same turn. Any error → `executable: null`.
 *  · ASKS are legitimate, successful outcomes: a figure only the person can give. Each ask fills EXACTLY ONE quantity
 *    (`fillQuantity` in answer.ts) and lists what it feeds; each goal lists its own asks, so "answer these and the chance
 *    appears" is true by construction. An ask withholds ONLY what it feeds; everything else still calculates. The compiler
 *    never pressures invention: with no measured goal it reports no reach errors, only the question.
 *  · WITHHELD goals rest on a quantity that is `unknown` or `unsupported` (or a window that is a range); the reason says which.
 *  · UNVERIFIED items are the person's by their author, but their quote is not in the person's words (`sourceText`). They
 *    still calculate, and are never shown as the person's (`project.ts`).
 *
 * The joint and the limits are never computed over a partial subset (PL correction 2): `joint` and `within_limits` say
 * whether the simulator's joint figures stand for ALL measured goals and ALL limits. An aim with no measure is left out of
 * the chance, said in `joint.leaves_out`, never dropped.
 *
 * % figures are converted to fractions here, explicitly (`conversions`), so the executable model has one number per unit.
 */
import {
  CanonicalModel, FIGURE_STATUSES, WITHHOLDING_STATUSES, QUALITATIVE_FAMILIES,
  type CanonicalModelT, type CanonicalQuantityT, type CanonicalRelationT, type CanonicalWindowT,
} from './canonical.js';
import type { ExecutableModel, Quantity as XQuantity, Goal as XGoal, Limit as XLimit, Option as XOption, Risk as XRisk, Dist } from './executable.js';
import { parseUnit, multiply, divide, sameDims, isDimensionless, showUnit, perPeriod, isCalendarConversion, TIME_DIMS, type Unit } from './units.js';

export type CompileErrorCode =
  | 'schema' | 'bad_id' | 'duplicate_id' | 'undefined_ref' | 'unit_unreadable' | 'unit_mismatch' | 'figure_status'
  | 'olumi_no_range' | 'missing_quote' | 'range_order' | 'no_relation' | 'relation_on_figure' | 'two_relations'
  | 'relation_shape' | 'cycle' | 'no_goal' | 'goal_and_limit' | 'goal_shape' | 'window' | 'option_shape' | 'set_derived'
  | 'option_reaches_no_goal' | 'set_reaches_nothing' | 'risk_shape' | 'not_applicable_used' | 'after_horizon';
export type CompileError = { code: CompileErrorCode; message: string; items: string[] };
export type Outcome = 'calculable' | 'asks' | 'withheld';
export type GoalOutcome = {
  goal_id: string;
  status: Outcome;
  reasons: string[];
  /** The asked quantities this goal waits on: answer exactly these (and nothing is withheld) and its chance appears. */
  asks: string[];
  /** True for an aim with no measure yet: left out of the chance, with a coaching question. */
  needs_measure: boolean;
  /** Olumi-authored quantities, relations and effect terms (`relation_id:driver`) the goal rests on: shown as provisional. */
  olumi_inputs: string[];
  /** The person's items it rests on whose quote is not in their words. */
  unverified_inputs: string[];
  /** Assumptions and conditions that concern what the goal rests on: said beside its result. */
  rests_on: string[];
};
export type LimitOutcome = { limit_id: string; status: Outcome; reasons: string[]; asks: string[] };
export type OptionOutcome = { option_id: string; status: Outcome | 'not_compared'; reasons: string[]; asks: string[] };
/** One question whose answer fills exactly one quantity. */
export type Ask = { quantity_id: string; label: string; unit: string; question: string; feeds: string[]; edit: { op: 'fill_quantity'; quantity_id: string } };
/** A question whose answer changes the model's structure (a measure for an aim; what would let a left-out item in). */
export type Coaching = { record_id: string; kind: 'measure' | 'left_out'; question: string };
export type CompileResult = {
  executable: ExecutableModel | null;
  perGoal: GoalOutcome[];
  perLimit: LimitOutcome[];
  perOption: OptionOutcome[];
  /** Whether the simulator's `joint` stands for every measured goal. `leaves_out`: aims with no measure yet. */
  joint: { status: Outcome; goal_ids: string[]; leaves_out: string[]; asks: string[]; reasons: string[] };
  /** Whether the simulator's `within_limits` stands for every limit the person set. */
  within_limits: { status: Outcome; limit_ids: string[]; asks: string[]; reasons: string[] };
  errors: CompileError[];
  asks: Ask[];
  coaching: Coaching[];
  unverified: { id: string; quote: string }[];
  /** Every % figure rewritten as a fraction, said explicitly. */
  conversions: { quantity: string; from: string; to: string; factor: number }[];
  /** True when the model names no option, so the executable runs one implicit "as things stand" option. */
  implicit_as_stated: boolean;
};

export const AS_STATED_OPTION_ID = 'as_stated';
const ID_RE = /^[a-z][a-z0-9_]*$/;
const has = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const direction = (cmp: string) => (cmp.startsWith('>') ? 'up' : 'down');

/** Schema-check unknown JSON (the AI's raw output), then compile. A schema failure is an error the AI can act on. */
export function compileJson(input: unknown, opts: { sourceText?: string } = {}): CompileResult {
  const parsed = CanonicalModel.safeParse(input);
  if (parsed.success) return compile(parsed.data, opts);
  return {
    executable: null, perGoal: [], perLimit: [], perOption: [],
    joint: { status: 'withheld', goal_ids: [], leaves_out: [], asks: [], reasons: ['The model does not compile yet.'] },
    within_limits: { status: 'withheld', limit_ids: [], asks: [], reasons: ['The model does not compile yet.'] },
    errors: parsed.error.issues.slice(0, 20).map((i) => ({
      code: 'schema' as const, message: `The model's shape is wrong at ${i.path.join('.') || 'its top level'}: ${i.message}.`, items: [],
    })),
    asks: [], coaching: [], unverified: [], conversions: [], implicit_as_stated: false,
  };
}

type Win = { start_period: number; periods: number };
type WinState = { win: Win | null; blockers: string[]; withheld: string[] };

export function compile(model: CanonicalModelT, opts: { sourceText?: string } = {}): CompileResult {
  const errors: CompileError[] = [];
  const err = (code: CompileErrorCode, message: string, items: string[]) => errors.push({ code, message, items });

  // ── ids ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const allIds = new Map<string, string>();
  const families: [string, readonly { id: string }[]][] = [
    ['quantity', model.quantities], ['relation', model.relations], ['goal', model.goals], ['limit', model.limits],
    ['option', model.options], ['risk', model.risks], ...QUALITATIVE_FAMILIES.map((f) => [f, model[f]] as [string, { id: string }[]]),
  ];
  for (const [family, recs] of families) for (const r of recs) {
    if (!ID_RE.test(r.id)) err('bad_id', `The ${family} id "${r.id}" must be lowercase letters, digits and underscores, starting with a letter.`, [r.id]);
    if (allIds.has(r.id)) err('duplicate_id', `The id "${r.id}" is used twice (a ${allIds.get(r.id)} and a ${family}); give each record its own id.`, [r.id]);
    else allIds.set(r.id, family);
  }
  const Q = new Map(model.quantities.map((q) => [q.id, q] as const));
  const name = (id: string) => (Q.has(id) ? `"${Q.get(id)!.label}" (${id})` : `"${id}"`);
  const isQ = (ref: string, where: string, owner: string): boolean => {
    if (Q.has(ref)) return true;
    err('undefined_ref', `${where} names "${ref}", which is not a quantity in the model; add it as a quantity or use an existing id.`, [owner, ref]);
    return false;
  };

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

  // ── window quantities: a window's length and its origin's timing ───────────────────────────────────────────────────
  const windowed = [...model.goals.filter((g) => has(g.measure)).map((g) => ({ id: g.id, w: g.measure!.window })), ...model.limits.map((l) => ({ id: l.id, w: l.window }))];
  const windowQs = new Set(windowed.flatMap(({ w }) => [w.periods, ...(has(w.origin_offset) ? [w.origin_offset] : [])]));

  // ── relations ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const R = new Map<string, CanonicalRelationT>();
  for (const r of model.relations) {
    if (!isQ(r.defines, `The relation "${r.id}"`, r.id)) continue;
    if (R.has(r.defines)) { err('two_relations', `${name(r.defines)} is worked out by two relations ("${R.get(r.defines)!.id}" and "${r.id}"); keep one.`, [r.defines, r.id]); continue; }
    R.set(r.defines, r);
  }

  // ── quantities: status ↔ figures ───────────────────────────────────────────────────────────────────────────────────
  for (const q of model.quantities) {
    const fig = has(q.value) || has(q.low) || has(q.high);
    const n = name(q.id);
    if (has(q.low) !== has(q.high)) err('range_order', `${n} has only one end of its range; give both low and high, or neither.`, [q.id]);
    if (has(q.low) && has(q.high) && q.low > q.high) err('range_order', `${n} has low ${q.low} above high ${q.high}.`, [q.id]);
    if (has(q.value) && has(q.low) && has(q.high) && (q.value < q.low || q.value > q.high)) err('range_order', `${n} has its figure ${q.value} outside its range ${q.low}–${q.high}.`, [q.id]);
    if (q.status === 'derived') {
      if (!R.has(q.id)) err('no_relation', `${n} is marked derived but no relation works it out; add its definition, effect or stock, or give its figure.`, [q.id]);
      if (fig) err('figure_status', `${n} is derived, so its figures must be null (its relation works them out).`, [q.id]);
      continue;
    }
    if (R.has(q.id)) { err('relation_on_figure', `${n} has a relation ("${R.get(q.id)!.id}") but is marked ${q.status}; mark it derived with null figures, or remove the relation.`, [q.id, R.get(q.id)!.id]); continue; }
    if (q.status === 'known') {
      if (!fig) err('figure_status', `${n} is marked known but has no figure; give the person's figure, or mark it asked with a question.`, [q.id]);
      else if (q.author === 'olumi') {
        const point = has(q.value) && !has(q.low);
        const conversion = point && U.has(q.id) && isCalendarConversion(q.value!, U.get(q.id)!);
        const dateReading = point && windowQs.has(q.id) && Number.isInteger(q.value) && has(q.basis);
        if (!conversion && !dateReading) err('olumi_no_range', `${n} is Olumi's figure marked known; Olumi's figures are estimates: mark it estimated with low and high, or ask the person (Olumi's only known figures are exact calendar conversions such as 12 month/year, and a window's length read from a stated date, with that date in its basis).`, [q.id]);
      }
      needQuote(q, n, q.id);
    } else if (q.status === 'estimated') {
      if (q.author !== 'olumi') err('figure_status', `${n} is the person's figure marked estimated; mark it known with their quote (their own range in low and high).`, [q.id]);
      else if (!has(q.low) || !has(q.high)) err('olumi_no_range', `${n} is Olumi's estimate without both low and high; give a range as wide as what is genuinely unknown.`, [q.id]);
      if (!has(q.basis)) err('figure_status', `${n} is Olumi's estimate with no basis; say in one sentence what it rests on.`, [q.id]);
    } else {
      if (fig) err('figure_status', `${n} is marked ${q.status} but has a figure; a figure in hand is known (the person's) or estimated (Olumi's).`, [q.id]);
      if (q.status === 'asked' && !has(q.question)) err('figure_status', `${n} is asked but has no question; write the one question to the person.`, [q.id]);
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
      if (!r.parts.every((p) => isQ(p, at, r.id))) continue;
      instant.set(r.defines, [...r.parts]);
      const min = r.op === 'difference' || r.op === 'ratio' ? 2 : 1;
      if (r.parts.length < min) { err('relation_shape', `${at} is a ${r.op} of ${r.parts.length} part(s); it needs at least ${min}.`, [r.id]); continue; }
      if (!d || !unitsOk(...r.parts)) continue;
      if (r.op === 'sum' || r.op === 'difference') {
        for (const p of r.parts) if (!sameDims(U.get(p)!, d)) {
          err('unit_mismatch', `${at} is a ${r.op}, but part ${name(p)} is ${showUnit(U.get(p)!)} while ${name(r.defines)} is ${showUnit(d)}; the parts of a ${r.op} share one unit.`, [r.id, p, r.defines]);
        }
      } else {
        const parts = r.parts.map((p) => U.get(p)!);
        const got = r.op === 'product' ? parts.reduce((a, b) => multiply(a, b)) : parts.slice(1).reduce((a, b) => divide(a, b), parts[0]);
        if (!sameDims(got, d)) err('unit_mismatch', `${at} is a ${r.op} whose parts make ${showUnit(got)}, but ${name(r.defines)} is ${showUnit(d)}.`, [r.id, r.defines, ...r.parts]);
      }
    } else if (r.form === 'effect') {
      const refs = [r.base, ...r.terms.flatMap((t) => [t.coefficient, t.driver])];
      if (!refs.every((x) => isQ(x, at, r.id))) continue;
      instant.set(r.defines, refs);
      for (const t of r.terms) needQuote(t, `The link from ${name(t.driver)} in "${r.id}"`, `${r.id}:${t.driver}`);
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
        err('unit_mismatch', `${at}: flow ${name(f)} is ${showUnit(U.get(f)!)} but a flow of this stock is ${showUnit(want)} (the stock's unit per ${model.period}); convert it with a named quantity such as 12 month/year.`, [r.id, f]);
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
  const upstream = (roots: readonly string[]): Set<string> => {
    const seen = new Set<string>();
    const stack = roots.filter((r) => Q.has(r));
    while (stack.length) {
      const q = stack.pop()!;
      if (seen.has(q)) continue;
      seen.add(q);
      stack.push(...(instant.get(q) ?? []), ...(lagged.get(q) ?? []));
      for (const rid of risksOn.get(q) ?? []) { const k = riskById.get(rid)!; stack.push(...[k.occurrence, k.severity].filter((x) => Q.has(x))); }
    }
    return seen;
  };

  // ── goals and limits: what the person is trying to achieve vs a condition the plan must not break ──────────────────
  const GOAL_VS_LIMIT = 'A goal is what the person is trying to achieve; a limit is a condition the plan must not break (a budget, a time cap).';
  if (model.goals.length === 0) {
    err('no_goal', `There is no goal. ${GOAL_VS_LIMIT} ${model.limits.length ? `The ${model.limits.length} limit(s) here stay limits: never copy them into goals. ` : ''}If the person states no result to achieve, add their aim with measure null and a question asking how they would tell it worked.`, []);
  }
  const figureOf = (id: string) => { const q = Q.get(id); return q && has(q.value) && !has(q.low) ? q.value : null; };
  for (const g of model.goals) for (const l of model.limits) {
    const m = g.measure;
    if (!m || m.quantity !== l.quantity || direction(m.cmp) !== direction(l.cmp)) continue;
    const sameBound = m.target === l.bound || (figureOf(m.target) !== null && figureOf(m.target) === figureOf(l.bound));
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
  const targetUnitOk = (qu: Unit, tu: Unit, agg: string) =>
    agg === 'sum' ? sameDims(tu, multiply(qu, period)) || (sameDims(tu, qu) && !Object.keys(qu.dims).some((k) => TIME_DIMS.has(k))) : sameDims(tu, qu);

  const goalWin = new Map<string, WinState>();
  for (const g of model.goals) {
    const at = `The goal "${g.label}" (${g.id})`;
    needQuote(g, at, g.id);
    if (!has(g.measure)) {
      if (!has(g.question)) err('goal_shape', `${at} has no measure and no question; give it a measure, or ask the person how they would tell it worked.`, [g.id]);
      continue;
    }
    const m = g.measure;
    if (!isQ(m.quantity, at, g.id) || !isQ(m.target, at, g.id)) continue;
    if (unitsOk(m.quantity, m.target) && !targetUnitOk(U.get(m.quantity)!, U.get(m.target)!, m.aggregation)) {
      err('unit_mismatch', `${at} compares ${name(m.quantity)} (${showUnit(U.get(m.quantity)!)}) with target ${name(m.target)} (${showUnit(U.get(m.target)!)}); for "${m.aggregation}" the target is in ${m.aggregation === 'sum' ? `the quantity's unit × ${model.period}` : "the quantity's unit"}.`, [g.id, m.quantity, m.target]);
    }
    goalWin.set(g.id, resolveWindow(m.window, at, g.id));
  }
  const limitWin = new Map<string, WinState>();
  for (const l of model.limits) {
    const at = `The limit "${l.label}" (${l.id})`;
    needQuote(l, at, l.id);
    if (!isQ(l.quantity, at, l.id) || !isQ(l.bound, at, l.id)) continue;
    if (unitsOk(l.quantity, l.bound) && !targetUnitOk(U.get(l.quantity)!, U.get(l.bound)!, l.aggregation)) {
      err('unit_mismatch', `${at} compares ${name(l.quantity)} (${showUnit(U.get(l.quantity)!)}) with bound ${name(l.bound)} (${showUnit(U.get(l.bound)!)}).`, [l.id, l.quantity, l.bound]);
    }
    limitWin.set(l.id, resolveWindow(l.window, at, l.id));
  }
  const wins = [...goalWin.values(), ...limitWin.values()].map((s) => s.win).filter(has);
  const horizon = wins.length ? Math.max(...wins.map((w) => w.start_period + w.periods)) : 0;

  // ── options ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const measured = model.goals.filter((g) => has(g.measure) && Q.has(g.measure.quantity) && Q.has(g.measure.target));
  const goalReach = upstream(measured.flatMap((g) => [g.measure!.quantity, g.measure!.target]));
  const limitReach = upstream(model.limits.flatMap((l) => [l.quantity, l.bound]));
  const optionIds = new Set(model.options.map((o) => o.id));
  const labels = new Map<string, string>();
  for (const o of model.options) {
    const at = `The option "${o.label}" (${o.id})`;
    needQuote(o, at, o.id);
    if (o.label.trim() === '') err('option_shape', `The option ${o.id} has no name; use the person's exact name for it.`, [o.id]);
    const key = norm(o.label);
    if (labels.has(key)) err('option_shape', `${at} has the same name as "${labels.get(key)}"; each option needs its own name.`, [o.id, labels.get(key)!]);
    labels.set(key, o.id);
    if (has(o.developed_from) && !optionIds.has(o.developed_from)) err('undefined_ref', `${at} is developed from "${o.developed_from}", which is not an option.`, [o.id]);
    let reachesGoal = false;
    for (const s of o.sets) {
      if (!isQ(s.quantity, at, o.id) || !isQ(s.to, at, o.id)) continue;
      if (Q.get(s.quantity)!.status === 'derived') err('set_derived', `${at} sets ${name(s.quantity)}, which is worked out by its relation; set one of its inputs instead.`, [o.id, s.quantity]);
      if (unitsOk(s.quantity, s.to) && !sameDims(U.get(s.quantity)!, U.get(s.to)!)) err('unit_mismatch', `${at} sets ${name(s.quantity)} (${showUnit(U.get(s.quantity)!)}) to ${name(s.to)} (${showUnit(U.get(s.to)!)}); they need one unit.`, [o.id, s.quantity, s.to]);
      if (s.from_period < 0) err('option_shape', `${at} sets ${name(s.quantity)} from period ${s.from_period}; periods start at 0 (now).`, [o.id]);
      if (horizon > 0 && s.from_period >= horizon) err('after_horizon', `${at} sets ${name(s.quantity)} from period ${s.from_period}, after the model's last period (${horizon - 1}).`, [o.id]);
      if (goalReach.has(s.quantity)) reachesGoal = true;
      else if (measured.length && !limitReach.has(s.quantity)) err('set_reaches_nothing', `${at} sets ${name(s.quantity)}, which reaches no goal or limit; link it to what it changes, or drop the setting.`, [o.id, s.quantity]);
    }
    // Never pressure invention: with no measured goal there is nothing to reach yet, and the goal's question says so.
    if (measured.length && o.sets.length && !reachesGoal && o.status === 'live') {
      err('option_reaches_no_goal', `${at} changes nothing a goal depends on; link what it changes to a goal's quantity.`, [o.id]);
    }
  }

  // ── risks ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  for (const k of model.risks) {
    const at = `The risk "${k.label}" (${k.id})`;
    needQuote(k, at, k.id);
    if (!isQ(k.occurrence, at, k.id) || !isQ(k.severity, at, k.id) || !isQ(k.effect_on, at, k.id)) continue;
    if (k.from_period < 0) err('risk_shape', `${at} takes effect from period ${k.from_period}; periods start at 0 (now).`, [k.id]);
    if (horizon > 0 && k.from_period >= horizon) err('after_horizon', `${at} takes effect from period ${k.from_period}, after the model's last period (${horizon - 1}).`, [k.id]);
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

  // ── qualitative records: references and authorship ────────────────────────────────────────────────────────────────
  for (const f of QUALITATIVE_FAMILIES) for (const rec of model[f]) {
    needQuote(rec, `The ${f.replace('_', ' ')} record "${rec.id}"`, rec.id);
    for (const c of rec.concerns) if (!allIds.has(c)) err('undefined_ref', `The ${f.replace('_', ' ')} record "${rec.id}" concerns "${c}", which is not in the model.`, [rec.id, c]);
  }

  // ── not applicable means unused ────────────────────────────────────────────────────────────────────────────────────
  const used = new Map<string, string>();
  for (const r of R.values()) for (const x of [...(instant.get(r.defines) ?? []), ...(lagged.get(r.defines) ?? [])]) used.set(x, r.id);
  for (const g of measured) { used.set(g.measure!.quantity, g.id); used.set(g.measure!.target, g.id); }
  for (const l of model.limits) { used.set(l.quantity, l.id); used.set(l.bound, l.id); }
  for (const { id, w } of windowed) for (const x of [w.periods, w.origin_offset]) if (has(x)) used.set(x, id);
  for (const o of model.options) for (const s of o.sets) { used.set(s.quantity, o.id); used.set(s.to, o.id); }
  for (const k of model.risks) for (const x of [k.occurrence, k.severity, k.effect_on]) used.set(x, k.id);
  for (const q of model.quantities) if (q.status === 'not_applicable' && used.has(q.id)) {
    err('not_applicable_used', `${name(q.id)} is marked not applicable but "${used.get(q.id)}" uses it; remove it from there, or give it a status that has a figure.`, [q.id, used.get(q.id)!]);
  }

  // ── typed outcomes: what each goal, limit and option rests on ──────────────────────────────────────────────────────
  const unverifiedIds = new Set(unverified.map((u) => u.id));
  const blockersOf = (closure: Iterable<string>) => [...closure].map((x) => Q.get(x)).filter((q): q is CanonicalQuantityT => !!q && (q.status === 'asked' || WITHHOLDING_STATUSES.has(q.status)));
  const describe = (q: CanonicalQuantityT) => (q.status === 'asked' ? `needs "${q.label}": ${q.question}` : `rests on "${q.label}", which is ${q.status.replace('_', ' ')}: ${q.basis}`);
  const outcomeOf = (closure: Set<string>, win?: WinState): { status: Outcome; reasons: string[]; asks: string[] } => {
    const blockers = blockersOf([...closure, ...(win?.blockers ?? [])]);
    const withheld = [...(win?.withheld ?? []), ...blockers.filter((q) => WITHHOLDING_STATUSES.has(q.status)).map(describe)];
    const asked = [...new Map(blockers.filter((q) => q.status === 'asked').map((q) => [q.id, q] as const)).values()];
    const reasons = [...withheld, ...asked.map(describe)];
    return { status: withheld.length ? 'withheld' : asked.length ? 'asks' : 'calculable', reasons, asks: asked.map((q) => q.id) };
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
  const restsOn = (touched: Set<string>) => [...model.assumptions, ...model.conditions].filter((a) => a.concerns.some((c) => touched.has(c))).map((a) => a.id);

  const goalClosure = new Map<string, Set<string>>();
  const perGoal: GoalOutcome[] = model.goals.map((g) => {
    if (!has(g.measure)) {
      return { goal_id: g.id, status: 'asks', reasons: [`"${g.label}" has no measure yet, so it is left out of the chance: ${g.question ?? ''}`.trim()], asks: [], needs_measure: true, olumi_inputs: [], unverified_inputs: unverifiedIds.has(g.id) ? [g.id] : [], rests_on: restsOn(new Set([g.id])) };
    }
    const closure = upstream([g.measure.quantity, g.measure.target]);
    const w = goalWin.get(g.id);
    goalClosure.set(g.id, new Set([...closure, ...(w?.blockers ?? [])]));
    const touched = touchedBy(closure, g.id);
    for (const x of [g.measure.window.periods, g.measure.window.origin_offset]) if (has(x)) touched.add(x);
    return { goal_id: g.id, ...outcomeOf(closure, w), needs_measure: false, olumi_inputs: olumiInputs(closure), unverified_inputs: [...touched].filter((x) => unverifiedIds.has(x)), rests_on: restsOn(touched) };
  });
  const limitClosure = new Map<string, Set<string>>();
  const perLimit: LimitOutcome[] = model.limits.map((l) => {
    const closure = upstream([l.quantity, l.bound]);
    const w = limitWin.get(l.id);
    limitClosure.set(l.id, new Set([...closure, ...(w?.blockers ?? [])]));
    return { limit_id: l.id, ...outcomeOf(closure, w) };
  });
  const optionClosure = new Map(model.options.map((o) => [o.id, upstream(o.sets.map((s) => s.to))] as const));
  const perOption: OptionOutcome[] = model.options.map((o) => {
    if (o.status !== 'live') return { option_id: o.id, status: 'not_compared', reasons: [o.status === 'ruled_out' ? `"${o.label}" is ruled out, kept in view.` : `"${o.label}" is removed from the comparison.`], asks: [] };
    return { option_id: o.id, ...outcomeOf(optionClosure.get(o.id)!) };
  });

  const worst = (xs: { status: Outcome }[]): Outcome => (xs.some((x) => x.status === 'withheld') ? 'withheld' : xs.some((x) => x.status === 'asks') ? 'asks' : 'calculable');
  const measuredOutcomes = perGoal.filter((p) => !p.needs_measure);
  const label = (id: string) => model.goals.find((g) => g.id === id)?.label ?? model.limits.find((l) => l.id === id)?.label ?? id;
  const joint = {
    status: measuredOutcomes.length ? worst(measuredOutcomes) : 'asks' as Outcome,
    goal_ids: measuredOutcomes.map((p) => p.goal_id),
    leaves_out: perGoal.filter((p) => p.needs_measure).map((p) => p.goal_id),
    asks: [...new Set(measuredOutcomes.flatMap((p) => p.asks))],
    reasons: measuredOutcomes.length
      ? measuredOutcomes.filter((p) => p.status !== 'calculable').map((p) => `The chance of meeting every goal together waits on "${label(p.goal_id)}".`)
      : ['No aim has a measure yet, so there is no chance to work out.'],
  };
  const within_limits = {
    status: worst(perLimit),
    limit_ids: perLimit.map((p) => p.limit_id),
    asks: [...new Set(perLimit.flatMap((p) => p.asks))],
    reasons: perLimit.filter((p) => p.status !== 'calculable').map((p) => `Staying within the limits waits on "${label(p.limit_id)}".`),
  };

  // ── asks (each fills one quantity; most-fed first) and coaching ────────────────────────────────────────────────────
  const feedsOf = (id: string) => [
    ...model.goals.filter((g) => goalClosure.get(g.id)?.has(id)).map((g) => g.id),
    ...model.limits.filter((l) => limitClosure.get(l.id)?.has(id)).map((l) => l.id),
    ...model.options.filter((o) => o.status === 'live' && optionClosure.get(o.id)!.has(id)).map((o) => o.id),
  ];
  const asks: Ask[] = model.quantities.filter((q) => q.status === 'asked' && has(q.question))
    .map((q) => ({ quantity_id: q.id, label: q.label, unit: q.unit, question: q.question!, feeds: feedsOf(q.id), edit: { op: 'fill_quantity' as const, quantity_id: q.id } }))
    .sort((a, b) => b.feeds.length - a.feeds.length);
  const coaching: Coaching[] = [
    ...model.goals.filter((g) => !has(g.measure) && has(g.question)).map((g) => ({ record_id: g.id, kind: 'measure' as const, question: g.question! })),
    ...model.left_out.filter((x) => has(x.question)).map((x) => ({ record_id: x.id, kind: 'left_out' as const, question: x.question! })),
  ];

  const result: CompileResult = {
    executable: null, perGoal, perLimit, perOption, joint, within_limits, errors, asks, coaching, unverified, conversions: [], implicit_as_stated: model.options.length === 0,
  };
  if (errors.length) {
    for (const p of result.perGoal) { p.status = 'withheld'; p.reasons = ['The model has errors to fix first.', ...p.reasons]; }
    result.joint = { ...joint, status: 'withheld', reasons: ['The model has errors to fix first.'] };
    return result;
  }

  // ── the executable subset ──────────────────────────────────────────────────────────────────────────────────────────
  const goodGoals = model.goals.filter((g) => perGoal.find((p) => p.goal_id === g.id)!.status === 'calculable' && has(g.measure));
  const goodLimits = model.limits.filter((l) => perLimit.find((p) => p.limit_id === l.id)!.status === 'calculable');
  const goodOptions = model.options.filter((o) => perOption.find((p) => p.option_id === o.id)!.status === 'calculable');
  if (!goodGoals.length || (model.options.length > 0 && !goodOptions.length)) return result;

  const included = upstream([...goodGoals.flatMap((g) => [g.measure!.quantity, g.measure!.target]), ...goodLimits.flatMap((l) => [l.quantity, l.bound])]);
  const xRisks = new Set<string>();
  const xSets = new Map<string, Set<number>>();
  for (let changed = true; changed;) {
    changed = false;
    for (const o of goodOptions) o.sets.forEach((s, i) => {
      const taken = xSets.get(o.id) ?? new Set<number>();
      if (!included.has(s.quantity) || taken.has(i)) return;
      taken.add(i); xSets.set(o.id, taken); changed = true;
      for (const x of upstream([s.to])) included.add(x);
    });
    for (const k of model.risks) if (!xRisks.has(k.id) && included.has(k.effect_on)) {
      xRisks.add(k.id); changed = true;
      for (const x of upstream([k.occurrence, k.severity])) included.add(x);
    }
  }

  const conversions: CompileResult['conversions'] = [];
  const quantities: XQuantity[] = model.quantities.filter((q) => included.has(q.id)).map((q) => {
    const u = U.get(q.id)!;
    const unit = u.scale === 1 ? q.unit : showUnit({ dims: u.dims, scale: 1 });
    if (u.scale !== 1) conversions.push({ quantity: q.id, from: q.unit, to: unit, factor: u.scale });
    const r = R.get(q.id);
    if (r === undefined) return { id: q.id, unit, dist: distOf(q, u.scale) };
    if (r.form === 'stock') return { id: q.id, unit, stock: { start: r.start, inflows: [...r.inflows], outflows: [...r.outflows] } };
    if (r.form === 'definition') return { id: q.id, unit, equation: { form: 'definition', op: r.op, parts: [...r.parts] } };
    return { id: q.id, unit, equation: { form: 'effect', base: r.base, terms: r.terms.map((t) => ({ coefficient: t.coefficient, driver: t.driver })) } };
  });
  const goals: XGoal[] = goodGoals.map((g) => ({ id: g.id, quantity: g.measure!.quantity, cmp: g.measure!.cmp, target: g.measure!.target, aggregation: g.measure!.aggregation, window: goalWin.get(g.id)!.win! }));
  const limits: XLimit[] = goodLimits.map((l) => ({ id: l.id, quantity: l.quantity, cmp: l.cmp, bound: l.bound, aggregation: l.aggregation, window: limitWin.get(l.id)!.win! }));
  const options: XOption[] = model.options.length === 0
    ? [{ id: AS_STATED_OPTION_ID, label: 'As things stand', sets: [] }]
    : goodOptions.map((o) => ({ id: o.id, label: o.label, sets: o.sets.filter((_, i) => xSets.get(o.id)?.has(i)).map((s) => ({ quantity: s.quantity, to: s.to, from_period: s.from_period })) }));
  const risks: XRisk[] = model.risks.filter((k) => xRisks.has(k.id)).map((k) => ({ id: k.id, occurrence: k.occurrence, severity: k.severity, effect_on: k.effect_on, mode: k.mode, from_period: k.from_period }));

  result.executable = { periods: horizon, period_unit: model.period, quantities, goals, limits, options, risks };
  result.conversions = conversions;
  return result;
}

/** A figure → its description: fixed, or a range whose law S2 takes from CEE's existing range conversion (never here). */
function distOf(q: CanonicalQuantityT, scale: number): Dist {
  const s = (v: number) => v * scale;
  if (q.low !== null && q.high !== null && q.low !== q.high) {
    return { kind: 'range', low: s(q.low), high: s(q.high), ...(q.value !== null ? { mode: s(q.value) } : {}), basis: q.author === 'person' ? 'person_range' : 'olumi_estimate' };
  }
  return { kind: 'fixed', value: s(q.value ?? q.low!) };
}
