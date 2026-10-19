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
import { candidateToAdmittedGraph, candidateToGraph, type AdmitDraft } from '../candidate-to-graph.js';
import { admitCandidateModel, admitOrdinaryCandidateModel, canonicalLabel, withQuantityFrames } from '../../../agent-lane/admit-model.js';
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
  provenance: quote === null ? 'inferred' : 'explicit', effect_amount: null, effect_per_source_change: null, effect_provenance: null,
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
    { effect_amount: 1, effect_per_source_change: 20, effect_provenance: size === 'user' ? 'explicit' : 'inferred' })],
  identities: [], unknowns: [], decision_question: 'How should we change our ad spend?', unknown_concerns: [], statements: [],
});

// Structure A shapes itself: a loop between two factors, a limit, and a later ambition (A restates that node's label, keeping its id).
const structureDraft = (): Rec => ({
  ...salesDraft(),
  constraints: [{ metric: 'Ad spend', operator: '<=', value: 5000, unit: '£', provenance: 'explicit', frame: 'level', role: 'limit' },
    { metric: 'Word of mouth', operator: '>=', value: 200, unit: 'mentions', provenance: 'explicit', frame: 'level', role: 'ambition' }],
  factors: [...salesDraft().factors, factor('Word of mouth', 50, 'mentions', 'explicit')],
  links: [...salesDraft().links, link('Ad spend', 'Word of mouth', 'positive', null, { effect_amount: 1, effect_per_source_change: 100, effect_provenance: 'inferred' }),
    link('Word of mouth', 'Ad spend', 'positive'), link('Word of mouth', 'Monthly pre-orders', 'positive', null, { effect_amount: 1, effect_per_source_change: 5, effect_provenance: 'inferred' })],
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
    { provenance: definedBy === 'user' ? 'explicit' : 'inferred', effect_amount: 1, effect_per_source_change: 1,
      effect_provenance: definedBy === 'user' ? 'explicit' : 'inferred', definitional: true })),
  identities: [{ operation: 'sum', outcome: 'Total orders', factors: ['Online orders', 'Shop orders'],
    evidence: { quote: 'All our orders come either online or from the shop.' } }],
});

// A's admission with no brief, injected as the build injects its own (S7: the converter never imports the raw admitter).
const admitA: AdmitDraft = (c) => {
  try { return admitCandidateModel(withQuantityFrames(c), {}, undefined); } catch { return admitOrdinaryCandidateModel(withQuantityFrames(c), {}, undefined); }
};
const converted = (draft: Rec): { graph: Rec; declared: Rec; loss: Rec[]; blocked_schema: Rec[] } => {
  const out = candidateToGraph(draft, admitA);
  if ('refused' in out) throw new Error(`refused: ${out.refused}`);
  return out as unknown as { graph: Rec; declared: Rec; loss: Rec[]; blocked_schema: Rec[] };
};
const byLabel = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((n) => n.label === label)!;
const ofKind = (g: Rec, kind: string): Rec[] => (g.nodes as Rec[]).filter((n) => n.kind === kind);
const edge = (g: Rec, from: string, to: string): Rec | undefined =>
  (g.edges as Rec[]).find((e) => e.from === byLabel(g, from).id && e.to === byLabel(g, to).id);

/**
 * The differential: A's own admission of the draft (the build's preparation + admission, no brief) against B's converted
 * graph before the refit chain. For every figure A admits — a value, a level, a goal threshold, a limit, a link size — B's
 * number, unit, frame and sign must equal A's. A person's link size B keeps as a placeholder (DL ruling (a)) and a level in
 * another unit than its factor or set on something that is not a factor (B does not use it, and says so) are counted apart,
 * never as equal. A draft B refuses as unreadable is reported with A's figures it does not carry.
 */
function differential(draft: Rec): { compared: number; equal: number; mismatches: string[]; not_used: string[]; a_created: string[]; refused?: { reason: string; figures: number } } {
  const prepared = prepareProvisionalCandidate(draft as never).candidate;
  const a: Rec = admitA(prepared);
  const converted = candidateToAdmittedGraph(draft, admitA);
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
  for (const n of a.nodes as Rec[]) {
    if (n.kind === 'decision' || n.kind === 'option') continue;
    if (aCreated.has(n.id)) { a_created.push(`node ${key(n)}`); continue; }
    const bn = bNodeFor(n);
    check(`node ${key(n)}`, n, bn, ['scale_frame', 'goal_threshold', 'goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold_unit', 'goal_threshold_frame', 'quantity_frame']);
    check(`node ${key(n)}.observed_state`, n.observed_state, bn?.observed_state, ['value', 'raw_value', 'cap', 'unit', 'baseline']);
  }
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
  const structural = new Set((a.nodes as Rec[]).filter((n) => n.kind === 'option' || n.kind === 'decision').map((n) => n.id));
  for (const e of (a.edges as Rec[]).filter((x) => !structural.has(x.from))) {
    const where = `edge ${aKey.get(e.from)} → ${aKey.get(e.to)}`;
    if (aCreated.has(e.from) || aCreated.has(e.to)) { a_created.push(where); continue; }
    const be = (bg.edges as Rec[]).find((x) => x.from === bIdFor(e.from) && x.to === bIdFor(e.to));
    if (be !== undefined && personSized.has(`edges[${be.from}::${be.to}]`)) { not_used.push(`person_size: ${where}`); continue; }
    check(where, e, be, ['exists_probability', 'effect_direction']);
    check(`${where}.strength`, e.strength, be?.strength, ['mean', 'std']);
    check(`${where}.natural_effect`, e.provenance?.natural_effect, be?.provenance?.natural_effect, ['amount', 'per_source_change', 'amount_unit', 'per_source_change_unit']);
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
    const drafts = [dilemmaDraft(), salesDraft(), salesDraft('user'), sumDraft(400), sumDraft(500), sumDraft(400, 'user'), structureDraft()];
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
      mismatches: results.flatMap((r, i) => r.mismatches.map((m) => `#${i} ${m}`)) };
    if (process.env.C2G_DIFFERENTIAL_OUT) writeFileSync(process.env.C2G_DIFFERENTIAL_OUT, JSON.stringify(summary, null, 1));
    expect(summary.mismatches).toEqual([]);
  }, 600_000);

  it('protocol only: a draft with no goal is refused as unreadable; nothing is refused for what it means', () => {
    expect(candidateToGraph(null, admitA)).toEqual({ refused: 'candidate_invalid' });
    expect(candidateToGraph({ goal: { metric: ' ' }, options: [], factors: [], links: [] }, admitA)).toEqual({ refused: 'candidate_invalid' });
  });
});
