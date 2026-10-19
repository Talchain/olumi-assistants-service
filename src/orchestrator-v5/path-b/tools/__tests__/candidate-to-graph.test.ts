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

const converted = (draft: Rec): { graph: Rec; declared: Rec; loss: Rec[]; blocked_schema: Rec[] } => {
  const out = candidateToGraph(draft);
  if ('refused' in out) throw new Error(`refused: ${out.refused}`);
  return out as unknown as { graph: Rec; declared: Rec; loss: Rec[]; blocked_schema: Rec[] };
};
const byLabel = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((n) => n.label === label)!;
const ofKind = (g: Rec, kind: string): Rec[] => (g.nodes as Rec[]).filter((n) => n.kind === kind);
const edge = (g: Rec, from: string, to: string): Rec | undefined =>
  (g.edges as Rec[]).find((e) => e.from === byLabel(g, from).id && e.to === byLabel(g, to).id);

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
    // £2,000 of £10,000: 0.2. Double = £4,000: 0.4. Add £1,000 = £2,000 + £1,000 = £3,000: 0.3, a computed total.
    expect(byLabel(graph, 'Ad spend').observed_state).toMatchObject({ value: 0.2, raw_value: 2000, cap: 10000 });
    const levelOf = (option: string): Rec => byLabel(graph, option).interventions[byLabel(graph, 'Ad spend').id];
    expect(levelOf('Double the ad spend')).toMatchObject({ value: 0.4, raw_value: 4000, source: 'brief_extraction' });
    expect(levelOf('Add £1,000 of ad spend')).toMatchObject({ value: 0.3, raw_value: 3000, value_confidence: 'medium' });
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
    const off = converted(sumDraft(500));
    expect(ofKind(off.graph, 'goal')[0]!.nonlinear_identity).toBeUndefined();
    expect(off.loss.map((l) => l.reason).join(' ')).toContain('while those parts add up to');
    // Definitions the AI declared as the user's are a person's sizes: Olumi's placeholder, listed, so no sum is carried on them.
    const theirs = converted(sumDraft(400, 'user'));
    expect(ofKind(theirs.graph, 'goal')[0]!.nonlinear_identity).toBeUndefined();
    expect(theirs.blocked_schema.filter((b) => b.missing === 'link_size_origin').map((b) => b.declared)).toEqual(['user', 'user']);
  });

  // ⭐ GENERATIVE (DL, 19 Oct): at every derivation site, flip one input's origin; the derived figure's origin follows the ONE
  // rule — the inputs' shared origin, else Olumi's derived reading — and a mixed total says both inputs' origins.
  const ORIGINS = ['user', 'olumi', 'other', 'unknown'] as const;
  type O = typeof ORIGINS[number];
  const readAs: Record<O, string> = { user: 'human', olumi: 'ai', other: 'unknown', unknown: 'unknown' };
  const statementBy = (subject: Rec, speaker: O): Rec[] => (speaker === 'other' || speaker === 'unknown' ? [{ quote: 'synthetic',
    subject: { to_label: null, factor_label: null, ...subject }, field: 'level', form: 'point', value: null, low: null, high: null, unit: null,
    qualifier: null, conditions: null, speaker }] : []);
  it.each(ORIGINS.flatMap((today) => ORIGINS.map((added) => [today, added] as const)))(
    'GENERATIVE (addition): today\'s £2,000 by %s + £1,000 by %s = £3,000, whose origin follows the one rule', (today, added) => {
      const draft = salesDraft();
      draft.factors[0].provenance = today === 'olumi' ? 'inferred' : 'explicit';
      draft.factors[0].baseline_known = today !== 'olumi';
      draft.options[1].interventions[0].provenance = added === 'olumi' ? 'ai_proposed' : 'explicit';
      draft.statements = [...statementBy({ kind: 'factor', label: 'Ad spend' }, today),
        ...statementBy({ kind: 'option', label: 'Add £1,000 of ad spend', factor_label: 'Ad spend' }, added)];
      const { graph, loss } = converted(draft);
      const total = byLabel(graph, 'Add £1,000 of ad spend').interventions[byLabel(graph, 'Ad spend').id];
      const expected: O = today === added ? today : 'olumi';
      expect(total).toMatchObject({ raw_value: 3000, value: 0.3 });
      expect(settingProvenanceOf(total).origin).toBe(readAs[expected]);
      const said = loss.filter((l) => String(l.field_path).endsWith('.derived_total')).map((l) => l.reason);
      expect(said).toHaveLength(today === added ? 0 : 1);
      if (today !== added) expect(said[0]).toContain('sets "Ad spend" to £3,000, Olumi\'s derived reading: ');
    });
  it('GENERATIVE (addition): the mixed note says each input with its own origin', () => {
    const draft = salesDraft();
    draft.factors[0].provenance = 'inferred'; draft.factors[0].baseline_known = false;
    const { loss } = converted(draft);
    expect(loss.map((l) => l.reason)).toContain('"Add £1,000 of ad spend" sets "Ad spend" to £3,000, Olumi\'s derived reading: '
      + 'Olumi\'s £2,000 estimate + your £1,000.');
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

  it('round 2 (B2): an "above" target keeps today\'s level on the floor rule (400 of 750), with no label read', () => {
    const draft = salesDraft(); draft.goal.operator = '>';
    const goal = ofKind(converted(draft).graph, 'goal')[0]!;
    expect(goal).toMatchObject({ goal_direction: '>', observed_state: { baseline: 400 / 750, raw_value: 400 } });
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

  it('round 2 (B7): a relative change in % is not carried yet (said, kept, no label read); a change in the metric\'s own unit is', () => {
    const rel = salesDraft(); rel.goal = { ...rel.goal, frame: 'change_rel', value: 10, unit: '%' };
    const r = converted(rel);
    expect('goal_threshold_raw' in ofKind(r.graph, 'goal')[0]!).toBe(false);
    expect(r.loss.map((l) => l.reason).join(' ')).toContain('does not say whether "Monthly pre-orders" is itself measured in %');
    expect(r.declared.goal).toMatchObject({ frame: 'change_rel', value: 10 });
    const abs = salesDraft(); abs.goal = { ...abs.goal, frame: 'change_abs', value: 200 };
    expect(ofKind(converted(abs).graph, 'goal')[0]).toMatchObject({ goal_threshold_frame: 'change_abs', goal_threshold_raw: 200 });
  });

  it('protocol only: a draft with no goal is refused as unreadable; nothing is refused for what it means', () => {
    expect(candidateToGraph(null)).toEqual({ refused: 'candidate_invalid' });
    expect(candidateToGraph({ goal: { metric: ' ' }, options: [], factors: [], links: [] })).toEqual({ refused: 'candidate_invalid' });
  });
});
