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
import { candidateToGraph } from '../candidate-to-graph.js';
import { admitCandidateModel } from '../../../agent-lane/admit-model.js';
import { settingProvenanceOf, valueProvenanceOf } from '../../../../cee/provenance/provenance-of.js';
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
const salesDraft = (): Rec => ({
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
  links: [link('Ad spend', 'Monthly pre-orders', 'positive', AD_QUOTE, { effect_amount: 1, effect_per_source_change: 20, effect_provenance: 'explicit' })],
  identities: [], unknowns: [], decision_question: 'How should we change our ad spend?', unknown_concerns: [], statements: [],
});

// A goal the AI declared to be two parts added together, with the sentence it read it from.
const sumDraft = (totalToday: number): Rec => ({
  ...salesDraft(),
  goal: { ...salesDraft().goal, metric: 'Total orders', baseline_value: totalToday },
  options: [{ label: 'Open a market stall', provenance: 'explicit', changes: ['Shop orders'], interventions: [], added_capacity: null, is_status_quo: null }],
  factors: [
    { label: 'Online orders', role: 'observable', baseline_known: true, baseline_value: 300, unit: 'orders', provenance: 'explicit', plausible_max: null },
    { label: 'Shop orders', role: 'observable', baseline_known: true, baseline_value: 100, unit: 'orders', provenance: 'explicit', plausible_max: null },
  ],
  links: ['Online orders', 'Shop orders'].map((part) => link(part, 'Total orders', 'positive', null,
    { provenance: 'explicit', effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'explicit', definitional: true })),
  identities: [{ operation: 'sum', outcome: 'Total orders', factors: ['Online orders', 'Shop orders'],
    evidence: { quote: 'All our orders come either online or from the shop.' } }],
});

const converted = (draft: Rec, brief = BRIEF): { graph: Rec; declared: Rec; loss: Rec[] } => {
  const out = candidateToGraph(draft, brief);
  if ('refused' in out) throw new Error(`refused: ${out.refused}`);
  return out as unknown as { graph: Rec; declared: Rec; loss: Rec[] };
};
const byLabel = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((n) => n.label === label)!;
const ofKind = (g: Rec, kind: string): Rec[] => (g.nodes as Rec[]).filter((n) => n.kind === kind);
const edge = (g: Rec, from: string, to: string): Rec | undefined =>
  (g.edges as Rec[]).find((e) => e.from === byLabel(g, from).id && e.to === byLabel(g, to).id);

describe('candidateToGraph: conversion + science only', () => {
  it('⭐ the dated-dilemma draft → a valid graph with the aim open, every drafted claim kept with the origin the AI declared', () => {
    const draft = dilemmaDraft();
    const { graph, declared, loss } = converted(draft);
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
    const { graph, declared } = converted(salesDraft(), 'synthetic');
    expect(GraphV3.safeParse(graph).success).toBe(true);
    // 600 orders: cap 600 × 1.25 = 750 (target headroom); today's 400 is 400 / 750 on it; the declared direction and horizon held.
    expect(ofKind(graph, 'goal')[0]).toMatchObject({ goal_threshold_raw: 600, goal_threshold_cap: 750, goal_threshold: 0.8,
      goal_direction: '>=', goal_horizon_months: 6, observed_state: { baseline: 400 / 750, raw_value: 400, cap: 750, source: 'brief_extraction' } });
    // £2,000 of £10,000: 0.2. Double = £4,000: 0.4. Add £1,000 = £2,000 + £1,000 = £3,000: 0.3, a computed total.
    expect(byLabel(graph, 'Ad spend').observed_state).toMatchObject({ value: 0.2, raw_value: 2000, cap: 10000 });
    const levelOf = (option: string): Rec => byLabel(graph, option).interventions[byLabel(graph, 'Ad spend').id];
    expect(levelOf('Double the ad spend')).toMatchObject({ value: 0.4, raw_value: 4000, source: 'brief_extraction' });
    expect(levelOf('Add £1,000 of ad spend')).toMatchObject({ value: 0.3, raw_value: 3000, value_confidence: 'medium' });
    expect(settingProvenanceOf(levelOf('Double the ad spend')).origin).toBe('human');
    // One order per £20 is the user's stated size: 1/20 × 10,000 / 750 = 0.6667 on the goal's frame, its sentence kept.
    const sized = edge(graph, 'Ad spend', 'Monthly pre-orders')!;
    expect(sized.strength.mean).toBeCloseTo(10000 / 20 / 750, 6);
    expect(sized.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: AD_QUOTE });
    // The declared status quo is held at today's level of what the others set.
    expect(byLabel(graph, 'Keep spending as now').is_baseline).toBe(true);
    expect(edge(graph, 'Keep spending as now', 'Ad spend')).toBeDefined();
    expect(declared.statements).toEqual([]);
  });

  it('⭐ SCIENCE: a level already above an "at least" target is upside down, so it is not used (the existing rule and words)', () => {
    const draft = salesDraft(); draft.goal.baseline_value = 700;
    const { graph, loss } = converted(draft, 'synthetic');
    expect(ofKind(graph, 'goal')[0]!.observed_state).toBeUndefined();
    expect(ofKind(graph, 'goal')[0]!.goal_threshold_raw).toBe(600);
    expect(loss.map((l) => l.reason).join(' ')).toContain('is already above the target of 600');
  });

  it('⭐ SCIENCE: a declared sum is carried when today\'s parts add up (300 + 100 = 400), as Olumi\'s reading; refused when they do not', () => {
    const kept = converted(sumDraft(400), 'synthetic');
    expect(ofKind(kept.graph, 'goal')[0]!.nonlinear_identity).toEqual({ operation: 'sum',
      factor_ids: [byLabel(kept.graph, 'Online orders').id, byLabel(kept.graph, 'Shop orders').id], stated_in_brief: false });
    const off = converted(sumDraft(500), 'synthetic');
    expect(ofKind(off.graph, 'goal')[0]!.nonlinear_identity).toBeUndefined();
    expect(off.loss.map((l) => l.reason).join(' ')).toContain('while those parts add up to');
  });

  it('protocol only: a draft with no goal is refused as unreadable; nothing is refused for what it means', () => {
    expect(candidateToGraph(null, 'x')).toEqual({ refused: 'candidate_invalid' });
    expect(candidateToGraph({ goal: { metric: ' ' }, options: [], factors: [], links: [] }, 'x')).toEqual({ refused: 'candidate_invalid' });
  });
});
