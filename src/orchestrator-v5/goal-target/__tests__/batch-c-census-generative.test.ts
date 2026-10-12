/**
 * Recovery Batch C — RE-SCOPE 2 (DL ruling 12 Oct, R5-1 / R5-2; DL AMEND after AIE #94 6119326092 and the marginal ruling (B)):
 * THE SPEC INVARIANT OF THE ESTIMATE CENSUS, GENERATIVELY.
 *
 * The inputs a figure rests on are, for EVERY node N with a path to ANY node of the event that figure MEASURES (the goal alone
 * for the goal's own chance; the goal and every condition sent for the joint; one target for its own marginal), the event's
 * nodes included: (a) N's starting value; (b) every setting of every option in this Run on N; (c) every link into N (an option's
 * own link to the node it sets is that setting, counted once). THREE provenance states: HUMAN only by positive attestation;
 * AI only for a recognised AI source (counted, provisional); anything else UNVERIFIED — never counted as Olumi's, never the
 * person's, never "zero estimates": disclosed once beside the result.
 *
 * This spec does NOT hand-list categories. It builds one all-human graph — the goal, a second target, an included limit, an
 * exogenous input (a factor no option sets, two hops from a target) and an option setting on every other node, the scored
 * goal included — then walks the graph GENERICALLY: every node's starting value, every option cell, every edge. Each input is
 * flipped ALONE to Olumi's, then to unverified, and the single (goal-alone) and joint (every condition sent) licences — the
 * joint's marginal notes too — are checked against the definition above, computed here by a plain reverse walk, with each
 * position's APPLICABLE existing disposition (AIE R5 item 2): the scored goal's own level as Olumi's estimate is withheld
 * (admission's stronger rule; an unverified one is disclosed, never a new human-only rule); a second target's Olumi base
 * withholds the joint (`olumi_base`). Contrast: an input NOT upstream
 * of any event node changes nothing. Hand-written figures throughout; the licence never computes a chance.
 */
import { describe, expect, it } from 'vitest';

import { goalChanceLicenceOf, UNVERIFIED_SOURCES_NOTE, withGoalChanceLicence } from '../goal-chance-licence.js';
import { wireGoalConstraints } from '../../tools/handlers/run-analysis.js';
import { goalChanceCellFacesForAgent, goalChanceNotesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';

type Rec = Record<string, any>;

const PERSONS_LEVEL = (raw: number, cap: number, unit: string): Rec => ({ value: raw / cap, raw_value: raw, cap, unit, source: 'brief_extraction', extractionType: 'explicit' });
const OLUMIS_LEVEL = (os: Rec): Rec => ({ ...os, source: 'cee_inference', extractionType: 'inferred' });
/** A starting value whose source is not recorded at all: UNVERIFIED (neither attested as the person's nor a recognised AI source). */
const UNRECORDED_LEVEL = (os: Rec): Rec => { const { source: _s, extractionType: _e, ...rest } = os; return rest; };
const PERSONS_LINK = (): Rec => ({ strength: { mean: 0.3, std: 0.05 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified', magnitude: 'user_stated' } });
const OLUMIS_LINK_PROVENANCE = { source: 'cee_hypothesis', magnitude: 'olumi_estimate' };
const PERSONS_CELL = (node: string): Rec => ({ value: 0.6, raw_value: 60, source: 'user_specified', target_match: { node_id: node } });

const GOAL = 'new_customers';
const BASIS = { quantity_frame: 'level', target_frame: 'level', target_raw: 20, reference: 'launch', period_months: 3, period_kind: 'over_period',
  effect_unit: 'customers and percentage points over the first three months after launch', effects_at_period_end: true, source: 'olumi_reading' };
const ROWS = [
  { constraint_id: 'target:new_customers', node_id: 'new_customers', operator: '>=', value: 20, unit: 'customers', value_frame: 'level', role: 'goal_target' },
  { constraint_id: 'target:conversion_rate', node_id: 'conversion_rate', operator: '>=', operator_as_stated: '>', value: 15, unit: '%', value_frame: 'level', role: 'goal_target' },
  { constraint_id: 'limit:annual_spend', node_id: 'annual_spend', operator: '<=', value: 50000, unit: 'GBP', value_frame: 'level' },
];

/**
 * The all-human graph. ‘AI planning plus advertising’ sets EVERY non-option node (the scored goal, the second target, the
 * included limit, every factor — the off-path ‘Team morale’ too); ‘Hire a marketing manager’ sets only its own lever, so for
 * it ‘Season’ is an exogenous input (no setting of its own). ‘Team morale’ is DOWNSTREAM of the goal: upstream of no event node.
 */
function allHuman(): Rec {
  const factor = (id: string, label: string, raw: number, cap: number, unit: string): Rec =>
    ({ id, kind: 'factor', label, observed_state: PERSONS_LEVEL(raw, cap, unit) });
  const nodes: Rec[] = [
    { id: 'which_plan', kind: 'decision', label: 'Which plan?' },
    { id: GOAL, kind: 'goal', label: 'New customers', goal_threshold_frame: 'level', goal_threshold_raw: 20, goal_threshold_unit: 'customers',
      goal_threshold_cap: 25, goal_threshold: 0.8, goal_direction: '>=', goal_target_basis: BASIS, observed_state: PERSONS_LEVEL(5, 25, 'customers') },
    factor('conversion_rate', 'Conversion rate', 10, 100, '%'),
    factor('annual_spend', 'Annual spend', 40000, 100000, 'GBP'),
    factor('pricing', 'Pricing', 30, 100, 'points'),
    factor('outreach', 'Outreach', 40, 100, 'points'),
    factor('ad_quality', 'Ad quality', 40, 100, 'points'),
    factor('season', 'Season', 30, 100, 'points'),
    factor('demand', 'Market demand', 50, 100, 'points'),
    factor('morale', 'Team morale', 50, 100, 'points'),
    { id: 'hire_manager', kind: 'option', label: 'Hire a marketing manager', interventions: { outreach: PERSONS_CELL('outreach') } },
    { id: 'ai_plus_ads', kind: 'option', label: 'AI planning plus advertising', interventions: {} },
  ];
  const everyOther = nodes.filter((n) => n.kind !== 'option' && n.kind !== 'decision').map((n) => n.id as string);
  nodes.find((n) => n.id === 'ai_plus_ads')!.interventions = Object.fromEntries(everyOther.map((id) => [id, PERSONS_CELL(id)]));
  const edges: Rec[] = [
    ...['hire_manager', 'ai_plus_ads'].map((o) => ({ from: 'which_plan', to: o, ...PERSONS_LINK() })),
    { from: 'hire_manager', to: 'outreach', ...PERSONS_LINK() },
    ...everyOther.map((id) => ({ from: 'ai_plus_ads', to: id, ...PERSONS_LINK() })),
    { from: 'outreach', to: GOAL, ...PERSONS_LINK() },
    { from: 'conversion_rate', to: GOAL, ...PERSONS_LINK() },
    { from: 'ad_quality', to: 'conversion_rate', ...PERSONS_LINK() },
    { from: 'season', to: 'demand', ...PERSONS_LINK() },
    { from: 'demand', to: 'conversion_rate', ...PERSONS_LINK() },
    { from: 'pricing', to: 'annual_spend', ...PERSONS_LINK() },
    { from: GOAL, to: 'morale', ...PERSONS_LINK() },
  ];
  return { nodes, edges, goal_constraints: structuredClone(ROWS) };
}

const PRECISION = { n_informative: 10000, standard_error: 0.005 };
const RUN = (): Rec => ({ option_comparison: [
  { option_id: 'hire_manager', probability_of_goal: 0.6, probability_of_joint_goal: 0.35, probability_of_joint_goal_precision: PRECISION,
    constraint_probabilities: { 'target:new_customers': 0.6, 'target:conversion_rate': 0.42, 'limit:annual_spend': 0.9 },
    constraint_probabilities_precision: { 'target:new_customers': PRECISION, 'target:conversion_rate': PRECISION } },
  { option_id: 'ai_plus_ads', probability_of_goal: 0.7, probability_of_joint_goal: 0.48, probability_of_joint_goal_precision: PRECISION,
    constraint_probabilities: { 'target:new_customers': 0.7, 'target:conversion_rate': 0.55, 'limit:annual_spend': 0.8 },
    constraint_probabilities_precision: { 'target:new_customers': PRECISION, 'target:conversion_rate': PRECISION } },
] });

type Which = 'single' | 'joint';
/** Single: no target row sent — the goal alone (the limit stays outside, amendment 4). Joint: every condition sent. */
const constraintsFor = (g: Rec, which: Which): Rec => {
  const rows = which === 'joint' ? g.goal_constraints : (g.goal_constraints as Rec[]).filter((r) => r.role !== 'goal_target');
  return { storedConstraints: rows, sentConstraints: wireGoalConstraints(rows) };
};
const licenceOf = (g: Rec, which: Which): Rec => goalChanceLicenceOf(RUN(), g, GOAL, () => false, undefined, g, constraintsFor(g, which)) as Rec;
/** The event: the scored goal alone, or the goal and every condition the joint sends (targets AND the included limit). */
const eventOf = (which: Which): string[] => (which === 'single' ? [GOAL] : [...new Set([GOAL, ...ROWS.map((r) => r.node_id)])]);

/** Everything with a path to an event node, by a plain reverse walk over EVERY edge (the definition, not the code under test). */
function upstreamOf(g: Rec, event: readonly string[]): Set<string> {
  const seen = new Set(event);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of g.edges as Rec[]) if (seen.has(e.to) && !seen.has(e.from)) { seen.add(e.from); grew = true; }
  }
  return seen;
}

/** The licence's own disclosure counts, read by identity (absent = 0), and how often the unverified note is said. */
const countsOf = (l: Rec): Rec => ({
  links: l.olumi_estimate_link_count ?? 0, values: l.olumi_estimate_value_count ?? 0, settings: l.olumi_estimate_settings_by_option ?? {},
  unverified: ((l.notes as string[] | undefined) ?? []).filter((n) => n === UNVERIFIED_SOURCES_NOTE).length,
  provisional: l.provisional === true,
});
const ZERO = { links: 0, values: 0, settings: {}, unverified: 0, provisional: false };
const LABEL: Record<string, string> = { hire_manager: 'Hire a marketing manager', ai_plus_ads: 'AI planning plus advertising' };
const COUNT_WORDS = { link: '1 relationship', value: '1 starting value', setting: '1 option setting' } as const;
/** The joint's "On its own" estimate notes (DL marginal ruling (B)). */
const marginalNotes = (l: Rec): string[] => ((l.notes as string[] | undefined) ?? []).filter((n) => n.startsWith('On its own, the chance of '));

/** One input of the graph, found GENERICALLY: a node's starting value, an option's cell, or an edge. */
interface Input {
  readonly name: string;
  readonly kind: 'value' | 'setting' | 'link';
  /** The node this input feeds: its own node, the node a setting sets, or the edge's head. */
  readonly feeds: string;
  readonly option?: string;
  readonly toOlumi: (g: Rec) => void;
  readonly toUnknown?: (g: Rec) => void;
}
function inputsOf(g: Rec): Input[] {
  const out: Input[] = [];
  const nodeOf = (h: Rec, id: string): Rec => (h.nodes as Rec[]).find((n) => n.id === id)!;
  for (const n of g.nodes as Rec[]) {
    if (n.observed_state !== undefined && Number.isFinite(n.observed_state.value)) {
      out.push({ name: `value of ${n.id}`, kind: 'value', feeds: n.id,
        toOlumi: (h) => { nodeOf(h, n.id).observed_state = OLUMIS_LEVEL(nodeOf(h, n.id).observed_state); },
        toUnknown: (h) => { nodeOf(h, n.id).observed_state = UNRECORDED_LEVEL(nodeOf(h, n.id).observed_state); } });
    }
    for (const target of Object.keys(n.kind === 'option' ? n.interventions ?? {} : {})) {
      out.push({ name: `setting of ${n.id} on ${target}`, kind: 'setting', feeds: target, option: n.id,
        toOlumi: (h) => { nodeOf(h, n.id).interventions[target].source = 'cee_hypothesis'; },
        toUnknown: (h) => { delete nodeOf(h, n.id).interventions[target].source; } });
    }
  }
  for (const [i, e] of (g.edges as Rec[]).entries()) {
    const own = (g.nodes as Rec[]).find((n) => n.id === e.from && n.kind === 'option')?.interventions?.[e.to] !== undefined;
    // An option's own link to the node it sets IS that setting (counted once, by the setting): see the contrast below.
    if (own) continue;
    out.push({ name: `link ${e.from} -> ${e.to}`, kind: 'link', feeds: e.to,
      toOlumi: (h) => { (h.edges as Rec[])[i]!.provenance = { ...OLUMIS_LINK_PROVENANCE }; } });
  }
  return out;
}

/** What one flipped input must add, by the definition: +1 of its own kind (a setting on its own option only), or nothing. */
function expected(input: Input, which: Which, as: 'olumi' | 'unknown'): Rec {
  if (!upstreamOf(allHuman(), eventOf(which)).has(input.feeds)) return ZERO;
  if (as === 'olumi') {
    return { ...ZERO, provisional: true,
      ...(input.kind === 'link' ? { links: 1 } : input.kind === 'value' ? { values: 1 } : { settings: { [input.option!]: 1 } }) };
  }
  // UNVERIFIED: never counted as Olumi's — the one note, beside the result, and PROVISIONAL (LABEL, DON'T WITHHOLD, DL 12 Oct:
  // shown, never unlabelled).
  return { ...ZERO, provisional: true, unverified: 1 };
}

/** The joint's marginal notes one Olumi input must produce: one per target whose own upstream set it is on (DL ruling (B)). */
function expectedMarginals(input: Input, l: Rec): string[] {
  const g = allHuman();
  return (l.targets.per_target as Rec[]).flatMap((t) => {
    const node = (ROWS.find((r) => r.constraint_id === t.constraint_id) ?? { node_id: GOAL }).node_id;
    if (!upstreamOf(g, [node]).has(input.feeds)) return [];
    return [input.kind === 'setting'
      // Only that option has the setting: the counts differ, so that option is named.
      ? `On its own, the chance of ${t.words} rests on Olumi's estimates for ‘${LABEL[input.option!]}’: ${COUNT_WORDS.setting}.`
      : `On its own, the chance of ${t.words} rests on Olumi's estimates: ${COUNT_WORDS[input.kind]}.`];
  });
}

/** The position's APPLICABLE existing disposition (AIE R5 item 2), where it is stronger than a label. */
function refusedAt(input: Input, as: 'olumi' | 'unknown'): 'no_licence' | undefined {
  // Admission never admits Olumi's own estimate of the scored goal's level: no level chance on it. (Unverified is disclosed.)
  if (as === 'olumi' && input.kind === 'value' && input.feeds === GOAL) return 'no_licence';
  return undefined;
}

const INPUTS = inputsOf(allHuman());

describe('RE-SCOPE 2 — the census spec, generatively: every node / every option cell / every edge of the graph', () => {
  it('the generated graph has what the spec names: goal, second target, included limit, exogenous input, a setting on EVERY other node', () => {
    const g = allHuman();
    const set = new Set((g.nodes as Rec[]).flatMap((n) => Object.keys(n.kind === 'option' ? n.interventions ?? {} : {})));
    for (const n of (g.nodes as Rec[]).filter((x) => x.kind !== 'option' && x.kind !== 'decision')) expect(set.has(n.id), n.id).toBe(true);
    expect(set.has(GOAL)).toBe(true);
    // ‘Season’ is exogenous for ‘Hire a marketing manager’: it feeds a target and that option does not set it.
    expect((g.nodes as Rec[]).find((n) => n.id === 'hire_manager')!.interventions).not.toHaveProperty('season');
    expect(upstreamOf(g, eventOf('joint')).has('season')).toBe(true);
    // At least one input of every kind upstream of every event node, and inputs upstream of none (the contrast).
    for (const which of ['single', 'joint'] as const) {
      const up = upstreamOf(g, eventOf(which));
      for (const kind of ['value', 'setting', 'link'] as const) expect(INPUTS.some((x) => x.kind === kind && up.has(x.feeds)), `${which} ${kind}`).toBe(true);
      expect(INPUTS.some((x) => !up.has(x.feeds)), `${which} contrast`).toBe(true);
    }
    // Every starting value (9 nodes), every option cell (10) and every edge but an option's own link to what it sets (9).
    expect([INPUTS.filter((x) => x.kind === 'value').length, INPUTS.filter((x) => x.kind === 'setting').length,
      INPUTS.filter((x) => x.kind === 'link').length]).toEqual([9, 10, 9]);
  });

  it.each(['single', 'joint'] as const)('CONTROL (%s): the all-human graph is licensed, not provisional, and says no estimate', (which) => {
    const l = licenceOf(allHuman(), which);
    expect(Object.keys(l.pct_by_option)).toEqual(['hire_manager', 'ai_plus_ads']);
    if (which === 'joint') expect(l.targets.joint.status).toBe('licensed');
    expect(countsOf(l)).toEqual(ZERO);
  });

  const rows = INPUTS.flatMap((x) => (['single', 'joint'] as const).map((which) => [x.name, which] as const));

  it.each(rows)('OLUMI\'S: %s alone (%s) — provisional with exactly that count +1 where it feeds the event, else nothing', (name, which) => {
    const input = INPUTS.find((x) => x.name === name)!;
    const g = allHuman();
    input.toOlumi(g);
    const l = licenceOf(g, which);
    if (refusedAt(input, 'olumi') === 'no_licence') { expect(l).toBeNull(); return; }
    // The existing stronger rule (amendment 7, unchanged): a SECOND target read against Olumi's own starting value is never
    // quoted — the joint waits with its reason rather than being relabelled provisional.
    if (which === 'joint' && input.kind === 'value' && input.feeds === 'conversion_rate') {
      expect(l.targets.joint).toMatchObject({ status: 'withheld', reason: 'olumi_base' });
      return;
    }
    expect(Object.keys(l.pct_by_option)).toEqual(['hire_manager', 'ai_plus_ads']);
    expect(countsOf(l)).toEqual(expected(input, which, 'olumi'));
    // EVENT SCOPE: each marginal says what IT rests on — only the targets whose own upstream set holds this input.
    if (which === 'joint') expect(marginalNotes(l)).toEqual(expectedMarginals(input, l));
  });

  it.each(INPUTS.filter((x) => x.toUnknown !== undefined).flatMap((x) => (['single', 'joint'] as const).map((which) => [x.name, which] as const)))(
    'UNVERIFIED: %s alone (%s) — never "zero estimates" where it feeds the event: the note once, never counted, labelled provisional', (name, which) => {
      const input = INPUTS.find((x) => x.name === name)!;
      const g = allHuman();
      input.toUnknown!(g);
      const l = licenceOf(g, which);
      if (refusedAt(input, 'unknown') === 'no_licence') { expect(l).toBeNull(); return; }
      expect(Object.keys(l.pct_by_option)).toEqual(['hire_manager', 'ai_plus_ads']);
      expect(countsOf(l)).toEqual(expected(input, which, 'unknown'));
      if (which === 'joint') expect(marginalNotes(l)).toEqual([]);
    });

  it.each(['single', 'joint'] as const)('CONTRAST (%s): an option\'s own link to a node it sets is that setting — flipping the link alone adds nothing', (which) => {
    const g = allHuman();
    for (const e of g.edges as Rec[]) if (e.from === 'ai_plus_ads' || e.from === 'hire_manager') e.provenance = { ...OLUMIS_LINK_PROVENANCE };
    expect(countsOf(licenceOf(g, which))).toEqual(ZERO);
  });

  // POLARITY (R5-1, as amended; DL 12 Oct): a setting is the person's ONLY on positive attestation — `user_specified`, or
  // `brief_extraction` WITH `explicit` beside it — and nothing contradicting it (`estimate: true` is Olumi's draft-widening level). It is
  // Olumi's only on a RECOGNISED AI source (`cee_hypothesis`, `domain_knowledge`, `cee_inference`). Anything else — the legacy
  // `user` (derived 12 Oct: no production writer stamps it on an option cell), an unknown string — is UNVERIFIED.
  const upstreamSettings = INPUTS.filter((x) => x.kind === 'setting' && upstreamOf(allHuman(), eventOf('joint')).has(x.feeds));
  it.each(['domain_knowledge', 'cee_inference'].flatMap((source) => upstreamSettings.map((x) => [x.name, source] as const)))(
    'POLARITY: %s with source "%s" is Olumi\'s (joint) — counted on that option', (name, source) => {
      const input = INPUTS.find((x) => x.name === name)!;
      const g = allHuman();
      g.nodes.find((n: Rec) => n.id === input.option).interventions[input.feeds].source = source;
      expect(countsOf(licenceOf(g, 'joint'))).toEqual({ ...ZERO, provisional: true, settings: { [input.option!]: 1 } });
    });
  // ⛔ RULED (DL 12 Oct, last check BLOCKING 1): a type-less `brief_extraction` cell is the person's BY ITS STAMP ALONE
  // (`stampOnly`) — the drafter's single-entry option levels and the legacy prose extractor write it for figures nobody said.
  // The chance discloses it like any unverified input (labelled, never withheld; every gate still reads it as staging does).
  it.each([['user'], ['something_else'], ['user_specified + estimate: true'], ['brief_extraction (no attestation)']]
    .flatMap(([source]) => upstreamSettings.map((x) => [x.name, source!] as const)))(
    'POLARITY: %s with source "%s" is UNVERIFIED (joint) — the note once, never Olumi\'s, never the person\'s', (name, source) => {
      const input = INPUTS.find((x) => x.name === name)!;
      const g = allHuman();
      const cell = g.nodes.find((n: Rec) => n.id === input.option).interventions[input.feeds];
      if (source === 'user_specified + estimate: true') { cell.source = 'user_specified'; cell.estimate = true; }
      else if (source === 'brief_extraction (no attestation)') cell.source = 'brief_extraction';
      else cell.source = source;
      // LABEL, DON'T WITHHOLD (DL 12 Oct): shown, provisional, the note once.
      expect(countsOf(licenceOf(g, 'joint'))).toEqual({ ...ZERO, provisional: true, unverified: 1 });
    });
  it.each(['user_specified', 'brief_extraction + explicit'])('POLARITY CONTROL: a setting stamped "%s" is the person\'s — nothing is added', (source) => {
    const g = allHuman();
    for (const o of g.nodes.filter((n: Rec) => n.kind === 'option')) for (const c of Object.values(o.interventions as Rec)) {
      if (source === 'brief_extraction + explicit') Object.assign(c as Rec, { source: 'brief_extraction', extractionType: 'explicit' });
      else (c as Rec).source = source;
    }
    expect(countsOf(licenceOf(g, 'joint'))).toEqual(ZERO);
  });

  // The ONE named structural marker for a sourceless cell: the event-by-date switch (its node's `observed_state.extra_share_by_date`,
  // `event-by-date-model.ts`), whose 0 / 1 IS the switch. The same sourceless cell without that marker is never the person's.
  const withSwitch = (marked: boolean, figure: number): Rec => {
    const g = allHuman();
    g.nodes.push({ id: 'adds_capacity', kind: 'factor', label: 'AI planning plus advertising adds capacity',
      observed_state: { ...PERSONS_LEVEL(0, 1, 'switch'), ...(marked ? { extra_share_by_date: { monthly_share: 10, lead_low: 1, lead_high: 2, unit: '% per month' } } : {}) } });
    g.edges.push({ from: 'adds_capacity', to: GOAL, ...PERSONS_LINK() }, { from: 'ai_plus_ads', to: 'adds_capacity', ...PERSONS_LINK() });
    g.nodes.find((n: Rec) => n.id === 'ai_plus_ads').interventions.adds_capacity = { value: figure };
    return g;
  };
  it.each([[1], [0]])('STRUCTURAL: a sourceless event-by-date switch cell (%s) is the switch itself — excluded, nothing added', (figure) => {
    expect(countsOf(licenceOf(withSwitch(true, figure), 'single'))).toEqual(ZERO);
    expect(countsOf(licenceOf(withSwitch(true, figure), 'joint'))).toEqual(ZERO);
  });
  it('STRUCTURAL CONTRAST: a sourceless level of 0.6 on the switch, or a sourceless 1 on a node without the marker, is UNVERIFIED', () => {
    // LABEL, DON'T WITHHOLD (DL 12 Oct): shown, provisional, the note once.
    expect(countsOf(licenceOf(withSwitch(true, 0.6), 'single'))).toEqual({ ...ZERO, provisional: true, unverified: 1 });
    expect(countsOf(licenceOf(withSwitch(false, 1), 'single'))).toEqual({ ...ZERO, provisional: true, unverified: 1 });
  });

  // The same named marker on the switch node's OWN starting value: admission writes `{ value: 0, source: 'cee_inference',
  // extra_share_by_date }` — "not adding capacity today", the switch's definition. Only that 0 under that marker is structural.
  const withSwitchNode = (os: Rec): Rec => {
    const g = allHuman();
    g.nodes.push({ id: 'adds_capacity', kind: 'factor', label: 'AI planning plus advertising adds capacity', observed_state: os });
    g.edges.push({ from: 'adds_capacity', to: GOAL, ...PERSONS_LINK() }, { from: 'ai_plus_ads', to: 'adds_capacity', ...PERSONS_LINK() });
    g.nodes.find((n: Rec) => n.id === 'ai_plus_ads').interventions.adds_capacity = { value: 1 };
    return g;
  };
  const MARKER = { extra_share_by_date: { monthly_share: 10, lead_low: 1, lead_high: 2, unit: '% per month' } };
  it.each(['single', 'joint'] as const)('STRUCTURAL (%s): the switch node\'s own 0 as admission writes it is the switch — nothing added', (which) => {
    expect(countsOf(licenceOf(withSwitchNode({ value: 0, source: 'cee_inference', ...MARKER }), which))).toEqual(ZERO);
  });
  it('STRUCTURAL CONTRAST: the same Olumi 0 without the marker (or a non-zero level under it) is an Olumi starting value', () => {
    expect(countsOf(licenceOf(withSwitchNode({ value: 0, source: 'cee_inference' }), 'single'))).toEqual({ ...ZERO, provisional: true, values: 1, unverified: 1 });
    expect(countsOf(licenceOf(withSwitchNode({ value: 0.4, source: 'cee_inference', ...MARKER }), 'single'))).toEqual({ ...ZERO, provisional: true, values: 1 });
  });
  // A share-by-date team share: its value is computed from the person's own stated team time, held beside it (`stated_time`,
  // `team-share-write.ts`); the `cee_inference` stamp marks the computation. The person's — never counted as Olumi's.
  const withTeamShare = (os: Rec): Rec => {
    const g = allHuman();
    g.nodes.push({ id: 'team_share', kind: 'factor', label: 'Current team share', observed_state: os });
    g.edges.push({ from: 'team_share', to: GOAL, ...PERSONS_LINK() });
    return g;
  };
  const STATED_TIME = { quantity: 'months_to_finish', low: 6, high: 10, unit: 'months', deadline: '2027-04-07', reference_date: '2026-10-07' };
  it('a team share computed from the person\'s stated time is the person\'s; the same Olumi value without it is Olumi\'s', () => {
    expect(countsOf(licenceOf(withTeamShare({ value: 0.4, std: 0.1, source: 'cee_inference', stated_time: STATED_TIME }), 'single'))).toEqual(ZERO);
    expect(countsOf(licenceOf(withTeamShare({ value: 0.4, std: 0.1, source: 'cee_inference' }), 'single'))).toEqual({ ...ZERO, provisional: true, values: 1 });
  });

  it('the CHECKER\'S class, on the screen: Olumi\'s setting on the SCORED GOAL is said on that option\'s chance — single and joint', () => {
    for (const which of ['single', 'joint'] as const) {
      const g = allHuman();
      g.nodes.find((n: Rec) => n.id === 'ai_plus_ads').interventions[GOAL].source = 'cee_hypothesis';
      const env = withGoalChanceLicence(RUN(), g, GOAL, () => false, undefined, g, constraintsFor(g, which));
      const faces = goalChanceCellFacesForAgent({ type: 'analysis_result', enrichment: env }, g, true);
      expect(faces.get('ai_plus_ads'), which).toContain('using Olumi\'s estimates for 1 option setting (see Check estimates).');
      // Never said on the other option's chance.
      expect(faces.get('hire_manager'), which).not.toMatch(/Olumi's estimates/);
    }
  });

  it('UNVERIFIED on the screen: a starting value whose source is not recorded is said once beside the result — the face stays plain', () => {
    for (const which of ['single', 'joint'] as const) {
      const g = allHuman();
      const n = g.nodes.find((x: Rec) => x.id === 'outreach');
      n.observed_state = UNRECORDED_LEVEL(n.observed_state);
      const env = withGoalChanceLicence(RUN(), g, GOAL, () => false, undefined, g, constraintsFor(g, which));
      const result = { type: 'analysis_result', enrichment: env };
      const faces = goalChanceCellFacesForAgent(result, g, true);
      for (const option of ['hire_manager', 'ai_plus_ads']) expect(faces.get(option), `${which} ${option}`).not.toMatch(/estimates|not recorded/);
      expect(goalChanceNotesForAgent(result, g, true).filter((x) => x === UNVERIFIED_SOURCES_NOTE), which).toHaveLength(1);
    }
  });

  it('VIEW: a node of the QUOTED event the census view cannot read is never zero estimates — the joint says the note', () => {
    const g = allHuman();
    // The included limit is named by the joint (the raw graph holds it) but the analysed view leaves it out: its own inputs
    // cannot be read, so nothing about them may be said as "none".
    g.nodes.find((n: Rec) => n.id === 'annual_spend').analysis_participation = 'retained_excluded';
    const l = licenceOf(g, 'joint');
    expect(l.targets.joint.status).toBe('licensed');
    expect(countsOf(l).unverified).toBe(1);
    // CONTROL: the same graph read whole is the all-human control (no note).
    expect(countsOf(licenceOf(allHuman(), 'joint'))).toEqual(ZERO);
  });
});
