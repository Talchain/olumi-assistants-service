/**
 * ⭐ STEP 8 (PLAN-TODAY 19 Oct): `candidateToGraph`, the path-B draft adapter's PURE conversion. The drafter's strict JSON becomes
 * a valid GraphV3 through the existing science (units, frames, link sizing, the goal level's scale and direction, sums, the
 * declared status quo, the refit chain), and NOTHING ELSE: no unattested-goal refusal, no authorship binding, no range
 * eligibility, no demotion. Each figure keeps the origin the AI declared, read back through the one provenance authority;
 * the raw draft travels beside the graph verbatim. A (`admitCandidateModel`) is untouched and still gates.
 *
 * SYNTHETIC wording throughout (a board-game maker; another domain from any served brief). 0 provider calls.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { candidateToAdmittedGraph, candidateToGraph } from '../candidate-to-graph.js';
import { admitCandidateModel, admitOrdinaryCandidateModel, canonicalLabel } from '../../../agent-lane/admit-model.js';
import { prepareProvisionalCandidate } from '../../../agent-lane/runtime/build-model.js';
import { linkProvenanceOf, settingProvenanceOf, valueProvenanceOf } from '../../../../cee/provenance/provenance-of.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

type Rec = Record<string, any>;

// The dated-dilemma SHAPE: an unattested dated event as the goal and no aim stated, two stated options, figures from the user,
// from a named third party and from an unclear source, risks, no link into the goal.
const S = [
  'Our board game is meant to ship before the winter holidays.',
  'The printer told us the new card stock takes at least 5 weeks to arrive.',
  'We need 3 weeks to pack and post the pre-orders.',
  'Apparently around 40 backers would cancel if we slip.',
  'If we delay we miss the holiday sales, but if we ship with the old card stock the cards may warp.',
  'Should we delay the launch or ship with the old card stock?',
];
const BRIEF = S.join(' ');
const SHIPPED = 'Board game shipped before the holidays';
const link = (from: string, to: string, direction: string, quote: string | null = null, size: Rec = {}): Rec => ({ from, to, direction,
  provenance: quote === null ? 'ai_proposed' : 'explicit', effect_amount: null, effect_per_source_change: null, effect_provenance: null,
  definitional: null, basis: null, source_quote: quote, ...size });
const statement = (quote: string, label: string, speaker: 'user' | 'other' | 'unknown', value: number, unit: string, form = 'point'): Rec => ({
  quote, subject: { kind: 'factor', label, to_label: null, factor_label: null }, field: 'level', form, value, low: null, high: null, unit,
  qualifier: form === 'lower_bound' ? 'at least' : null, conditions: null, speaker });
const factor = (label: string, value: number | null, unit: string | null, provenance: string, quote: string | null = null): Rec => ({
  label, role: 'external', baseline_known: value !== null && provenance === 'explicit', baseline_value: value,
  baseline_evidence: quote === null ? null : { quote }, unit, provenance, plausible_max: null });
const dilemmaDraft = (): Rec => ({
  goal: { kind: 'event_by_date', deliverable: 'board game shipment', metric: SHIPPED, operator: '>=', target_stated: false, value: null,
    unit: '', horizon_months: null, provenance: 'inferred', frame: 'level', baseline_known: false, baseline_value: null,
    baseline_provenance: 'inferred', scope: null, quantity_frame: 'level', basis: null, source_quote: S[0] },
  constraints: [],
  options: [
    { label: 'Delay the launch', provenance: 'explicit', changes: ['Launch timing'], interventions: [], added_capacity: null, is_status_quo: null },
    { label: 'Ship with the old card stock', provenance: 'explicit', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
  ],
  factors: [
    factor('Card stock lead time', 5, 'weeks', 'explicit', S[1]),
    factor('Packing time', 3, 'weeks', 'explicit', S[2]),
    factor('Backer cancellations', 40, 'backers', 'explicit', S[3]),
    { ...factor('Launch timing', null, null, 'inferred'), role: 'controllable' },
  ],
  risks: ['Missed holiday sales', 'Warped cards'].map((label) => ({ label, provenance: 'explicit', unit: null, plausible_max: null, already_true_evidence: null })),
  outcomes: [],
  links: [link('Launch timing', 'Missed holiday sales', 'positive', S[4]), link('Card stock lead time', 'Launch timing', 'positive')],
  identities: [], unknowns: ['When do the winter holidays start for the backers?'], decision_question: S[5], unknown_concerns: [],
  statements: [statement(S[1]!, 'Card stock lead time', 'other', 5, 'weeks', 'lower_bound'), statement(S[2]!, 'Packing time', 'user', 3, 'weeks'),
    statement(S[3]!, 'Backer cancellations', 'unknown', 40, 'backers')],
});

// A level goal with a stated target and today's level, a framed lever, a stated size, an addition and a declared status quo.
const AD_QUOTE = 'Every £20 of ads brings about one pre-order.';
const salesDraft = (size: 'olumi' | 'user' = 'olumi'): Rec => ({
  goal: { kind: null, deliverable: null, metric: 'Monthly pre-orders', operator: '>=', target_stated: true, value: 600, unit: 'orders',
    horizon_months: 6, provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 400, baseline_provenance: 'explicit',
    scope: null, quantity_frame: 'level', basis: null, source_quote: 'We want 600 pre-orders a month within six months; we get 400 now.' },
  constraints: [],
  options: [
    { label: 'Double the ad spend', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Ad spend', value: 4000, value_kind: 'absolute', unit: '£', provenance: 'explicit', stated_evidence: null }] },
    { label: 'Add £1,000 of ad spend', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Ad spend', value: 1000, value_kind: 'additional', unit: '£', provenance: 'explicit', stated_evidence: null }] },
    { label: 'Keep spending as now', provenance: 'explicit', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
  ],
  factors: [{ label: 'Ad spend', role: 'controllable', baseline_known: true, baseline_value: 2000, unit: '£', provenance: 'explicit',
    plausible_max: 10000, baseline_evidence: { quote: 'We spend £2,000 a month on ads.' } }],
  risks: [], outcomes: [],
  links: [link('Ad spend', 'Monthly pre-orders', 'positive', size === 'user' ? AD_QUOTE : null,
    { effect_amount: 1, effect_per_source_change: 20, effect_provenance: size === 'user' ? 'explicit' : 'ai_proposed' })],
  identities: [], unknowns: [], decision_question: 'How should we change our ad spend?', unknown_concerns: [], statements: [],
});

// Structure A shapes itself: a loop between two factors, a limit, a later ambition (A restates that node's label, keeping its id),
// and a factor with no level today whose range A carries as its node's scale_frame.
const structureDraft = (): Rec => ({
  ...salesDraft(),
  constraints: [{ metric: 'Ad spend', operator: '<=', value: 5000, unit: '£', provenance: 'explicit', frame: 'level', role: 'limit' },
    { metric: 'Word of mouth', operator: '>=', value: 200, unit: 'mentions', provenance: 'explicit', frame: 'level', role: 'ambition' }],
  factors: [...salesDraft().factors, factor('Word of mouth', 50, 'mentions', 'explicit'), { ...factor('Influencer posts', null, 'posts', 'inferred'), plausible_max: 40 }],
  links: [...salesDraft().links, link('Ad spend', 'Word of mouth', 'positive', null, { effect_amount: 1, effect_per_source_change: 100, effect_provenance: 'ai_proposed' }),
    link('Word of mouth', 'Ad spend', 'positive'), link('Word of mouth', 'Monthly pre-orders', 'positive', null, { effect_amount: 1, effect_per_source_change: 5, effect_provenance: 'ai_proposed' }),
    link('Influencer posts', 'Monthly pre-orders', 'positive', null, { effect_amount: 10, effect_per_source_change: 1, effect_provenance: 'ai_proposed' })],
});

// A goal the AI declared to be two parts added together, with the sentence it read it from.
const sumDraft = (totalToday: number, definedBy: 'olumi' | 'user' = 'olumi'): Rec => ({
  ...salesDraft(),
  goal: { ...salesDraft().goal, metric: 'Total orders', baseline_value: totalToday },
  options: [{ label: 'Open a market stall', provenance: 'explicit', changes: ['Shop orders'], interventions: [], added_capacity: null, is_status_quo: null }],
  factors: [
    { label: 'Online orders', role: 'observable', baseline_known: true, baseline_value: 300, unit: 'orders', provenance: 'explicit', plausible_max: null },
    { label: 'Shop orders', role: 'observable', baseline_known: true, baseline_value: 100, unit: 'orders', provenance: 'explicit', plausible_max: null },
  ],
  links: ['Online orders', 'Shop orders'].map((part) => link(part, 'Total orders', 'positive', null,
    { provenance: definedBy === 'user' ? 'explicit' : 'ai_proposed', effect_amount: 1, effect_per_source_change: 1,
      effect_provenance: definedBy === 'user' ? 'explicit' : 'ai_proposed', definitional: true })),
  identities: [{ operation: 'sum', outcome: 'Total orders', factors: ['Online orders', 'Shop orders'],
    evidence: { quote: 'All our orders come either online or from the shop.' } }],
});

// STRUCTURE SCIENCE (DL 19 Oct): a declared product, a lever no option reaches, Olumi's unlinked unsized risk beside the user's,
// a factor → risk link that re-draws the factor's own direct link, two of Olumi's options alike as drafted, and a declared status quo.
const sciOption = (label: string, provenance: string, ivs: Rec[] = [], changes: string[] = [], sq: boolean | null = null): Rec =>
  ({ label, provenance, changes, interventions: ivs, added_capacity: null, is_status_quo: sq });
const sciLevel = (factor_label: string, value: number, unit: string): Rec => ({ factor_label, value, value_kind: 'absolute', unit, provenance: 'explicit', stated_evidence: null });
const scienceDraft = (opts: { userFold?: boolean; otherFold?: boolean; undeclaredStatusQuo?: boolean; otherRisk?: boolean } = {}): Rec => ({
  goal: { kind: null, deliverable: null, metric: 'Monthly revenue', operator: '>=', target_stated: true, value: 30000, unit: '£', horizon_months: 6,
    provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 20000, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level', basis: null },
  constraints: [{ metric: 'Monthly churn', operator: '<=', value: 10, unit: '%', provenance: 'explicit', frame: 'level', role: 'limit' }],
  identities: [{ operation: 'product', outcome: 'Monthly revenue', factors: ['Price', 'Customers'], provenance: 'inferred', evidence: null }],
  options: [sciOption('Raise the price', 'explicit', [sciLevel('Price', 25, '£')]), sciOption('Run a referral scheme', 'explicit', [sciLevel('Customers', 1200, 'customers')]),
    sciOption('Promote more', 'inferred', [], ['Customers']), sciOption('Advertise more', 'inferred', [], ['Customers']),
    sciOption('Status quo', 'explicit', [], [], opts.undeclaredStatusQuo === true ? null : true)],
  factors: [{ ...factor('Price', 20, '£', 'explicit'), role: 'controllable', plausible_max: 50 }, { ...factor('Customers', 1000, 'customers', 'explicit'), role: 'controllable', plausible_max: 3000 },
    { ...factor('Brand awareness', 30, '%', 'explicit'), role: 'controllable', plausible_max: 100 }],
  risks: [{ label: 'Competitor price cut', provenance: 'ai_proposed' }, { label: 'Key supplier failure', provenance: opts.otherRisk === true ? 'inferred' : 'explicit' },
    { label: 'Churn spike', provenance: 'ai_proposed' }],
  outcomes: [{ label: 'Monthly churn', provenance: 'inferred' }],
  links: [link('Price', 'Monthly revenue', 'positive'), link('Customers', 'Monthly revenue', 'positive'), link('Brand awareness', 'Customers', 'positive'),
    { ...link('Price', 'Churn spike', 'positive'), ...(opts.userFold === true || opts.otherFold === true ? { provenance: 'explicit' } : {}) },
    link('Churn spike', 'Customers', 'negative'), link('Price', 'Customers', 'negative'), link('Monthly churn', 'Customers', 'negative')],
  unknowns: [], decision_question: 'How do we grow revenue?', unknown_concerns: [],
  statements: [...(opts.otherRisk === true ? [{ quote: 'Our buyer warns a key supplier could fail.', subject: { kind: 'risk', label: 'Key supplier failure', to_label: null,
    factor_label: null }, field: 'level', form: 'point', value: null, low: null, high: null, unit: null, qualifier: null, conditions: null, speaker: 'other' }] : []),
  ...(opts.otherFold === true ? [{ quote: 'Our analyst says higher prices cause churn spikes.', subject: { kind: 'link', label: 'Price', to_label: 'Churn spike',
    factor_label: null }, field: 'relation', form: 'point', value: null, low: null, high: null, unit: null, qualifier: null, conditions: null, speaker: 'other' }] : [])],
});

// ROUTE A (`goal-definition-sum.ts`): a lever the options set, 0 today, declared as the complete net change in the goal's own quantity.
const definitionDraft = (): Rec => ({
  goal: { kind: null, deliverable: null, metric: 'Orders per day', operator: '>=', target_stated: true, value: 120, unit: 'orders per day', horizon_months: null,
    provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 80, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level', basis: null },
  constraints: [], identities: [],
  options: [sciOption('Keep as now', 'ai_proposed', [], [], true), sciOption('Add a night shift', 'explicit', [sciLevel('Net change in orders per day', 30, 'orders per day')]),
    sciOption('Open a second line', 'explicit', [sciLevel('Net change in orders per day', 50, 'orders per day')])],
  factors: [{ ...factor('Net change in orders per day', 0, 'orders per day', 'inferred'), role: 'controllable', baseline_known: true }],
  risks: [], outcomes: [],
  links: [link('Net change in orders per day', 'Orders per day', 'positive', null, { effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: true })],
  unknowns: [], decision_question: 'How do we reach 120 orders a day?', unknown_concerns: [], statements: [],
});

// A's admission with no brief: the build's preparation, then admission with the brief `undefined` (the path-B door's call).
const admitA = (c: Rec): Rec => {
  try { return admitCandidateModel(c as never, {}, undefined) as never; } catch { return admitOrdinaryCandidateModel(c as never, {}, undefined) as never; }
};
/** A on the DRAFTED names (what B does not take where A reads a name): the contrast for the label-blind rows. */
const aOnDraftedNames = (draft: Rec): Rec => admitA(prepareProvisionalCandidate(draft as never).candidate as never);
const converted = (draft: Rec): { graph: Rec; declared: Rec; loss: Rec[]; blocked_schema: Rec[] } => {
  const out = candidateToGraph(draft);
  if ('refused' in out) throw new Error(`refused: ${out.refused}`);
  return out as unknown as { graph: Rec; declared: Rec; loss: Rec[]; blocked_schema: Rec[] };
};
const byLabel = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((n) => n.label === label)!;
const ofKind = (g: Rec, kind: string): Rec[] => (g.nodes as Rec[]).filter((n) => n.kind === kind);
const edge = (g: Rec, from: string, to: string): Rec | undefined =>
  (g.edges as Rec[]).find((e) => e.from === byLabel(g, from).id && e.to === byLabel(g, to).id);

/** Whose the AI declared an entity or link to be (the spec of B's rule): a speaker other/unknown wins; else explicit = the user's,
 * ai_proposed = Olumi's, and inferred (the drafter's contract: a reformulation of supplied material, or unresolved) = unknown. */
const declaredWho = (draft: Rec, kind: string, label: string, provenance: unknown, field = 'level'): string => {
  const st = ((draft.statements ?? []) as Rec[]).find((x) => x?.subject?.kind === kind && x?.field === field
    && canonicalLabel(String(x.subject.label ?? '')) === canonicalLabel(label));
  return st?.speaker === 'other' || st?.speaker === 'unknown' ? st.speaker : provenance === 'explicit' ? 'user' : provenance === 'ai_proposed' ? 'olumi' : 'unknown';
};

/**
 * ⛔ LABEL-BLINDNESS (#3464 R2, DL 19 Oct: no verdict B takes from A may read a name or the brief's words). The draft with every
 * name, quote and free-text field renamed to a neutral word — the same canonical name → the same word, so every identity A and B
 * bind by name still holds. Written here, apart from the converter's own `labelBlind`. `back` reads a line back in the draft's names.
 */
function renamed(d: Rec): { draft: Rec; back: (line: string) => string } {
  const map = new Map<string, string>();
  const word = (text: unknown): unknown => {
    if (typeof text !== 'string' || text.trim() === '') return text;
    if (!map.has(canonicalLabel(text))) {
      let letters = ''; for (let i = 0, x = map.size; i < 4; i++, x = Math.floor(x / 26)) letters = String.fromCharCode(97 + (x % 26)) + letters;
      map.set(canonicalLabel(text), `Qzv${letters}`);
    }
    return map.get(canonicalLabel(text));
  };
  const words = (v: unknown): unknown => (Array.isArray(v) ? v.map(word) : v);
  const ev = (e: Rec | null | undefined): Rec | null | undefined => (e ? { ...e, ...('quote' in e ? { quote: word(e.quote) } : {}), ...('option_quote' in e ? { option_quote: word(e.option_quote) } : {}) } : e);
  [d.goal?.metric, ...['factors', 'options', 'risks', 'outcomes'].flatMap((k) => ((d[k] ?? []) as Rec[]).map((x) => x?.label))].forEach(word);
  const r: Rec = structuredClone(d);
  if (r.goal) {
    for (const k of ['metric', 'deliverable', 'source_quote', 'deadline_words']) if (k in r.goal) r.goal[k] = word(r.goal[k]);
    if (r.goal.basis) r.goal.basis = { ...r.goal.basis, denominator: word(r.goal.basis.denominator), open_question: word(r.goal.basis.open_question), also_required: words(r.goal.basis.also_required) };
    if (r.goal.scope) r.goal.scope = { ...r.goal.scope, modelled: word(r.goal.scope.modelled), alternative: word(r.goal.scope.alternative) };
  }
  r.constraints = (r.constraints ?? []).map((c: Rec) => ({ ...c, metric: word(c.metric) }));
  r.factors = (r.factors ?? []).map((f: Rec) => ({ ...f, label: word(f.label), baseline_evidence: ev(f.baseline_evidence) }));
  r.risks = (r.risks ?? []).map((x: Rec) => ({ ...x, label: word(x.label), already_true_evidence: ev(x.already_true_evidence) }));
  r.outcomes = (r.outcomes ?? []).map((x: Rec) => ({ ...x, label: word(x.label) }));
  r.options = (r.options ?? []).map((o: Rec) => ({ ...o, label: word(o.label), changes: words(o.changes),
    interventions: Array.isArray(o.interventions) ? o.interventions.map((iv: Rec) => ({ ...iv, factor_label: word(iv.factor_label), stated_evidence: ev(iv.stated_evidence) })) : o.interventions }));
  r.links = (r.links ?? []).map((l: Rec) => ({ ...l, from: word(l.from), to: word(l.to), source_quote: word(l.source_quote), ...('basis' in l ? { basis: word(l.basis) } : {}) }));
  r.identities = (r.identities ?? []).map((i: Rec) => ({ ...i, outcome: word(i.outcome), factors: words(i.factors), evidence: ev(i.evidence) }));
  if (Array.isArray(r.statements)) r.statements = r.statements.map((st: Rec) => ({ ...st, quote: word(st.quote), conditions: word(st.conditions),
    subject: st.subject ? { ...st.subject, label: word(st.subject.label), to_label: word(st.subject.to_label), factor_label: word(st.subject.factor_label) } : st.subject }));
  if (Array.isArray(r.unknown_concerns)) r.unknown_concerns = r.unknown_concerns.map((u: Rec) => ({ ...u, unknown: word(u.unknown), concerns: words(u.concerns) }));
  if (Array.isArray(r.unknowns)) r.unknowns = r.unknowns.map(word);
  if ('decision_question' in r) r.decision_question = word(r.decision_question);
  const nameOf = new Map([...map].map(([name, w]) => [canonicalLabel(w), name] as const));
  return { draft: r, back: (line) => line.replace(/qzv[a-z]{4}/gi, (m) => nameOf.get(m.toLowerCase()) ?? m) };
}

/** B's converted graph as flat `field → value` lines, each node named by `nameOf` (the same lines for the same model under any names). */
function graphLines(out: Rec, nameOf: (canonical: string) => string): Map<string, string> {
  const m = new Map<string, string>();
  if ('refused' in out) return new Map([['refused', String(out.refused)]]);
  const g = out.graph as Rec;
  const idName = new Map<string, string>((g.nodes as Rec[]).map((n) => [n.id, n.kind === 'decision' ? 'decision' : nameOf(canonicalLabel(String(n.description ?? n.label)))]));
  const put = (k: string, v: unknown): void => { if (v !== undefined && v !== null) m.set(k, typeof v === 'number' ? String(Number(v.toPrecision(10))) : JSON.stringify(v)); };
  for (const n of g.nodes as Rec[]) {
    const k = `node ${idName.get(n.id)}`;
    for (const f of ['kind', 'category', 'analysis_participation', 'analysis_participation_reason', 'is_baseline', 'scale_frame', 'goal_threshold', 'goal_threshold_raw',
      'goal_threshold_cap', 'goal_threshold_unit', 'goal_threshold_frame', 'goal_direction', 'goal_horizon_months', 'quantity_frame', 'goal_target_basis', 'goal_level_reading']) put(`${k} ${f}`, n[f]);
    for (const [f, v] of Object.entries((n.observed_state ?? {}) as Rec)) put(`${k} observed_state.${f}`, v);
    for (const [fid, lv] of Object.entries((n.interventions ?? {}) as Rec)) for (const [f, v] of Object.entries(lv as Rec)) if (f !== 'target_match') put(`${k} setting ${idName.get(fid)} ${f}`, v);
    if (n.nonlinear_identity) put(`${k} identity`, `${n.nonlinear_identity.operation}:${[...n.nonlinear_identity.factor_ids].map((x: string) => idName.get(x)).sort().join(',')}`);
  }
  for (const e of g.edges as Rec[]) {
    const k = `edge ${idName.get(e.from)} → ${idName.get(e.to)}`;
    for (const f of ['exists_probability', 'effect_direction', 'origin', 'strength']) put(`${k} ${f}`, e[f]);
    for (const [f, v] of Object.entries((e.provenance ?? {}) as Rec)) if (f !== 'source_quote') put(`${k} provenance.${f}`, v);
  }
  for (const c of (g.goal_constraints ?? []) as Rec[]) for (const f of ['value', 'unit', 'value_frame']) put(`limit ${idName.get(c.node_id)} ${c.operator} ${f}`, c[f]);
  const counted = (xs: string[]): Map<string, number> => xs.reduce((t, x) => t.set(x, (t.get(x) ?? 0) + 1), new Map<string, number>());
  for (const [t, c] of counted((out.loss as Rec[]).map((l) => `loss ${String(l.field_path).replace(/(nodes|edges)\[[^\]]*\]/g, '$1[]').replace(/\.interventions\.[^.]+/g, '.interventions.#')}`))) m.set(t, String(c));
  for (const [t, c] of counted((out.blocked_schema as Rec[]).map((b) => `blocked ${b.missing}/${b.declared}`))) m.set(t, String(c));
  return m;
}

/** Every line on which B's graph for the draft differs from B's graph for the same draft with every name renamed: none may. */
function blindness(draft: Rec): string[] {
  const { draft: other, back } = renamed(draft);
  const outs = [candidateToGraph(draft) as Rec, candidateToGraph(other) as Rec];
  // The converter's own neutral words never reach its output.
  const leaked = outs.flatMap((o, i) => (/qzx[a-z]{5}/i.test(JSON.stringify(o)) ? [`${i === 0 ? 'drafted' : 'renamed'}: a neutral word reached the output`] : []));
  const mine = graphLines(outs[0]!, (c) => c);
  const theirs = graphLines(outs[1]!, back);
  const same = (k: string): boolean => (mine.get(k) === undefined || theirs.get(k) === undefined ? mine.get(k) === theirs.get(k)
    : canonicalLabel(mine.get(k)!) === canonicalLabel(back(theirs.get(k)!)));
  return [...leaked, ...[...new Set([...mine.keys(), ...theirs.keys()])].filter((k) => !same(k)).map((k) => `${k}: ${mine.get(k)} | ${theirs.get(k)}`)];
}

/**
 * The differential: A's own admission of the draft (the build's preparation + admission, no brief) against B's converted
 * graph before the refit chain.
 *  · FIGURES: for every figure A admits — a value, a level, a goal threshold, a limit, a link size — B's number, unit, frame
 *    and sign must equal A's.
 *  · STRUCTURE (DL 19 Oct, the science/gate test): every node and link A keeps, B keeps, and no other; each node's kind,
 *    category, Run participation, identity carrier and held status quo equal A's.
 * ⛔ BOTH RUN ON THE LABEL-BLIND DRAFT (`renamed`, #3464 R2): what A reads from a name or a quote is not A's science for B, so the
 * figures compared are A's on the declared fields only; `blindness` pins that B's graph is the same under any names, and the
 * label-blind rows show what A reads by name and B does not take.
 * Counted apart, never as equal, each by its rule: a person's link size (ruling (a)); a level in another unit than its factor
 * or set on something that is not a factor (B says so); and A's GATES, which B reads by the declared origin instead — an
 * unsized risk the AI declared another person's or of unclear origin stays in the Run; a double route the AI declared another person's
 * is folded where A keeps it as the user's; a declared sum A refuses
 * only for its quote is kept; a reference A on the raw draft leaves unresolved only for its case is bound. A draft B refuses as
 * unreadable is reported with A's figures it does not carry.
 */
function differential(asDrafted: Rec): { compared: number; equal: number; mismatches: string[]; not_used: string[]; a_created: string[]; refused?: { reason: string; figures: number } } {
  const { draft, back } = renamed(asDrafted);
  const result = differentialOf(draft);
  const said = (xs: string[]): string[] => xs.map(back);
  return { ...result, mismatches: said(result.mismatches), not_used: said(result.not_used), a_created: said(result.a_created) };
}
function differentialOf(draft: Rec): ReturnType<typeof differential> {
  const prepared = prepareProvisionalCandidate(draft as never).candidate as Rec;
  const a: Rec = admitA(prepared);
  const converted = candidateToAdmittedGraph(draft);
  // A draft B refuses as unreadable (protocol) is reported with the count of A's figures it does not carry, never hidden.
  const refused = 'refused' in converted ? converted.refused : undefined;
  const b = 'refused' in converted ? { graph: { nodes: [], edges: [], goal_constraints: [] }, loss: [], blocked_schema: [] } : converted;
  const bg = b.graph as Rec;
  const key = (n: Rec): string => canonicalLabel(String(n.description ?? n.label));
  const aKey = new Map((a.nodes as Rec[]).map((n) => [n.id, key(n)]));
  const bByKey = new Map((bg.nodes as Rec[]).filter((n) => n.kind !== 'decision').map((n) => [key(n), n]));
  // The goal is the goal (A may restate its label); an entity the draft never declared is A's own structure, counted apart.
  const bGoal = (bg.nodes as Rec[]).find((n) => n.kind === 'goal');
  const aGoalId = (a.nodes as Rec[]).find((n) => n.kind === 'goal' && n.id === bGoal?.id)?.id ?? (a.nodes as Rec[]).find((n) => n.kind === 'goal')?.id;
  // B's counterpart of an A node: the goal for A's goal; else the same id (A keeps ids when it restates a label); else the same label.
  const bNodeFor = (n: Rec): Rec | undefined => (n.id === aGoalId ? bGoal
    : (bg.nodes as Rec[]).find((x) => x.id === n.id && x.kind !== 'decision') ?? bByKey.get(key(n)));
  const bIdFor = (aId: string): string | undefined => { const n = (a.nodes as Rec[]).find((x) => x.id === aId); return n === undefined ? undefined : bNodeFor(n)?.id; };
  const declaredKeys = new Set([draft.goal?.metric, ...[...(draft.factors ?? []), ...(draft.options ?? []), ...(draft.risks ?? []), ...(draft.outcomes ?? [])]
    .map((n: Rec) => n?.label)].filter((l): l is string => typeof l === 'string').map((l) => canonicalLabel(l)));
  const aCreated = new Set((a.nodes as Rec[]).filter((n) => n.id !== aGoalId && n.kind !== 'decision' && n.kind !== 'option' && bNodeFor(n) === undefined
    && !declaredKeys.has(key(n))).map((n) => n.id));
  const a_created: string[] = [];
  const personSized = new Set(b.blocked_schema.filter((x) => x.missing === 'link_size_origin').map((x) => x.field_path));
  // A level B says it does not use (its unit differs from its factor's, or its target is not a factor), by B's own note.
  const levelNotUsed = new Map(b.loss.flatMap((l) => {
    const why = / is measured in .*so that level is not used/.test(String(l.reason)) ? 'unit' : / is not a factor in this model, so that level is not used/.test(String(l.reason)) ? 'not_a_factor' : undefined;
    return why === undefined ? [] : [[String(l.field_path), why] as const];
  }));
  let compared = 0, equal = 0; const mismatches: string[] = [], not_used: string[] = [];

  const same = (x: unknown, y: unknown): boolean => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x)) : JSON.stringify(x) === JSON.stringify(y));
  const check = (where: string, aObj: Rec | undefined, bObj: Rec | undefined, fields: readonly string[]): void => {
    for (const f of fields) {
      const av = aObj?.[f];
      if (av === undefined || av === null) continue;
      compared += 1;
      if (bObj !== undefined && same(av, bObj[f])) equal += 1; else mismatches.push(`${where}.${f}: A ${JSON.stringify(av)} B ${JSON.stringify(bObj?.[f])}`);
    }
  };
  // A structure value B must equal, compared both ways (B may not add one A has not).
  const checkBoth = (where: string, av: unknown, bv: unknown): void => {
    if ((av === undefined || av === null) && (bv === undefined || bv === null)) return;
    compared += 1;
    if (same(av, bv)) equal += 1; else mismatches.push(`${where}: A ${JSON.stringify(av)} B ${JSON.stringify(bv)}`);
  };
  const draftRisk = (n: Rec): Rec | undefined => ((draft.risks ?? []) as Rec[]).find((r) => canonicalLabel(String(r.label)) === key(n));
  const identity = (carrier: Rec | undefined, idOf: (id: string) => string | undefined): unknown => (carrier === undefined ? undefined
    : { operation: carrier.operation, stated_in_brief: carrier.stated_in_brief, factor_ids: [...carrier.factor_ids].map((f: string) => idOf(f) ?? `A:${f}`).sort() });

  for (const n of a.nodes as Rec[]) {
    if (n.kind === 'decision') continue;
    if (aCreated.has(n.id)) { a_created.push(`node ${key(n)}`); continue; }
    const bn = bNodeFor(n);
    if (bn === undefined) { mismatches.push(`node ${key(n)} (${n.kind}): in A, not in B`); continue; }
    if (n.kind === 'option') {
      checkBoth(`option ${key(n)}.is_baseline`, n.is_baseline, bn.is_baseline);
      continue;
    }
    check(`node ${key(n)}`, n, bn, ['scale_frame', 'goal_threshold', 'goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold_unit', 'goal_threshold_frame', 'quantity_frame']);
    check(`node ${key(n)}.observed_state`, n.observed_state, bn?.observed_state, ['value', 'raw_value', 'cap', 'unit', 'baseline']);
    checkBoth(`node ${key(n)}.kind`, n.kind, bn.kind);
    checkBoth(`node ${key(n)}.category`, n.category, bn.category);
    const r = n.kind === 'risk' ? draftRisk(n) : undefined;
    if (n.analysis_participation === 'retained_excluded' && r !== undefined && declaredWho(draft, 'risk', String(r.label), r.provenance) !== 'olumi'
      && bn.analysis_participation === undefined) not_used.push(`gate_risk_origin: risk ${key(n)}`);
    else {
      checkBoth(`node ${key(n)}.analysis_participation`, n.analysis_participation, bn.analysis_participation);
      checkBoth(`node ${key(n)}.analysis_participation_reason`, n.analysis_participation_reason, bn.analysis_participation_reason);
    }
    const aId = identity(n.nonlinear_identity, bIdFor) as Rec | undefined;
    const bId = identity(bn.nonlinear_identity, (x) => x) as Rec | undefined;
    if (aId === undefined && bId?.operation === 'sum' && b.loss.some((l) => l.field_path === `nodes[${bn.id}].sum_identity`)) not_used.push(`gate_sum_quote: ${key(n)}`);
    else checkBoth(`node ${key(n)}.nonlinear_identity`, aId, bId);
  }
  // A node only B has would be structure A does not keep: none is allowed.
  const aOfB = new Set((a.nodes as Rec[]).map((n) => bNodeFor(n)?.id).filter((x): x is string => x !== undefined));
  for (const n of bg.nodes as Rec[]) if (n.kind !== 'decision' && !aOfB.has(n.id)) mismatches.push(`node ${key(n)} (${n.kind}): in B, not in A`);

  for (const o of (a.nodes as Rec[]).filter((n) => n.kind === 'option' && n.interventions)) {
    const bo = bNodeFor(o);
    for (const [aFid, lv] of Object.entries(o.interventions as Rec)) {
      const bFid = bIdFor(aFid);
      const where = `setting ${key(o)} → ${aKey.get(aFid)}`;
      const drafted = (draft.options ?? []).some((x: Rec) => canonicalLabel(String(x.label)) === key(o)
        && (x.interventions ?? []).some((iv: Rec) => canonicalLabel(String(iv.factor_label)) === aKey.get(aFid)));
      if (!drafted || aCreated.has(aFid)) { a_created.push(where); continue; }
      const why = bo === undefined ? undefined : levelNotUsed.get(`nodes[${bo.id}].interventions.${bFid ?? aFid}`);
      if (why !== undefined) { not_used.push(`${why}: ${where}`); continue; }
      check(where, lv as Rec, bo?.interventions?.[bFid ?? ''], ['value', 'raw_value', 'unit']);
    }
  }
  const aDecision = new Set((a.nodes as Rec[]).filter((n) => n.kind === 'decision').map((n) => n.id));
  const bDecision = new Set((bg.nodes as Rec[]).filter((n) => n.kind === 'decision').map((n) => n.id));
  const bEdgeKeys = new Set<string>();
  for (const e of (a.edges as Rec[]).filter((x) => !aDecision.has(x.from))) {
    const where = `edge ${aKey.get(e.from)} → ${aKey.get(e.to)}`;
    if (aCreated.has(e.from) || aCreated.has(e.to)) { a_created.push(where); continue; }
    const be = (bg.edges as Rec[]).find((x) => x.from === bIdFor(e.from) && x.to === bIdFor(e.to));
    // A keeps a double route as the user's link (`explicit`); the AI declared it another person's or of unclear origin, so B folds it.
    if (be === undefined && b.loss.some((x) => x.field_path === `edges[${bIdFor(e.from)}::${bIdFor(e.to)}].one_route`)) { not_used.push(`gate_link_origin: ${where}`); continue; }
    compared += 1;
    if (be === undefined) { mismatches.push(`${where}: in A, not in B`); continue; }
    equal += 1;
    bEdgeKeys.add(`${be.from}::${be.to}`);
    if (personSized.has(`edges[${be.from}::${be.to}]`)) { not_used.push(`person_size: ${where}`); continue; }
    check(where, e, be, ['exists_probability', 'effect_direction']);
    check(`${where}.strength`, e.strength, be?.strength, ['mean', 'std']);
    check(`${where}.natural_effect`, e.provenance?.natural_effect, be?.provenance?.natural_effect, ['amount', 'per_source_change', 'amount_unit', 'per_source_change_unit']);
  }
  // A link only B has: a reference A on the raw draft leaves unresolved only for its case; else a mismatch.
  const label = (id: string): string => String((bg.nodes as Rec[]).find((n) => n.id === id)?.description ?? (bg.nodes as Rec[]).find((n) => n.id === id)?.label ?? id);
  for (const e of (bg.edges as Rec[]).filter((x) => !bDecision.has(x.from) && !bEdgeKeys.has(`${x.from}::${x.to}`))) {
    const where = `edge ${canonicalLabel(label(e.from))} → ${canonicalLabel(label(e.to))}`;
    const l = ((draft.links ?? []) as Rec[]).find((x) => canonicalLabel(String(x.from)) === canonicalLabel(label(e.from)) && canonicalLabel(String(x.to)) === canonicalLabel(label(e.to)));
    // A on the raw draft leaves a reference unresolved that differs from its entity's own label only by A's canonicalLabel
    // (case, spacing); B writes every reference with the entity's own label first, so A binds it there.
    const unresolved = l !== undefined && (a.withheld as Rec[]).some((w) => w.reason === 'unresolved_endpoint' && w.from === l.from && w.to === l.to);
    if (unresolved && (l!.from !== label(e.from) || l!.to !== label(e.to))) { not_used.push(`case_bound: ${where}`); continue; }
    compared += 1;
    mismatches.push(`${where}: in B, not in A`);
  }
  for (const k of (a.goal_constraints ?? []) as Rec[]) {
    if (aCreated.has(k.node_id)) { a_created.push(`limit ${aKey.get(k.node_id)}`); continue; }
    const bk = ((bg.goal_constraints ?? []) as Rec[]).find((x) => x.node_id === bIdFor(k.node_id) && x.operator === k.operator);
    check(`limit ${aKey.get(k.node_id)} ${k.operator}`, k, bk, ['value', 'unit', 'value_frame']);
  }
  return refused !== undefined ? { compared, equal, mismatches: [], not_used, a_created, refused: { reason: refused, figures: mismatches.length } }
    : { compared, equal, mismatches, not_used, a_created };
}

describe('candidateToGraph: conversion + science only', () => {
  it('⭐ the dated-dilemma draft → a valid graph with the aim open, every drafted claim kept with the origin the AI declared', () => {
    const draft = dilemmaDraft();
    const { graph, declared, loss, blocked_schema } = converted(draft);
    expect(GraphV3.safeParse(graph).success).toBe(true);
    // The aim is open: the goal the AI declared, as Olumi's reading, with no figure invented for it.
    const goals = ofKind(graph, 'goal');
    expect(goals.map((g) => [g.label, g.provenance])).toEqual([[SHIPPED, 'ai_inferred']]);
    expect(['goal_threshold', 'goal_threshold_raw', 'goal_direction'].filter((k) => k in goals[0]!)).toEqual([]);
    // Nothing refused or demoted: both stated options, both risks as the brief's, every factor with its figure, every link.
    expect(ofKind(graph, 'option').map((n) => [n.label, n.provenance]).sort())
      .toEqual([['Delay the launch', 'from_brief'], ['Ship with the old card stock', 'from_brief']]);
    expect(ofKind(graph, 'risk').map((n) => [n.label, n.provenance]).sort())
      .toEqual([['Missed holiday sales', 'from_brief'], ['Warped cards', 'from_brief']]);
    for (const l of draft.links as Rec[]) expect(edge(graph, l.from, l.to), `${l.from} → ${l.to}`).toBeDefined();
    // Each figure on its frame (as A frames it) with the ORIGIN the AI declared, read by the one provenance authority:
    // the user's (declared, not attested: stamp only), the printer's and the unclear one (unknown: never the user's, never Olumi's).
    const figure = (label: string): Rec => byLabel(graph, label).observed_state;
    expect(figure('Packing time')).toMatchObject({ value: 0.3, raw_value: 3, cap: 10, unit: 'weeks' });
    expect(valueProvenanceOf(figure('Packing time'))).toMatchObject({ origin: 'human', stampOnly: true });
    expect(figure('Card stock lead time')).toMatchObject({ value: 0.5, raw_value: 5, cap: 10 });
    expect(valueProvenanceOf(figure('Card stock lead time')).origin).toBe('unknown');
    expect(figure('Backer cancellations')).toMatchObject({ value: 0.4, raw_value: 40, cap: 100 });
    expect(valueProvenanceOf(figure('Backer cancellations')).origin).toBe('unknown');
    for (const label of ['Packing time', 'Card stock lead time', 'Backer cancellations']) {
      expect(figure(label).user_material_unverified, label).toBeUndefined();
      expect(valueProvenanceOf(figure(label)).origin, `${label}: never Olumi's`).not.toBe('ai');
    }
    expect(byLabel(graph, 'Card stock lead time').source_quote).toBe(S[1]);
    // GraphV3 cannot hold the printer's NAME: said as BLOCKED-SCHEMA (the origin stays unknown, never Olumi's); `declared` keeps it.
    expect(blocked_schema).toEqual([{ field_path: 'nodes[card_stock_lead_time].observed_state', declared: 'other', missing: 'speaker_name' }]);
    // The declared status quo is held; the raw draft travels beside the graph exactly as the AI wrote it.
    expect(byLabel(graph, 'Ship with the old card stock').is_baseline).toBe(true);
    expect(declared).toEqual(draft);
    expect(declared).not.toBe(draft);
    // What is declared but not converted yet (the deadline forecast) is said, never dropped silently.
    expect(loss.map((l) => l.reason)).toContain('This draft does not include a forecast for the deadline of "board game shipment" yet; Olumi kept it as drafted.');
  });

  it('⛔ CONTRAST: A (admitCandidateModel) on the same draft still applies its gates (demotes the figures and the risks)', () => {
    const a = admitCandidateModel(dilemmaDraft() as never, {}, BRIEF);
    const aNode = (label: string): Rec => a.nodes.find((n) => n.label === label) as Rec;
    for (const label of ['Packing time', 'Card stock lead time', 'Backer cancellations']) {
      expect(aNode(label).observed_state, label).toMatchObject({ source: 'cee_inference', user_material_unverified: true });
    }
    expect(aNode('Missed holiday sales').provenance).toBe('ai_inferred');
    const b = converted(dilemmaDraft()).graph;
    expect(byLabel(b, 'Packing time').observed_state.source).toBe('brief_extraction');
    expect(byLabel(b, 'Missed holiday sales').provenance).toBe('from_brief');
  });

  it('⭐ SCIENCE: a level target on its own cap, today\'s level on it, the lever framed, a stated size sized, an addition summed', () => {
    const { graph, declared } = converted(salesDraft());
    expect(GraphV3.safeParse(graph).success).toBe(true);
    // 600 orders: cap 600 × 1.25 = 750 (target headroom); today's 400 is 400 / 750 on it; the declared direction and horizon held.
    expect(ofKind(graph, 'goal')[0]).toMatchObject({ goal_threshold_raw: 600, goal_threshold_cap: 750, goal_threshold: 0.8,
      goal_direction: '>=', goal_horizon_months: 6, observed_state: { baseline: 400 / 750, raw_value: 400, cap: 750, source: 'brief_extraction' } });
    // £2,000 of £10,000: 0.2. Double = £4,000: 0.4. Add £1,000 = £2,000 + £1,000 = £3,000: 0.3, Olumi's derived figure.
    expect(byLabel(graph, 'Ad spend').observed_state).toMatchObject({ value: 0.2, raw_value: 2000, cap: 10000 });
    const levelOf = (option: string): Rec => byLabel(graph, option).interventions[byLabel(graph, 'Ad spend').id];
    expect(levelOf('Double the ad spend')).toMatchObject({ value: 0.4, raw_value: 4000, source: 'brief_extraction' });
    expect(levelOf('Add £1,000 of ad spend')).toMatchObject({ value: 0.3, raw_value: 3000, source: 'cee_hypothesis' });
    expect(settingProvenanceOf(levelOf('Double the ad spend')).origin).toBe('human');
    // Olumi's estimate of one order per £20: 1/20 × 10,000 / 750 = 0.6667 on the goal's frame, labelled as Olumi's.
    const sized = edge(graph, 'Ad spend', 'Monthly pre-orders')!;
    expect(sized.strength.mean).toBeCloseTo(10000 / 20 / 750, 6);
    expect(sized.provenance.magnitude).toBe('olumi_estimate');
    expect(linkProvenanceOf(sized).origin).toBe('ai');
    // The declared status quo is held at today's level of what the others set.
    expect(byLabel(graph, 'Keep spending as now').is_baseline).toBe(true);
    expect(edge(graph, 'Keep spending as now', 'Ad spend')).toBeDefined();
    expect(declared.statements).toEqual([]);
  });

  it('⭐ SCIENCE: a level already above an "at least" target is upside down, so it is not used (the existing rule and words)', () => {
    const draft = salesDraft(); draft.goal.baseline_value = 700;
    const { graph, loss } = converted(draft);
    expect(ofKind(graph, 'goal')[0]!.observed_state).toBeUndefined();
    expect(ofKind(graph, 'goal')[0]!.goal_threshold_raw).toBe(600);
    expect(loss.map((l) => l.reason).join(' ')).toContain('is already above the target of 600');
  });

  it('⭐ SCIENCE: a declared sum is carried when today\'s parts add up (300 + 100 = 400), as Olumi\'s reading; refused when they do not', () => {
    const kept = converted(sumDraft(400));
    expect(ofKind(kept.graph, 'goal')[0]!.nonlinear_identity).toEqual({ operation: 'sum',
      factor_ids: [byLabel(kept.graph, 'Online orders').id, byLabel(kept.graph, 'Shop orders').id], stated_in_brief: false });
    // Olumi's derivation, said with the existing words and its arithmetic; the parts keep their own (the user's) origin.
    expect(kept.loss.map((l) => l.reason)).toContain('Olumi reads "Total orders" as "Online orders" + "Shop orders": Olumi\'s reading, '
      + 'not your figure; tell me if it includes anything else. Today: 400 = your 300 + your 100.');
    expect(valueProvenanceOf(byLabel(kept.graph, 'Online orders').observed_state).origin).toBe('human');
    const off = converted(sumDraft(500));
    expect(ofKind(off.graph, 'goal')[0]!.nonlinear_identity).toBeUndefined();
    expect(off.loss.map((l) => l.reason).join(' ')).toContain('while those parts add up to');
    // Definitions the AI declared as the user's are a person's sizes: Olumi's placeholder, listed, so no sum is carried on them.
    const theirs = converted(sumDraft(400, 'user'));
    expect(ofKind(theirs.graph, 'goal')[0]!.nonlinear_identity).toBeUndefined();
    expect(theirs.blocked_schema.filter((b) => b.missing === 'link_size_origin').map((b) => b.declared)).toEqual(['user', 'user']);
  });

  // ⭐ GENERATIVE (signed plan item 7; DL 19 Oct): whatever its operands' origins (all the user's, all Olumi's, mixed), a
  // calculated total is Olumi's derived figure, its arithmetic said with each operand's origin; the operands keep their own.
  const ORIGINS = ['user', 'olumi', 'other', 'unknown'] as const;
  type O = typeof ORIGINS[number];
  const readAs: Record<O, string> = { user: 'human', olumi: 'ai', other: 'unknown', unknown: 'unknown' };
  const partSaid: Record<O, (amount: string) => string> = { user: (a) => `your ${a}`, olumi: (a) => `Olumi's ${a} estimate`,
    other: (a) => `another person's ${a}`, unknown: (a) => `${a} from an unclear source` };
  const statementBy = (subject: Rec, speaker: O): Rec[] => (speaker === 'other' || speaker === 'unknown' ? [{ quote: 'synthetic',
    subject: { to_label: null, factor_label: null, ...subject }, field: 'level', form: 'point', value: null, low: null, high: null, unit: null,
    qualifier: null, conditions: null, speaker }] : []);
  it.each(ORIGINS.flatMap((today) => ORIGINS.map((added) => [today, added] as const)))(
    'GENERATIVE (addition): today\'s £2,000 by %s + £1,000 by %s = £3,000, always Olumi\'s derived figure', (today, added) => {
      const draft = salesDraft();
      draft.factors[0].provenance = today === 'olumi' ? 'inferred' : 'explicit';
      draft.factors[0].baseline_known = today !== 'olumi';
      draft.options[1].interventions[0].provenance = added === 'olumi' ? 'ai_proposed' : 'explicit';
      draft.statements = [...statementBy({ kind: 'factor', label: 'Ad spend' }, today),
        ...statementBy({ kind: 'option', label: 'Add £1,000 of ad spend', factor_label: 'Ad spend' }, added)];
      const { graph, loss } = converted(draft);
      const total = byLabel(graph, 'Add £1,000 of ad spend').interventions[byLabel(graph, 'Ad spend').id];
      expect(total).toMatchObject({ raw_value: 3000, value: 0.3, source: 'cee_hypothesis' });
      expect(settingProvenanceOf(total).origin).toBe('ai');
      // The operand on the model keeps its own origin; the note shows the arithmetic with both operands' origins.
      expect(valueProvenanceOf(byLabel(graph, 'Ad spend').observed_state).origin).toBe(readAs[today]);
      expect(loss.map((l) => l.reason)).toContain(`"Add £1,000 of ad spend" sets "Ad spend" to £3,000, Olumi's derived figure: `
        + `£3,000 = ${partSaid[today]('£2,000')} + ${partSaid[added]('£1,000')}.`);
    });
  it('PL 16:35: a total the user WRITES ("£3,000 in total") keeps its own origin; only a total the converter COMPUTES is Olumi\'s', () => {
    const draft = salesDraft();
    draft.options[1].interventions[0] = { factor_label: 'Ad spend', value: 3000, value_kind: 'absolute', unit: '£', provenance: 'explicit', stated_evidence: null };
    const { graph, loss } = converted(draft);
    const written = byLabel(graph, 'Add £1,000 of ad spend').interventions[byLabel(graph, 'Ad spend').id];
    expect(written).toMatchObject({ raw_value: 3000, value: 0.3, source: 'brief_extraction' });
    expect(settingProvenanceOf(written).origin).toBe('human');
    expect(loss.some((l) => String(l.field_path).endsWith('.derived_total'))).toBe(false);
    // The total of a carried sum, as the user wrote it (400 = 300 + 100), keeps its origin beside Olumi's sum reading.
    const sum = converted(sumDraft(400));
    expect(ofKind(sum.graph, 'goal')[0]!.nonlinear_identity).toMatchObject({ operation: 'sum', stated_in_brief: false });
    expect(valueProvenanceOf(ofKind(sum.graph, 'goal')[0]!.observed_state).origin).toBe('human');
  });

  it('GENERATIVE (absolute): a setting that is not calculated keeps its own declared origin', () => {
    const draft = salesDraft(); draft.options[0].interventions[0].provenance = 'ai_proposed';
    const { graph } = converted(draft);
    expect(settingProvenanceOf(byLabel(graph, 'Double the ad spend').interventions[byLabel(graph, 'Ad spend').id]).origin).toBe('ai');
    expect(settingProvenanceOf(converted(salesDraft()).graph.nodes.find((n: Rec) => n.label === 'Double the ad spend')
      .interventions.ad_spend).origin).toBe('human');
  });
  it.each(ORIGINS)('GENERATIVE (definition): a one-for-one definition declared by %s is sized only when it is Olumi\'s', (by) => {
    const draft = sumDraft(400, by === 'olumi' ? 'olumi' : 'user');
    draft.statements = (draft.links as Rec[]).flatMap((l) => (by === 'other' || by === 'unknown' ? [{ quote: 'synthetic',
      subject: { kind: 'link', label: l.from, to_label: l.to, factor_label: null }, field: 'effect', form: 'point', value: null, low: null,
      high: null, unit: null, qualifier: null, conditions: null, speaker: by }] : []));
    const { graph } = converted(draft);
    const part = edge(graph, 'Online orders', 'Total orders')!;
    expect(part.provenance.magnitude === 'olumi_estimate').toBe(by === 'olumi');
    expect(linkProvenanceOf(part).origin).not.toBe('human');
  });

  it('BLOCKED-SCHEMA: a target another person stated and a size from an unclear source are listed, never relabelled', () => {
    const draft = salesDraft('user');
    const said = (quote: string, subject: Rec, field: string, speaker: string): Rec => ({ quote, subject: { to_label: null, factor_label: null, ...subject },
      field, form: 'point', value: null, low: null, high: null, unit: null, qualifier: null, conditions: null, speaker });
    draft.statements = [said('Our agent reckons 600 pre-orders a month is the target.', { kind: 'goal', label: 'Monthly pre-orders' }, 'target', 'other'),
      said(AD_QUOTE, { kind: 'link', label: 'Ad spend', to_label: 'Monthly pre-orders' }, 'effect', 'unknown')];
    const { graph, blocked_schema } = converted(draft);
    expect(blocked_schema).toEqual([
      { field_path: 'nodes[monthly_pre_orders].goal_threshold_raw', declared: 'other', missing: 'target_origin' },
      { field_path: 'edges[ad_spend::monthly_pre_orders]', declared: 'unknown', missing: 'link_size_origin' },
    ]);
    expect(ofKind(graph, 'goal')[0]!.goal_threshold_raw).toBe(600);
    // The unclear source's size is never the person's: Olumi's placeholder, never `user_stated`, never read as human.
    const unsized = edge(graph, 'Ad spend', 'Monthly pre-orders')!;
    expect(unsized.provenance.magnitude).not.toBe('user_stated');
    expect(linkProvenanceOf(unsized).origin).not.toBe('human');
    expect(converted(salesDraft()).blocked_schema).toEqual([]);
  });

  it('⭐ LINK SIZES (DL ruling): the user\'s stated size keeps Olumi\'s placeholder, said in their words, kept and listed', () => {
    const { graph, loss, declared, blocked_schema } = converted(salesDraft('user'));
    const link = edge(graph, 'Ad spend', 'Monthly pre-orders')!;
    expect(link.provenance.magnitude).not.toBe('user_stated');
    expect(link.provenance.natural_effect).toBeUndefined();
    expect(linkProvenanceOf(link).origin).not.toBe('human');
    expect(loss.map((l) => l.reason)).toContain(`You said "${AD_QUOTE}"; this path doesn't use your link sizes in the calculation yet, `
      + 'so the link from "Ad spend" to "Monthly pre-orders" keeps Olumi\'s placeholder size.');
    expect(blocked_schema).toEqual([{ field_path: 'edges[ad_spend::monthly_pre_orders]', declared: 'user', missing: 'link_size_origin' }]);
    expect(declared.links[0]).toMatchObject({ effect_amount: 1, effect_per_source_change: 20, effect_provenance: 'explicit' });
  });

  it('round 2 (B1): an addition is framed on its total — £9,000 + £2,000 = £11,000 on a 100,000 frame, as A frames it', () => {
    const draft = salesDraft();
    draft.factors[0].baseline_value = 9000;
    draft.options[1].interventions[0].value = 2000;
    const { graph } = converted(draft);
    const added = byLabel(graph, 'Add £1,000 of ad spend').interventions[byLabel(graph, 'Ad spend').id];
    expect(added).toMatchObject({ value: 0.11, raw_value: 11000 });
    expect(byLabel(graph, 'Ad spend').observed_state).toMatchObject({ value: 0.09, raw_value: 9000, cap: 100000 });
  });

  it('A\'s numbers (DL 19 Oct): an "above" target\'s level is what A admits — not used, with A\'s reason; the comparator is kept', () => {
    const draft = salesDraft(); draft.goal.operator = '>';
    const { graph, loss } = converted(draft);
    const goal = ofKind(graph, 'goal')[0]!;
    expect(goal).toMatchObject({ goal_direction: '>', goal_threshold_raw: 600, goal_threshold_cap: 750 });
    expect(goal.observed_state).toBeUndefined();
    expect(loss.map((l) => l.reason).join(' ')).toContain('cannot be calculated exactly yet');
  });

  it('round 2 (B4, B5): a setting\'s speaker is its LEVEL statement\'s; a declared speaker wins over the provenance tag', () => {
    const draft = salesDraft();
    const said = (subject: Rec, field: string, speaker: string): Rec => ({ quote: 'synthetic', subject: { to_label: null, factor_label: null, ...subject },
      field, form: 'point', value: null, low: null, high: null, unit: null, qualifier: null, conditions: null, speaker });
    draft.statements = [said({ kind: 'option', label: 'Double the ad spend', factor_label: 'Ad spend' }, 'lead', 'other'),
      said({ kind: 'option', label: 'Double the ad spend', factor_label: 'Ad spend' }, 'level', 'user'),
      said({ kind: 'factor', label: 'Ad spend' }, 'level', 'other')];
    draft.factors[0].provenance = 'inferred';
    const { graph, blocked_schema } = converted(draft);
    const setting = byLabel(graph, 'Double the ad spend').interventions[byLabel(graph, 'Ad spend').id];
    expect(settingProvenanceOf(setting).origin).toBe('human');
    expect(valueProvenanceOf(byLabel(graph, 'Ad spend').observed_state).origin).toBe('unknown');
    expect(blocked_schema).toContainEqual({ field_path: 'nodes[ad_spend].observed_state', declared: 'other', missing: 'speaker_name' });
  });

  it('round 2 (B6): a declared status quo that itself acts is not held', () => {
    const draft = salesDraft();
    draft.options[2].interventions = [{ factor_label: 'Ad spend', value: 2000, value_kind: 'absolute', unit: '£', provenance: 'explicit', stated_evidence: null }];
    const { graph } = converted(draft);
    expect(byLabel(graph, 'Keep spending as now').is_baseline).toBeUndefined();
  });

  it('A\'s numbers (DL 19 Oct): a change target carries exactly A\'s threshold, cap and frame', () => {
    for (const goal of [{ frame: 'change_rel', value: 10, unit: '%' }, { frame: 'change_abs', value: 200 }]) {
      const draft = salesDraft(); draft.goal = { ...draft.goal, ...goal };
      expect(differential(draft).mismatches).toEqual([]);
      expect(ofKind(converted(draft).graph, 'goal')[0]).toMatchObject({ goal_threshold_frame: goal.frame });
    }
  });

  it('⛔ Codex #3464 R1 probe (unit): a setting in weeks is never written as pounds — it is not used, and said', () => {
    const draft = salesDraft();
    draft.options[0].interventions[0].unit = 'weeks';
    const { graph, loss } = converted(draft);
    const setting = byLabel(graph, 'Double the ad spend').interventions?.[byLabel(graph, 'Ad spend').id];
    expect(setting?.unit).not.toBe('£');
    expect(setting).toBeUndefined();
    expect(loss.map((l) => l.reason)).toContain('"Double the ad spend" sets "Ad spend" to 4000 weeks, but "Ad spend" is measured in £, so that level is not used; Olumi kept it as drafted.');
  });

  it('a name drafted both as an option and as a factor: one node (the option, as A keeps it); a level set on it is not used, and both are said', () => {
    const draft = salesDraft();
    draft.factors.push({ label: 'Double the ad spend', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'yes/no',
      provenance: 'explicit', plausible_max: null });
    draft.options[1].interventions.push({ factor_label: 'Double the ad spend', value: 1, value_kind: 'absolute', unit: 'yes/no', provenance: 'explicit', stated_evidence: null });
    const { graph, loss } = converted(draft);
    expect((graph.nodes as Rec[]).filter((n) => n.label === 'Double the ad spend').map((n) => n.kind)).toEqual(['option']);
    expect(Object.keys(byLabel(graph, 'Add £1,000 of ad spend').interventions ?? {})).toEqual([byLabel(graph, 'Ad spend').id]);
    expect(loss.map((l) => l.reason)).toEqual(expect.arrayContaining([
      '"Double the ad spend" is drafted both as an option and as a factor; the model keeps it as an option, and Olumi kept the other as drafted.',
      '"Add £1,000 of ad spend" sets "Double the ad spend" to 1 yes/no, but "Double the ad spend" is not a factor in this model, so that level is not used; Olumi kept it as drafted.']));
    // A writes that level onto the option node; B does not, and the differential names it rather than counting it equal.
    const diff = differential(draft);
    expect(diff.mismatches).toEqual([]);
    expect(diff.not_used).toEqual(['not_a_factor: setting add £1,000 of ad spend → double the ad spend']);
  });

  it('⛔ Codex #3464 R1 probe (frame): a case-equivalent operand label binds, and the total is framed as A frames it (0.11 of 100,000)', () => {
    const draft = salesDraft(); draft.factors[0].baseline_value = 9000;
    draft.options[1].interventions[0].value = 2000;
    draft.options[1].interventions[0].factor_label = 'ad spend';
    const { graph } = converted(draft);
    expect(byLabel(graph, 'Add £1,000 of ad spend').interventions[byLabel(graph, 'Ad spend').id]).toMatchObject({ raw_value: 11000, value: 0.11 });
    expect(byLabel(graph, 'Ad spend').observed_state).toMatchObject({ value: 0.09, cap: 100000 });
  });

  it('⭐ DIFFERENTIAL (synthetic drafts): every figure A admits, B carries with the same number, unit, frame and sign', () => {
    const drafts = [dilemmaDraft(), salesDraft(), salesDraft('user'), sumDraft(400), sumDraft(500), sumDraft(400, 'user'), structureDraft(),
      scienceDraft(), scienceDraft({ userFold: true }), scienceDraft({ otherFold: true }), scienceDraft({ undeclaredStatusQuo: true }), scienceDraft({ otherRisk: true }),
      definitionDraft()];
    const results = drafts.map(differential);
    expect(results.flatMap((r) => r.mismatches)).toEqual([]);
    expect(results.filter((r) => r.refused !== undefined)).toEqual([]);
    expect(results.reduce((n, r) => n + r.compared, 0)).toBeGreaterThan(40);
  });

  // ⭐ DIFFERENTIAL (stored drafts, DL 19 Oct): run locally against `C2G_DIFFERENTIAL_DRAFTS` (one stored drafter JSON per
  // line; never committed). Skipped where the file is absent (CI). Writes its counts to `C2G_DIFFERENTIAL_OUT`.
  const STORED = process.env.C2G_DIFFERENTIAL_DRAFTS;
  it.runIf(STORED !== undefined && existsSync(STORED))('⭐ DIFFERENTIAL (stored drafts): every figure A admits, B carries equal', () => {
    const lines = readFileSync(STORED!, 'utf8').split('\n').filter((l) => l.trim() !== '');
    const blind = lines.flatMap((l, i) => { try { const d = blindness(JSON.parse(l)); return d.length > 0 ? [`#${i} ${d.slice(0, 6).join(' ;; ')}`] : []; } catch (e) { return [`#${i} error ${String(e).slice(0, 120)}`]; } });
    const results: (ReturnType<typeof differential> & { error?: string })[] = lines.map((l) => {
      try { return differential(JSON.parse(l)); } catch (e) { return { compared: 0, equal: 0, mismatches: [], not_used: [], a_created: [], error: String(e) }; }
    });
    const summary = { drafts: lines.length, converted: results.filter((r) => r.error === undefined && r.refused === undefined).length,
      errors: results.filter((r) => r.error !== undefined).length, compared: results.reduce((n, r) => n + r.compared, 0),
      equal: results.reduce((n, r) => n + r.equal, 0), not_used: results.reduce((n, r) => n + r.not_used.length, 0),
      not_used_by_class: results.flatMap((r) => r.not_used.map((x) => x.split(':')[0]!)).reduce<Rec>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}),
      refused: results.flatMap((r, i) => (r.refused ? [`#${i} ${r.refused.reason}: ${r.refused.figures} of A's figures not carried`] : [])),
      not_used_detail: results.flatMap((r, i) => r.not_used.filter((x) => !x.startsWith('person_size')).map((x) => `#${i} ${x}`)),
      a_created_entities: results.reduce((n, r) => n + r.a_created.length, 0), errors_detail: results.flatMap((r, i) => (r.error !== undefined ? [`#${i} ${r.error.slice(0, 160)}`] : [])),
      mismatches: results.flatMap((r, i) => r.mismatches.map((m) => `#${i} ${m}`)), label_blind_differing: blind };
    if (process.env.C2G_DIFFERENTIAL_OUT) writeFileSync(process.env.C2G_DIFFERENTIAL_OUT, JSON.stringify(summary, null, 1));
    expect(summary.mismatches).toEqual([]);
    expect(summary.label_blind_differing).toEqual([]);
  }, 600_000);

  it('⭐ STRUCTURE SCIENCE (DL 19 Oct): a declared product, a lever no option reaches, an unsized Olumi risk, a double route and an option alike as drafted follow A, in A\'s words', () => {
    const { graph, loss } = converted(scienceDraft());
    const reasons = loss.map((l) => String(l.reason));
    const id = (label: string): string => byLabel(graph, label).id;
    // A product A checked on the structure: carried on the goal, as Olumi's reading (the declaration's own provenance).
    expect(byLabel(graph, 'Monthly revenue').nonlinear_identity).toEqual({ operation: 'product', factor_ids: [id('Price'), id('Customers')], stated_in_brief: false });
    expect(reasons.some((r) => r.startsWith('Olumi reads "Monthly revenue" as "Price" and "Customers" multiplied together.'))).toBe(true);
    // A lever no option reaches is context, as readiness reads it.
    expect(byLabel(graph, 'Brand awareness').category).toBe('external');
    expect(reasons.some((r) => r.startsWith('No option in this model changes "Brand awareness", so it is held at its value as context'))).toBe(true);
    // Olumi's unlinked, unsized risk is left out of the Run; Olumi's root risk too.
    expect(byLabel(graph, 'Competitor price cut')).toMatchObject({ analysis_participation: 'retained_excluded', analysis_participation_reason: 'unsized_olumi_risk' });
    expect(byLabel(graph, 'Churn spike').analysis_participation).toBe('retained_excluded');
    expect(reasons.some((r) => r.startsWith('"Competitor price cut" is Olumi’s suggestion and is kept in the model but left out of this analysis'))).toBe(true);
    // A factor → risk link that only re-draws the factor's own direct link is left out, in A's words.
    expect(edge(graph, 'Price', 'Churn spike')).toBeUndefined();
    expect(reasons.some((r) => r.startsWith('The link from "Price" to "Churn spike" was left out: "Price" already moves "Customers" straight'))).toBe(true);
    // Olumi's options alike as drafted (each sets nothing the referral scheme does not) are left out, kept in `declared`; the user's stay.
    expect(ofKind(graph, 'option').map((o) => o.label)).toEqual(['Raise the price', 'Run a referral scheme', 'Status quo']);
    expect(['Promote more', 'Advertise more'].map((o) => reasons.some((r) => r.startsWith(`I left out "${o}" as a separate option`)))).toEqual([true, true]);
    // The user's unsized risk stays in the Run (A and B agree: it is not Olumi's).
    expect(byLabel(graph, 'Key supplier failure').analysis_participation).toBeUndefined();
    // The declared status quo is held at today's levels, as A holds it.
    expect(byLabel(graph, 'Status quo').is_baseline).toBe(true);
    expect(['Price', 'Customers'].map((f) => edge(graph, 'Status quo', f)?.origin)).toEqual(['repair', 'repair']);
    // An outcome a percentage limit holds is a factor that can hold its level (A's re-kind).
    expect(byLabel(graph, 'Monthly churn')).toMatchObject({ kind: 'factor', category: 'observable' });
    const diff = differential(scienceDraft());
    expect(diff.mismatches).toEqual([]);
  });

  it('⛔ GATES read by the DECLARED origin (DL 19 Oct): another person\'s unsized risk stays in the Run; a double route is folded unless it is the user\'s; no status quo by its label', () => {
    // A risk the AI declared another person's: A reads its tag as Olumi's and leaves it out; here it stays in (readiness holds what needs it).
    const other = scienceDraft({ otherRisk: true });
    expect(byLabel(converted(other).graph, 'Key supplier failure').analysis_participation).toBeUndefined();
    expect(differential(other)).toMatchObject({ mismatches: [] });
    expect(differential(other).not_used).toContain('gate_risk_origin: risk key supplier failure');
    // The same double route, declared as the user's link, is their claim: it stays (as A keeps it).
    const userFold = scienceDraft({ userFold: true });
    expect(edge(converted(userFold).graph, 'Price', 'Churn spike')).toBeDefined();
    expect(differential(userFold).mismatches).toEqual([]);
    // Declared as ANOTHER person's link: A reads `explicit` as the user's and keeps it; here it is not the user's claim, so the
    // double route is left out, in A's words.
    const otherFold = scienceDraft({ otherFold: true });
    const folded = converted(otherFold);
    expect(edge(folded.graph, 'Price', 'Churn spike')).toBeUndefined();
    expect(folded.loss.some((l) => String(l.reason).startsWith('The link from "Price" to "Churn spike" was left out'))).toBe(true);
    expect(folded.blocked_schema.filter((x) => String(x.field_path).includes('churn_spike'))).toEqual([]);
    expect(differential(otherFold)).toMatchObject({ mismatches: [] });
    expect(differential(otherFold).not_used).toContain('gate_link_origin: edge price → churn spike');
    // An option that only READS as the status quo (not declared it) is not held: A holds it by its label; no label reading here.
    const undeclared = scienceDraft({ undeclaredStatusQuo: true });
    const { graph } = converted(undeclared);
    expect(byLabel(graph, 'Status quo').is_baseline).toBeUndefined();
    expect(['Price', 'Customers'].map((f) => edge(graph, 'Status quo', f))).toEqual([undefined, undefined]);
    expect(differential(undeclared)).toMatchObject({ mismatches: [], not_used: [] });
    expect(blindness(undeclared)).toEqual([]);
    // Contrast: A, on the drafted names, holds it by its name.
    const aDrafted = aOnDraftedNames(undeclared);
    const sqId = (aDrafted.nodes as Rec[]).find((n) => n.label === 'Status quo')!.id;
    expect((aDrafted.edges as Rec[]).filter((e) => e.from === sqId && e.origin === 'repair')).toHaveLength(2);
  });

  it('⛔ OPTION IDENTITY by the DECLARED status quo only (#3464 R2, Codex probe 1): an Olumi twin is left out whatever it is called', () => {
    // Codex probe 1. With ordinary names, Olumi's two options alike as drafted are left out (A and B agree).
    const regular = scienceDraft(); regular.options = regular.options.slice(0, 4);
    expect(ofKind(converted(regular).graph, 'option').map((o) => o.label)).toEqual(['Raise the price', 'Run a referral scheme']);
    expect(differential(regular)).toMatchObject({ mismatches: [], not_used: [] });
    // The same Olumi twin renamed "Status quo", with no status quo declared: A exempts it by its label; here it is the twin it is.
    const named = structuredClone(regular); named.options[3].label = 'Status quo';
    const out = converted(named);
    expect(out.declared.options[3].is_status_quo).toBeNull();
    expect(ofKind(out.graph, 'option').map((o) => o.label)).toEqual(['Raise the price', 'Run a referral scheme']);
    expect(out.loss.some((l) => String(l.field_path).endsWith('.option_indistinct') && String(l.reason).startsWith('I left out "Status quo" as a separate option'))).toBe(true);
    expect(differential(named).mismatches).toEqual([]);
    expect(differential(named).not_used).toEqual([]);
    expect(blindness(named)).toEqual([]);
    // Contrast: A, on the drafted names, exempts it by its name.
    expect(ofKind(aOnDraftedNames(named), 'option').map((o) => o.label)).toContain('Status quo');
  });

  it('⛔ OPTION IDENTITY by the DECLARED status quo only (#3464 R2, Codex probe 2): another domain, a duplicate setting gains no exemption from its name', () => {
    const sales = salesDraft();
    sales.options = [sales.options[0], { ...structuredClone(sales.options[0]), label: 'Plan Beta', provenance: 'inferred', is_status_quo: null }];
    expect(ofKind(converted(sales).graph, 'option').map((o) => o.label)).toEqual(['Double the ad spend']);
    sales.options[1].label = 'Status quo';
    expect(differential(sales).mismatches).toEqual([]);
    expect(ofKind(converted(sales).graph, 'option').map((o) => o.label)).toEqual(['Double the ad spend']);
    expect(differential(sales).not_used).toEqual([]);
    expect(blindness(sales)).toEqual([]);
    expect(ofKind(aOnDraftedNames(sales), 'option').map((o) => o.label)).toContain('Status quo');
  });

  it('OPTION IDENTITY controls (#3464 R2): a twin DECLARED the status quo, or stated by the user, stays whatever it is called; ordinary names are unchanged', () => {
    const sales = salesDraft();
    sales.options = [sales.options[0], { ...structuredClone(sales.options[0]), label: 'Plan Beta', provenance: 'inferred', is_status_quo: null }];
    expect(differential(sales)).toMatchObject({ mismatches: [], not_used: [] });
    // Controls, by the declared field: the same twin DECLARED the status quo stays, whatever it is called (A agrees).
    for (const label of ['Plan Beta', 'Status quo']) {
      const declared = structuredClone(sales); declared.options[1] = { ...declared.options[1], label, is_status_quo: true };
      expect(ofKind(converted(declared).graph, 'option').map((o) => o.label)).toEqual(['Double the ad spend', label]);
      expect(differential(declared)).toMatchObject({ mismatches: [], not_used: [] });
      expect(blindness(declared)).toEqual([]);
    }
    // A twin the user stated is never left out, whatever it is called (A agrees).
    const stated = structuredClone(sales); stated.options[1] = { ...stated.options[1], label: 'Status quo', provenance: 'explicit' };
    expect(ofKind(converted(stated).graph, 'option').map((o) => o.label)).toEqual(['Double the ad spend', 'Status quo']);
    expect(differential(stated)).toMatchObject({ mismatches: [] });
    expect(blindness(stated)).toEqual([]);
  });

  it('⛔ LABEL-BLIND (#3464 R2): A\'s Route A binds a definition by the goal\'s quantity words in a name, so B does not take it; the declared link stays as drafted', () => {
    const draft = definitionDraft();
    // Contrast: A, on the drafted names, compiles the definition into the goal's sum with a "today" part.
    const aDrafted = aOnDraftedNames(draft);
    expect((aDrafted.nodes as Rec[]).map((n) => n.label)).toContain('Orders per day today');
    const { graph } = converted(draft);
    expect((graph.nodes as Rec[]).map((n) => n.label)).not.toContain('Orders per day today');
    expect(ofKind(graph, 'goal')[0]!.nonlinear_identity).toBeUndefined();
    expect(edge(graph, 'Net change in orders per day', 'Orders per day')).toBeDefined();
    expect(differential(draft)).toMatchObject({ mismatches: [], a_created: [] });
    expect(blindness(draft)).toEqual([]);
  });

  it('⛔ LABEL-BLIND (#3464 R2): a part an option\'s NAME "creates" gets no 0 level here, never one shown as the person\'s; Olumi\'s product over it is A\'s refusal', () => {
    // SYNTHETIC: Olumi's product over a part the user named with no figure, and an option whose name opens with a creation verb.
    const draft: Rec = {
      goal: { kind: null, deliverable: null, metric: 'Weekly takings', operator: '>=', target_stated: true, value: 5000, unit: '£', horizon_months: 6,
        provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null, quantity_frame: 'level', basis: null },
      constraints: [], identities: [{ operation: 'product', outcome: 'Weekly takings', factors: ['Stall visitors', 'Spend per visitor'], provenance: 'inferred', evidence: null }],
      options: [sciOption('Launch a weekend stall', 'explicit', [], ['Stall visitors']), sciOption('Keep trading as now', 'ai_proposed', [], [], true)],
      factors: [{ ...factor('Stall visitors', null, 'visitors', 'explicit'), role: 'controllable' }, factor('Spend per visitor', 12, '£', 'explicit')],
      risks: [], outcomes: [], links: [link('Stall visitors', 'Weekly takings', 'positive'), link('Spend per visitor', 'Weekly takings', 'positive')],
      unknowns: [], decision_question: 'Should we add a weekend stall?', unknown_concerns: [], statements: [],
    };
    // Contrast: A, on the drafted names, reads "Launch" as creating the part, holds it at 0 as Olumi's reading, and keeps the product.
    const aDrafted = aOnDraftedNames(draft);
    expect((aDrafted.nodes as Rec[]).find((n) => n.label === 'Stall visitors')!.observed_state).toEqual({ value: 0, source: 'cee_inference' });
    expect((aDrafted.nodes as Rec[]).find((n) => n.kind === 'goal')!.nonlinear_identity?.operation).toBe('product');
    const { graph, loss } = converted(draft);
    expect(byLabel(graph, 'Stall visitors').observed_state).toBeUndefined();
    expect(ofKind(graph, 'goal')[0]!.nonlinear_identity).toBeUndefined();
    expect(loss.some((l) => String(l.field_path).endsWith('.nonlinear_identity_rejected') && String(l.reason).includes('"Stall visitors" has no figure yet'))).toBe(true);
    expect(differential(draft)).toMatchObject({ mismatches: [] });
    expect(blindness(draft)).toEqual([]);
  });

  // ⛔ AUTHORSHIP BY THE DRAFTER'S OWN CONTRACT (gap 3 swap, DL 19 Oct; `introducedBy`, runtime/build-model.ts): `explicit` is the
  // user's, `ai_proposed` Olumi's, `inferred` ("a reformulation of a supplied item, or genuinely unresolved … never ai_proposed by
  // default") UNKNOWN; a factor level is Olumi's estimate unless the AI declared it known. One row per figure class.
  it('⛔ AUTHORSHIP (setting): a setting the AI declared `inferred` is of unknown origin, never Olumi\'s', () => {
    const origin = (provenance: string): string => {
      const draft = salesDraft(); draft.options[0].interventions[0].provenance = provenance;
      const { graph } = converted(draft);
      return settingProvenanceOf(byLabel(graph, 'Double the ad spend').interventions[byLabel(graph, 'Ad spend').id]).origin;
    };
    expect(['explicit', 'ai_proposed', 'inferred'].map(origin)).toEqual(['human', 'ai', 'unknown']);
  });

  it('⛔ AUTHORSHIP (factor level): a level the AI declared known and `inferred` is of unknown origin; a level it did not declare known is Olumi\'s estimate', () => {
    const origin = (provenance: string, known: boolean, speaker?: 'other' | 'unknown'): string => {
      const draft = salesDraft(); draft.factors[0] = { ...draft.factors[0], provenance, baseline_known: known };
      if (speaker !== undefined) draft.statements = [statement('synthetic', 'Ad spend', speaker, 2000, '£')];
      return valueProvenanceOf(byLabel(converted(draft).graph, 'Ad spend').observed_state).origin;
    };
    expect([origin('explicit', true), origin('ai_proposed', true), origin('inferred', true)]).toEqual(['human', 'ai', 'unknown']);
    // The item's introducer is not the level's author: a factor the user named, with a level the AI did not declare known.
    expect([origin('explicit', false), origin('inferred', false)]).toEqual(['ai', 'ai']);
    // A declared speaker of another person, or an unknown one, still wins over "not declared known".
    expect([origin('explicit', false, 'other'), origin('ai_proposed', false, 'unknown')]).toEqual(['unknown', 'unknown']);
  });

  it('⛔ AUTHORSHIP (goal): today\'s level and the target the AI declared `inferred` are of unknown origin, listed where GraphV3 cannot hold it', () => {
    const draft = salesDraft(); draft.goal = { ...draft.goal, provenance: 'inferred', baseline_provenance: 'inferred' };
    const { graph, blocked_schema } = converted(draft);
    expect(valueProvenanceOf(ofKind(graph, 'goal')[0]!.observed_state).origin).toBe('unknown');
    expect(blocked_schema).toContainEqual({ field_path: 'nodes[monthly_pre_orders].goal_threshold_raw', declared: 'unknown', missing: 'target_origin' });
    // Contrast: declared the user's.
    const own = converted(salesDraft());
    expect(valueProvenanceOf(ofKind(own.graph, 'goal')[0]!.observed_state).origin).toBe('human');
    expect(own.blocked_schema.filter((b) => String(b.field_path).startsWith('nodes[monthly_pre_orders]'))).toEqual([]);
  });

  it('⛔ AUTHORSHIP (link): a link and a size the AI declared `inferred` are not Olumi\'s: the size keeps the placeholder, said, and both origins are listed', () => {
    const draft = salesDraft(); draft.links[0] = { ...draft.links[0], provenance: 'inferred', effect_provenance: 'inferred' };
    const { graph, loss, blocked_schema } = converted(draft);
    expect(blocked_schema).toEqual(expect.arrayContaining([
      { field_path: 'edges[ad_spend::monthly_pre_orders]', declared: 'unknown', missing: 'link_origin' },
      { field_path: 'edges[ad_spend::monthly_pre_orders]', declared: 'unknown', missing: 'link_size_origin' }]));
    expect(loss.some((l) => String(l.field_path) === 'edges[ad_spend::monthly_pre_orders].link_size_not_used')).toBe(true);
    // Contrast: declared Olumi's, the size is A's and nothing is listed.
    const olumi = converted(salesDraft());
    expect(olumi.blocked_schema.filter((b) => String(b.field_path).startsWith('edges['))).toEqual([]);
    expect(edge(olumi.graph, 'Ad spend', 'Monthly pre-orders')!.strength.mean).not.toBe(edge(graph, 'Ad spend', 'Monthly pre-orders')!.strength.mean);
  });

  it('⛔ AUTHORSHIP (risk): an unsized risk the AI declared `inferred` is not Olumi\'s suggestion, so it stays in the Run', () => {
    const draft = scienceDraft(); draft.risks[0] = { ...draft.risks[0], provenance: 'inferred' };
    expect(byLabel(converted(draft).graph, 'Competitor price cut').analysis_participation).toBeUndefined();
    expect(byLabel(converted(scienceDraft()).graph, 'Competitor price cut').analysis_participation).toBe('retained_excluded');
  });

  // ⭐ GAP 3 RULING (c) (DL 19 Oct): a "stay at or below" goal's declared level today is carried on A's science, with no brief read
  // (A reads the held ceiling only from the brief: 13 of 13 such stored drafts had no level on B).
  const ceilingDraft = (goal: Rec = {}): Rec => ({ ...salesDraft(), goal: { ...salesDraft().goal, operator: '<=', value: 300, baseline_value: 400, ...goal } });
  it('⭐ GOAL LEVEL (ceiling): a "<=" goal keeps the level the AI declared known and the user\'s, on A\'s cap and normalisation', () => {
    const draft = ceilingDraft();
    // A with no brief does not admit it (it reads the ceiling from the brief); B carries it.
    expect(ofKind(aOnDraftedNames(draft), 'goal')[0]!.observed_state).toBeUndefined();
    const { graph, loss } = converted(draft);
    const goal = ofKind(graph, 'goal')[0]!;
    const cap = goal.goal_threshold_cap as number;
    expect(goal).toMatchObject({ goal_direction: '<=', goal_threshold_raw: 300 });
    expect(goal.observed_state).toEqual({ value: 400 / cap, baseline: 400 / cap, unit: 'orders', raw_value: 400, cap, source: 'brief_extraction' });
    expect(valueProvenanceOf(goal.observed_state).origin).toBe('human');
    expect(loss.filter((l) => String(l.field_path).startsWith(`nodes[${goal.id}].observed_state`))).toEqual([]);
    // Contrast: a ">=" goal's level is A's, as before.
    expect(ofKind(converted(salesDraft()).graph, 'goal')[0]!.observed_state).toEqual(
      expect.objectContaining({ raw_value: 400, source: 'brief_extraction' }));
    // Who: a declared unknown speaker of the level wins, so it is carried with no author.
    const unknown = ceilingDraft(); unknown.statements = [said('synthetic', { kind: 'goal', label: 'Monthly pre-orders' }, 'level', 'point', { value: 400 }, 'unknown')];
    expect(valueProvenanceOf(ofKind(converted(unknown).graph, 'goal')[0]!.observed_state).origin).toBe('unknown');
  });

  it('GOAL LEVEL (ceiling): A\'s science still decides — a level already at the ceiling, an estimate, or a strict "<" is not carried, and said', () => {
    const notCarried = (goal: Rec): boolean => {
      const { graph, loss } = converted(ceilingDraft(goal));
      const g = ofKind(graph, 'goal')[0]!;
      return g.observed_state === undefined && loss.some((l) => String(l.field_path).startsWith(`nodes[${g.id}].observed_state`));
    };
    expect(notCarried({ baseline_value: 250 })).toBe(true);
    expect(notCarried({ baseline_provenance: 'ai_proposed' })).toBe(true);
    expect(notCarried({ baseline_provenance: 'inferred' })).toBe(true);
    expect(notCarried({ baseline_known: false })).toBe(true);
    expect(notCarried({ operator: '<' })).toBe(true);
    expect(notCarried({})).toBe(false);
  });

  // ⭐ THE DRAFT'S STATEMENTS ARE CARRIED, AS DATA (DL 19 Oct, gap 3 loss table: the bridge recorded 828 statements in 141 stored drafts
  // that path B did not). Each declared statement whose quote the user's words hold verbatim is recorded on its declared subject, as
  // construction records them; C5's GAP 1 claims use the same writer and subject keys.
  const SALES = ['We want 600 pre-orders a month within six months; we get 400 now.', 'We spend £2,000 a month on ads.', AD_QUOTE,
    'Our agency reckons doubling it means £3,500 to £4,500 a month.', 'A rival may cut prices.'];
  const SALES_WORDS = SALES.join(' ');
  const AT = '2026-10-19T22:00:00.000Z';
  const said = (quote: string, subject: Rec, field: string, form: string, figures: Rec, speaker: string | null): Rec => ({ quote,
    subject: { to_label: null, factor_label: null, ...subject }, field, form, value: null, low: null, high: null, unit: null, qualifier: null,
    conditions: null, speaker, ...figures });
  const carriedDraft = (): Rec => ({ ...salesDraft(),
    risks: [{ label: 'Rival price cut', provenance: 'explicit', unit: null, plausible_max: null, already_true_evidence: null }],
    statements: [
      said(SALES[0]!, { kind: 'goal', label: 'Monthly pre-orders' }, 'level', 'point', { value: 400, unit: 'orders' }, 'user'),
      said(SALES[0]!, { kind: 'goal', label: 'Monthly pre-orders' }, 'target', 'lower_bound', { value: 600, unit: 'orders' }, 'user'),
      said(SALES[1]!, { kind: 'factor', label: 'Ad spend' }, 'level', 'point', { value: 2000, unit: '£' }, 'user'),
      said(SALES[3]!, { kind: 'option', label: 'Double the ad spend', factor_label: 'Ad spend' }, 'level', 'range', { low: 3500, high: 4500, unit: '£' }, 'other'),
      said(AD_QUOTE, { kind: 'link', label: 'Ad spend', to_label: 'Monthly pre-orders' }, 'effect', 'point', { value: 1, unit: 'orders' }, 'user'),
      said(SALES[4]!, { kind: 'risk', label: 'Rival price cut' }, 'level', 'describes', {}, null),
      // Not recorded: a risk's holds-now reading (its card's), words the user did not write, and a subject not in the model.
      said(SALES[4]!, { kind: 'risk', label: 'Rival price cut' }, 'holds_now', 'holds_now', {}, 'user'),
      said('We get 450 now.', { kind: 'goal', label: 'Monthly pre-orders' }, 'level', 'point', { value: 450, unit: 'orders' }, 'user'),
      said(SALES[1]!, { kind: 'factor', label: 'Shelf space' }, 'level', 'point', { value: 3, unit: 'shelves' }, 'user'),
    ] });
  const record = (key: string, field: string, statements: Rec[]): Rec => ({ subject_key: key, field, recorded_at: AT, attest: { recorded_by: 'construction' },
    statements: statements.map((st) => ({ source: SALES_WORDS, reading: 'olumi', subject: { quantity: key, node_id: key.split('|')[1], ...(key.split('|')[3] ? { option_id: key.split('|')[3] } : {}) }, ...st })) });

  it('⭐ STATEMENTS CARRIED (gap 3): each declared statement the user\'s words hold is recorded on its subject, as construction records it', () => {
    const out = candidateToGraph(carriedDraft(), { words: SALES_WORDS, recorded_at: AT });
    if ('refused' in out) throw new Error(out.refused);
    const g = out.graph as Rec;
    expect(byLabel(g, 'Monthly pre-orders').user_statements).toEqual([
      record('goal|monthly_pre_orders|||level', 'level', [{ speaker: 'user', quote: SALES[0], form: 'point', low: 400, high: 400, unit: 'orders' }]),
      record('goal|monthly_pre_orders|||target', 'target', [{ speaker: 'user', quote: SALES[0], form: 'lower_bound', low: 600, unit: 'orders' }])]);
    expect(byLabel(g, 'Ad spend').user_statements).toEqual([
      record('factor|ad_spend|||level', 'level', [{ speaker: 'user', quote: SALES[1], form: 'point', low: 2000, high: 2000, unit: '£' }]),
      // Another person's range: their words, kept whole on the option's setting, from an unclear source (no name to record), listed.
      record('factor|ad_spend||double_the_ad_spend|level', 'level', [{ said_by: 'unknown', quote: SALES[3], form: 'range', low: 3500, high: 4500, unit: '£' }]),
      record('link|ad_spend|monthly_pre_orders||effect', 'effect', [{ speaker: 'user', quote: AD_QUOTE, form: 'point', low: 1, high: 1, unit: 'orders' }])]);
    expect(byLabel(g, 'Rival price cut').user_statements).toEqual([
      record('risk|rival_price_cut|||level', 'level', [{ said_by: 'unknown', quote: SALES[4], form: 'describes' }])]);
    expect(out.blocked_schema).toContainEqual({ field_path: 'nodes[ad_spend].user_statements', declared: 'other', missing: 'speaker_name' });
    // Nothing else is recorded: 6 of the 9 declared statements.
    expect((g.nodes as Rec[]).flatMap((n) => (n.user_statements ?? []) as Rec[]).flatMap((r) => r.statements as Rec[])).toHaveLength(6);
    expect(GraphV3.safeParse(g).success).toBe(true);
  });

  it('STATEMENTS CARRIED (contrast): without the user\'s words nothing is recorded, and the rest of the model is the same', () => {
    const bare = converted(carriedDraft());
    expect((bare.graph.nodes as Rec[]).filter((n) => n.user_statements !== undefined)).toEqual([]);
    const out = candidateToGraph(carriedDraft(), { words: SALES_WORDS, recorded_at: AT });
    if ('refused' in out) throw new Error(out.refused);
    const strip = (g: Rec): Rec => ({ ...g, nodes: (g.nodes as Rec[]).map(({ user_statements: _s, ...n }) => n) });
    expect(strip(out.graph as Rec)).toEqual(bare.graph);
    expect(out.loss).toEqual(bare.loss);
  });

  it('⛔ LABEL-BLIND (#3464 R2): B\'s graph is the same under any names, for every synthetic draft', () => {
    const drafts = [dilemmaDraft(), salesDraft(), salesDraft('user'), sumDraft(400), sumDraft(500), sumDraft(400, 'user'), structureDraft(),
      scienceDraft(), scienceDraft({ userFold: true }), scienceDraft({ otherFold: true }), scienceDraft({ undeclaredStatusQuo: true }), scienceDraft({ otherRisk: true })];
    expect(drafts.flatMap(blindness)).toEqual([]);
  });

  it('protocol only: a draft with no goal is refused as unreadable; nothing is refused for what it means', () => {
    expect(candidateToGraph(null)).toEqual({ refused: 'candidate_invalid' });
    expect(candidateToGraph({ goal: { metric: ' ' }, options: [], factors: [], links: [] })).toEqual({ refused: 'candidate_invalid' });
  });
});
