/**
 * ANSWERING AN ASK (spike S1; phase 0 lesson 4): the person's answer to one ask is ONE edit that fills exactly ONE quantity.
 * The quantity becomes the person's known figure, in their words, approved by them (they typed it); what it replaced is kept
 * in `history`, so a correction never loses what it replaced. Nothing else in the model changes, so re-compiling shows
 * exactly which goals that answer unlocked.
 */
import { APPROXIMATE_FIGURE, type CanonicalModelT } from './canonical.js';
import { inlineQuantityId, isPowerOfTen } from './compile.js';
import { findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { unitWrittenAfter } from '../agent-lane/user-statements.js';
import { isCalendarConversion, parseUnit } from './units.js';

/** Words that give a figure as approximate ("about £2,000"). */
const APPROXIMATE_WORDS = /\b(about|around|roughly|approximately|approx|circa|nearly|almost)\b|~|≈/i;
/** The figures written in their words (thousands separators read; a sign is not read, so "5-8" is 5 and 8). */
const figuresIn = (words: string): number[] => (words.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
/**
 * Whether their words write `x` AS a figure in `unit`, or of the quantity named `label` (Codex r2 #3709, the rule of
 * feedback_range_end_needs_unit): the unit or the name straight after it, by the verifier's own matcher (`unitWrittenAfter`: whole word, plural, "10%"), with the plural of a unit
 * noun ending in f or y ("loaf" → "loaves"); or, for money, the same currency on that amount ("£2,500"). A figure of another
 * quantity or unit in the same words ("within 4 weeks", "60 kg") is never this one.
 */
const writesAs = (words: string, x: number, unit: string, label?: string): boolean => {
  const currency = readCurrencyUnitWithQualifiers(unit);
  if (currency.kind === 'currency') return findStatedAmounts(words).some((a) => a.kind === 'currency' && a.currencyCode === currency.currencyCode && Math.abs(a.magnitude) === Math.abs(x));
  const noun = unit.split('/')[0]!.trim();
  return [noun, noun.replace(/fe?$/u, 'ves'), noun.replace(/([^aeiou])y$/u, '$1ies'), ...(label !== undefined ? [label] : [])].some((u) => unitWrittenAfter(words, x, u));
};
/** Whether their words state both ends of a range: a range they did not state is never theirs. */
const statesEnds = (words: string, low: number, high: number): boolean => {
  const f = figuresIn(words);
  const has = (x: number) => f.some((y) => Math.abs(y - Math.abs(x)) < 1e-9);
  return has(low) && has(high);
};

export type Answer = { value: number; low?: null; high?: null } | { value?: number | null; low: number; high: number; range_kind?: 'bounds' | 'plausible' };
export type FillResult = { ok: true; model: CanonicalModelT } | { ok: false; reason: string };

export function fillQuantity(model: CanonicalModelT, quantityId: string, answer: Answer, quote: string): FillResult {
  const i = model.quantities.findIndex((q) => q.id === quantityId);
  if (i < 0) return fillInline(model, quantityId, answer, quote);
  const old = model.quantities[i];
  if (old.status === 'derived') return { ok: false, reason: `"${old.label}" is worked out by its relation; answer one of its inputs.` };
  if (quote.trim() === '') return { ok: false, reason: 'An answer needs the person\'s own words.' };
  const value = answer.value ?? null;
  if (answer.low != null && answer.high != null && answer.low > answer.high) return { ok: false, reason: `The low end ${answer.low} is above the high end ${answer.high}.` };
  // A range is theirs only when their words state both ends; "about £2,000" is their figure, with no range read into it.
  const stated = answer.low != null && answer.high != null && statesEnds(quote, answer.low, answer.high);
  const low = stated ? answer.low! : null;
  const high = stated ? answer.high! : null;
  if (value === null && low === null) return { ok: false, reason: answer.low != null ? 'Their words do not state that range; ask for the figure or the range in their words.' : 'An answer needs a figure, or both ends of a range.' };
  const range_kind = 'range_kind' in answer && answer.range_kind ? answer.range_kind : null;
  const approximate = low === null && APPROXIMATE_WORDS.test(quote);
  const filled = { ...old, value, low, high, range_kind: low !== null ? range_kind : null, status: 'known' as const, author: 'person' as const, party: null, quote, question: null,
    basis: approximate ? APPROXIMATE_FIGURE : null, approval: 'approved' as const };
  const quantities = [...model.quantities];
  quantities[i] = filled;
  return { ok: true, model: { ...model, quantities, history: [...model.history, { id: quantityId, change: 'superseded', old: JSON.stringify(old), quote, author_id: null }] } };
}

/** An option's own inline value is asked under its compiled id (`inlineQuantityId`): the answer fills that one setting. */
function fillInline(model: CanonicalModelT, quantityId: string, answer: Answer, quote: string): FillResult {
  for (const [oi, o] of model.options.entries()) {
    const si = o.sets.findIndex((s) => s.to === null && inlineQuantityId(o.id, s.quantity) === quantityId);
    if (si < 0) continue;
    if (quote.trim() === '') return { ok: false, reason: 'An answer needs the person\'s own words.' };
    const low = answer.low ?? null;
    const high = answer.high ?? null;
    const value = answer.value ?? null;
    if (low !== null && high !== null && low > high) return { ok: false, reason: `The low end ${low} is above the high end ${high}.` };
    if (value === null && (low === null || high === null)) return { ok: false, reason: 'An answer needs a figure, or both ends of a range.' };
    const old = o.sets[si];
    const sets = [...o.sets];
    sets[si] = { ...old, value, low, high, range_kind: low !== null && 'range_kind' in answer && answer.range_kind ? answer.range_kind : null, question: null, author: 'person', quote };
    const options = [...model.options];
    options[oi] = { ...o, sets };
    return { ok: true, model: { ...model, options, history: [...model.history, { id: o.id, change: 'superseded', old: JSON.stringify(o), quote, author_id: null }] } };
  }
  return { ok: false, reason: `"${quantityId}" is not a quantity in the model.` };
}

/** The answer to an UNRESOLVED range reading (PL ruling B): the person says whether their range's ends are hard. One edit. */
export function setRangeKind(model: CanonicalModelT, quantityId: string, kind: 'bounds' | 'plausible', quote: string): FillResult {
  const i = model.quantities.findIndex((q) => q.id === quantityId);
  if (i < 0) return { ok: false, reason: `"${quantityId}" is not a quantity in the model.` };
  const old = model.quantities[i];
  if (old.low === null || old.high === null) return { ok: false, reason: `"${old.label}" has no range to read.` };
  const quantities = [...model.quantities];
  quantities[i] = { ...old, range_kind: kind };
  return { ok: true, model: { ...model, quantities, history: [...model.history, { id: quantityId, change: 'superseded', old: JSON.stringify(old), quote, author_id: null }] } };
}

/**
 * GIVING AN AIM ITS MEASURE (DL 23 Oct): the person's answer to "what does success mean, how do you measure it?" is ONE edit
 * on ONE goal with no measure yet, in their words: the quantity it is about (one already in the model, or a new one they
 * named, theirs), how it is compared, its target and its window. Nothing is inferred: a target or a deadline their words do
 * not state stays asked (the target an asked quantity; the window left for the compiler's "By when?"), and a figure is
 * theirs only when their words state it. A new measured quantity is theirs but nothing works it out yet, so the aim is
 * held, saying so, until the model says how the options change it.
 */
export type GoalMeasureAnswer = {
  readonly goal_id: string;
  readonly quantity: string | { readonly label: string; readonly unit: string };
  readonly cmp: '>=' | '>' | '<=' | '<';
  readonly frame: 'level' | 'change_abs' | 'change_rel' | null;
  /** Their figure, or the id of a quantity that already holds the target they stated (a brief's "at least 10%"). */
  readonly target: string | { readonly value: number | null; readonly low: number | null; readonly high: number | null; readonly range_kind: 'bounds' | 'plausible' | null } | null;
  /** How many periods, or the id of a quantity that already holds the deadline they stated. */
  readonly window: { readonly periods: number | string; readonly start: number } | null;
  readonly quote: string;
};
type Quantity = CanonicalModelT['quantities'][number];

export function defineGoalMeasure(model: CanonicalModelT, a: GoalMeasureAnswer): FillResult {
  const g = model.goals.find((x) => x.id === a.goal_id);
  if (g === undefined) return { ok: false, reason: `"${a.goal_id}" is not a goal in the model.` };
  if (g.measure !== null) return { ok: false, reason: `"${g.label}" already has a measure; change its target instead.` };
  if (a.quote.trim() === '') return { ok: false, reason: 'A measure needs the person\'s own words.' };
  const taken = new Set([...model.quantities.map((q) => q.id), ...model.goals.map((x) => x.id), ...model.limits.map((l) => l.id), ...model.options.map((o) => o.id)]);
  const fresh = (base: string) => { let id = base; for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`; taken.add(id); return id; };
  const theirs = (id: string, label: string, unit: string, f: Partial<Quantity>): Quantity => ({ id, label, unit, kind: 'fact', value: null, low: null, high: null,
    range_kind: null, status: 'known', question: null, basis: null, author: 'person', party: null, quote: a.quote, approval: 'approved', author_id: null, ...f });
  const added: Quantity[] = [];

  let measured: { id: string; label: string; unit: string };
  if (typeof a.quantity === 'string') {
    const q = model.quantities.find((x) => x.id === a.quantity);
    if (q === undefined) return { ok: false, reason: `"${a.quantity}" is not a quantity in the model.` };
    if (q.status === 'asked') return { ok: false, reason: `"${q.label}" is still a question: an aim measures a figure the model holds or works out, never the result asked for.` };
    measured = { id: q.id, label: q.label, unit: q.unit };
  } else {
    const label = a.quantity.label.trim();
    if (label === '' || !parseUnit(a.quantity.unit).ok) return { ok: false, reason: 'A new measure needs a name and a unit.' };
    measured = { id: fresh(label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(?=[0-9]|$)/, 'm_')), label, unit: a.quantity.unit };
    added.push(theirs(measured.id, label, measured.unit, { status: 'unknown', basis: 'You named this as how the aim is measured; nothing in the model works it out yet.' }));
  }

  const frame = a.frame ?? 'level';
  const t = a.target;
  // A target or deadline already in the model is used as it stands, only when it is the person's (never Olumi's figure).
  const notTheirs = (id: string, what: string): string | null => {
    const q = model.quantities.find((x) => x.id === id);
    return q === undefined ? `"${id}" is not a quantity in the model.` : q.author !== 'person' || q.status === 'derived' ? `"${q.label}" is not a ${what} the person stated.` : null;
  };
  const refusal = (typeof t === 'string' ? notTheirs(t, 'target') : null) ?? (typeof a.window?.periods === 'string' ? notTheirs(a.window.periods, 'deadline') : null);
  if (refusal !== null) return { ok: false, reason: refusal };
  const targetId = typeof t === 'string' ? t : fresh(`${g.id}_target`);
  const targetUnit = frame === 'change_rel' ? '%' : measured.unit;
  // Each figure is theirs only as written for its own quantity: the target in the target's unit, the deadline in periods.
  const stated = (x: number) => writesAs(a.quote, x, targetUnit, measured.label);
  const targetLabel = `Target for ${measured.label}`;
  if (t === null) {
    added.push(theirs(targetId, targetLabel, targetUnit, { status: 'asked', quote: null, question: `What figure for "${measured.label}" would count as "${g.label}"?` }));
  } else if (typeof t === 'string') {
    // Their target as it stands in the model.
  } else if (t.low !== null && t.high !== null) {
    if (t.low > t.high) return { ok: false, reason: `The low end ${t.low} is above the high end ${t.high}.` };
    if (!stated(t.low) || !stated(t.high)) return { ok: false, reason: 'Their words do not state that target range; leave the target out and it is asked.' };
    added.push(theirs(targetId, targetLabel, targetUnit, { value: t.value !== null && stated(t.value) ? t.value : null, low: t.low, high: t.high, range_kind: t.range_kind }));
  } else if (t.value !== null) {
    if (!stated(t.value)) return { ok: false, reason: 'Their words do not state that target; leave the target out and it is asked.' };
    added.push(theirs(targetId, targetLabel, targetUnit, { value: t.value }));
  } else return { ok: false, reason: 'A target needs a figure, or both ends of a range; leave it out and it is asked.' };

  let window: NonNullable<CanonicalModelT['goals'][number]['measure']>['window'] = null;
  const span = a.window?.periods;
  if (a.window !== null && typeof span === 'string') {
    window = { origin_event: null, origin_offset: null, start: a.window.start, periods: span };
  } else if (a.window !== null && typeof span === 'number') {
    if (!writesAs(a.quote, span, model.period)) return { ok: false, reason: `Their words do not state that deadline in ${model.period}s; leave the window out and "By when?" is asked.` };
    const periods = fresh(`${g.id}_window`);
    added.push(theirs(periods, `Time to meet ${g.label}`, model.period, { value: span }));
    window = { origin_event: null, origin_offset: null, start: a.window.start, periods };
  }
  const measure = { quantity: measured.id, per: null, cmp: a.cmp, target: targetId, frame, reference: frame === 'level' ? null : { kind: 'now' as const, option: null, quantity: null },
    aggregation: 'end' as const, window, measure_by: 'person' as const, assumptions: [], exclusions: [] };
  return { ok: true, model: { ...model, quantities: [...model.quantities, ...added],
    goals: model.goals.map((x) => (x.id === g.id ? { ...g, measure, question: null, approval: 'approved' as const } : x)),
    history: [...model.history, { id: g.id, change: 'superseded', old: JSON.stringify(g), quote: a.quote, author_id: null }] } };
}

/**
 * COMPLETING A MEASURE'S MECHANISM (DL 23 Oct): once the person has said how an aim is measured, Olumi's drafter may propose
 * what works that measure out. From the drafter's whole model only ADDITIONS are taken, and only of kinds Olumi may author:
 * its own coefficients (estimated, with a range and a basis), worked-out quantities, structural constants bound to their
 * meaning (`structuralIn`; any other "structure" figure becomes a question), and figures only the person can know as QUESTIONS (asked, no
 * figure); new relations that work out the measure or a new worked-out quantity; and their companion assumptions and
 * conditions, with the claims and evidence those name. Each is Olumi's unless its words are the person's. Only the measure
 * this same edit created (`fresh`) may become worked out: a quantity already in the model keeps its figure, kind and status.
 * Every existing record, its author and the history stay as they are. Refused whole (the measure stays as named, with its
 * asks) when the drafter invents a person's figure, redefines what the model already works out, or no option's setting
 * reaches the measure; what the compiler refuses (a note naming a record that is not there, a constant that is not
 * structural) is refused by the caller's compile.
 */
type Relation = CanonicalModelT['relations'][number];
/** What a relation works its quantity out from: its parts, its base, drivers and coefficients, or a stock's start and flows. */
const inputsOf = (r: Relation): string[] => (r.form === 'definition' ? r.parts.map((p) => p.id) : r.form === 'effect' ? [r.base, ...r.terms.flatMap((t) => [t.driver, t.coefficient])] : [r.start, ...r.inflows, ...r.outflows]);
/** Every record id a note's `concerns` may name, effect terms included (`relation_id:driver`). */
const recordIds = (m: CanonicalModelT): Set<string> => new Set([...m.quantities, ...m.goals, ...m.limits, ...m.preferences, ...m.options, ...m.risks,
  ...m.claims, ...m.evidence, ...m.assumptions, ...m.dissent, ...m.conditions, ...m.left_out].map((r) => r.id)
  .concat(m.relations.flatMap((r) => [r.id, ...(r.form === 'effect' ? r.terms.map((t) => `${r.id}:${t.driver}`) : [])])));

/**
 * A structural constant Olumi may add (Codex r4 #3709): one bound to its meaning, never a figure that only looks like one. A
 * calendar conversion (12 month/year), a power of ten that IS a unit's scale (100 %, 1000 g/kg: the constant times its unit
 * is exactly 1), or 0 or 1 on a quantity a live option switches. Anything else labelled structure ("current output = 12")
 * is a figure only the person can give, so it comes back as their question.
 */
function structuralIn(model: CanonicalModelT, q: Quantity): boolean {
  const u = parseUnit(q.unit);
  if (q.status !== 'known' || q.value === null || q.low !== null || q.high !== null || !u.ok) return false;
  const v = q.value;
  const unitScale = Object.keys(u.unit.dims).length === 0 && isPowerOfTen(v) && Math.abs(v * u.unit.scale - 1) < 1e-9;
  const optionSwitch = (v === 0 || v === 1) && model.options.some((o) => o.status === 'live' && o.sets.some((s) => s.quantity === q.id));
  return isCalendarConversion(v, u.unit) || unitScale || optionSwitch;
}
const askedOf = (q: Quantity): Quantity => ({ ...q, kind: 'fact', status: 'asked', author: 'person', value: null, low: null, high: null, range_kind: null, basis: null,
  quote: null, question: `What is "${q.label}"?`, approval: 'proposed' });

export function addMechanism(model: CanonicalModelT, draft: CanonicalModelT, measured: string, fresh: ReadonlySet<string>, isTheirs: (quote: string | null) => boolean): FillResult {
  const target = model.quantities.find((q) => q.id === measured);
  // Only the blank placeholder this same answer created (status unknown, no figure): never a figure they stated, new or old.
  if (target === undefined || !fresh.has(measured) || target.status !== 'unknown' || target.value !== null || target.low !== null || target.high !== null) {
    return { ok: false, reason: 'Only a measure named in this same answer can be worked out by Olumi\'s proposal.' };
  }
  if (model.relations.some((r) => r.defines === measured)) return { ok: false, reason: 'The measure is already worked out.' };
  const known = new Set(model.quantities.map((q) => q.id));
  const added: Quantity[] = [];
  for (const q of draft.quantities.filter((x) => !known.has(x.id))) {
    const blank = q.value === null && q.low === null && q.high === null;
    if (q.kind === 'coefficient' && q.status === 'estimated' && q.low !== null && q.high !== null && (q.basis ?? '').trim() !== '') added.push({ ...q, author: 'olumi', quote: null, approval: 'proposed' });
    else if (q.status === 'derived' && blank) added.push({ ...q, author: 'olumi', quote: null, approval: 'proposed' });
    else if (q.author === 'structure') added.push(structuralIn(model, q) ? { ...q, quote: null, approval: 'proposed' } : askedOf(q));
    else if (q.status === 'asked' && blank && (q.question ?? '').trim() !== '') added.push({ ...q, author: 'person', quote: null, approval: 'proposed' });
    else return { ok: false, reason: `Olumi cannot add "${q.label}" as it was drafted: a figure only the person can give is asked, never estimated.` };
  }
  const ids = new Set([...known, ...added.map((q) => q.id)]);
  const defined = new Set(model.relations.map((r) => r.defines));
  const own = new Set([measured, ...added.filter((q) => q.status === 'derived').map((q) => q.id)]);
  const relations = draft.relations.filter((r) => !model.relations.some((x) => x.id === r.id));
  for (const r of relations) {
    if (!own.has(r.defines) || defined.has(r.defines) || !inputsOf(r).every((u) => ids.has(u))) return { ok: false, reason: `Olumi's relation "${r.id}" does not only work out the measure from what the model holds.` };
    defined.add(r.defines);
  }
  if (!relations.some((r) => r.defines === measured)) return { ok: false, reason: 'Olumi proposed nothing that works the measure out.' };
  const olumis = <T extends { author: string; quote: string | null }>(x: T): T => (x.author === 'person' && isTheirs(x.quote) ? x : { ...x, author: 'olumi', quote: null });
  const proposed = (r: Relation): Relation => (r.form === 'effect'
    ? { ...olumis(r), approval: 'proposed', terms: r.terms.map((t) => ({ ...olumis(t), approval: 'proposed' as const })) } : { ...olumis(r), approval: 'proposed' });
  const newRelations = relations.map(proposed);
  // Reached: some option's setting is upstream of the measure, so the options can differ on it.
  const by = new Map([...model.relations, ...newRelations].map((r) => [r.defines, r] as const));
  const upstream = new Set<string>();
  const walk = (id: string) => {
    if (upstream.has(id)) return;
    upstream.add(id);
    const r = by.get(id);
    if (r !== undefined) inputsOf(r).forEach(walk);
  };
  walk(measured);
  if (!model.options.some((o) => o.status === 'live' && o.sets.some((s) => upstream.has(s.quantity)))) return { ok: false, reason: 'What Olumi proposed does not connect any option to the measure.' };
  // The new relations' companion notes, never dropped: every NEW assumption, condition, claim or evidence linked to what is
  // added, to closure (a condition on a claim about a new relation; the evidence a carried note names). Old records stay as
  // they are; nothing unrelated is taken.
  const before = recordIds(model);
  const linked = new Set([...added.map((q) => q.id), ...newRelations.flatMap((r) => [r.id, ...(r.form === 'effect' ? r.terms.map((t) => `${r.id}:${t.driver}`) : [])]), measured]);
  const candidates = [...draft.assumptions, ...draft.conditions, ...draft.claims, ...draft.evidence].filter((x) => !before.has(x.id));
  const carried = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const x of candidates) {
      if (carried.has(x.id) || !(x.concerns.some((c) => linked.has(c)) || linked.has(x.id))) continue;
      carried.add(x.id); linked.add(x.id); x.concerns.forEach((c) => { if (!before.has(c)) linked.add(c); });
      grew = true;
    }
  }
  const pick = <T extends { id: string }>(xs: readonly T[]) => xs.filter((x) => carried.has(x.id));
  const assumptions = pick(draft.assumptions), conditions = pick(draft.conditions), claims = pick(draft.claims), evidence = pick(draft.evidence);
  const note = <T extends { author: string; quote: string | null }>(x: T): T => ({ ...olumis(x), approval: 'proposed' as const });
  const worked: Quantity = { ...target, kind: 'derived', status: 'derived', value: null, low: null, high: null, range_kind: null, basis: null };
  return { ok: true, model: { ...model, quantities: [...model.quantities.map((q) => (q.id === measured ? worked : q)), ...added],
    relations: [...model.relations, ...newRelations],
    assumptions: [...model.assumptions, ...assumptions.map(note)], conditions: [...model.conditions, ...conditions.map(note)],
    claims: [...model.claims, ...claims.map(note)], evidence: [...model.evidence, ...evidence.map(note)],
    history: [...model.history, { id: measured, change: 'superseded', old: JSON.stringify(target), quote: null, author_id: null }] } };
}
