/**
 * ⭐ AN INFERRED PRODUCT THIS RUN EVALUATED IS EXACT, AND THE RUN SAYS IT (Science d5 #87 6009457214; DL #2644 conditions).
 *
 * Served D1 (Acceptance G1, a9ee494a, CEE c7878208): "I can't yet say how likely any option is to keep monthly recurring
 * revenue at or above £126,000 / month: I need a size for the links from Starter subscription price to Starter-tier MRR
 * and from Starter tier launched to Starter subscribers." With PR-1, the 150 link is the user's (with its range), and
 * ‘Starter-tier MRR’ is Olumi's product of price × subscribers. The target-testability withhold (DR row 4) read the
 * product's operand links as guesses, because it never saw the Run's `identity_evaluations` (the licence's (S) does).
 * Bound by node and edge identity, on the graph the real construction door registers.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { withholdGoalFiguresForUntestableTarget } from '../../tools/handlers/run-analysis.js';
import { buildGoalReadingDisclosure, goalReadingTailOf } from '../../coaching/goal-reading-disclosure.js';
import { isAllowedRunAnalysisAssistantText } from '../../coaching/analysis-result-headline.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../orchestrator/context/option-result-source.js';
import { withGoalChanceLicence } from '../../goal-target/goal-chance-licence.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

const WIN = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
const T1B = 'We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. '
  + 'Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. Goal: reach at least '
  + '£126,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month to monthly recurring '
  + 'revenue before churn. Each 1% price rise loses about 2 customers, between 1 and 4. Each lost customer removes £300 a '
  + `month of monthly recurring revenue. ${WIN} Each `
  + 'starter subscriber adds £49 a month to monthly recurring revenue. Each starter subscriber costs about £6 a month in '
  + 'support. Keeping pricing as it is adds nothing.';
const SAID = 'Olumi works out ‘Starter-tier MRR’ as ‘Starter subscription price’ × ‘Starter subscribers’. '
  + 'That’s Olumi’s reading of how they combine; tell me if it’s wrong.';

const sized = (from: string, to: string, direction: string, amount: number | null, per: number | null, provenance = 'explicit') =>
  ({ from, to, direction, provenance, effect_amount: amount, effect_per_source_change: per, effect_provenance: amount === null ? null : provenance });
const set = (factor_label: string, value: number, unit: string, provenance = 'explicit') => ({ factor_label, value, value_kind: 'absolute', unit, provenance });

/** Served D1's draft graph, as the drafter's candidate. */
const D1 = {
  goal: { metric: 'monthly recurring revenue', operator: '>=', target_stated: true, frame: 'level', value: 126000, unit: 'GBP per month', horizon_months: 9,
    provenance: 'explicit', baseline_known: true, baseline_value: 120000, baseline_provenance: 'explicit', scope: null },
  constraints: [],
  options: [
    { label: 'Raise prices 10%', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('Existing-price rise', 10, '%')] },
    { label: 'Launch starter tier', provenance: 'explicit', is_status_quo: null, changes: [],
      interventions: [set('Starter tier launched', 1, 'binary', 'ai_proposed'), set('Starter subscription price', 49, 'GBP per subscriber per month', 'ai_proposed')] },
    { label: 'Keep pricing as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
  ],
  factors: [
    { label: 'Existing-price rise', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    { label: 'Starter tier launched', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'binary', provenance: 'ai_proposed', plausible_max: 1 },
    { label: 'Starter subscription price', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP per subscriber per month', provenance: 'ai_proposed', plausible_max: 200 },
  ],
  risks: [{ label: 'MRR lost to price-rise churn', provenance: 'inferred', unit: 'GBP per month', plausible_max: 120000 }],
  outcomes: [
    { label: 'Customers lost from price rise', provenance: 'inferred', unit: 'customers', plausible_max: 400 },
    { label: 'Starter subscribers', provenance: 'inferred', unit: 'subscribers', plausible_max: 1000 },
    { label: 'Starter-tier MRR', provenance: 'inferred', unit: 'GBP per month', plausible_max: 100000 },
  ],
  links: [
    sized('Existing-price rise', 'monthly recurring revenue', 'positive', 1200, 1),
    sized('Existing-price rise', 'Customers lost from price rise', 'positive', 2, 1),
    sized('Customers lost from price rise', 'MRR lost to price-rise churn', 'positive', 300, 1),
    sized('MRR lost to price-rise churn', 'monthly recurring revenue', 'negative', null, null, 'inferred'),
    sized('Starter tier launched', 'Starter subscribers', 'positive', 150, 1),
    sized('Starter subscribers', 'Starter-tier MRR', 'positive', 49, 1),
    sized('Starter subscription price', 'Starter-tier MRR', 'positive', null, null, 'inferred'),
    { ...sized('Starter-tier MRR', 'monthly recurring revenue', 'positive', 1, 1, 'inferred'), definitional: true },
  ],
  identities: [], unknowns: [], decision_question: null,
};

type Rec = Record<string, any>;
async function d1(brief = T1B, candidate: Rec = D1): Promise<{ graph: Rec; id: (label: string) => string; named: (verdict: Rec) => string[] }> {
  let graph: Rec | null = null;
  const call = (async () => ({ text: JSON.stringify(candidate) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('a9ee494a-0000-4000-8000-000000a9ee49', brief, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const g = graph!;
  const label = (id: unknown): string => (g.nodes as Rec[]).find((n) => n.id === id)?.label;
  return {
    graph: g,
    id: (l) => (g.nodes as Rec[]).find((n) => n.label === l)!.id,
    // Every link P5 names, by its two labels.
    named: (verdict) => (verdict.failures ?? []).flatMap((f: Rec) => (f.links ?? []).map((l: Rec) => `${label(l.from)} → ${label(l.to)}`)),
  };
}

const evaluation = (id: (l: string) => string, over: Rec = {}) =>
  ({ node_id: id('Starter-tier MRR'), operation: 'product', factor_ids: [id('Starter subscription price'), id('Starter subscribers')],
    stated_in_brief: false, evaluated: true, level_source: 'identity_inputs', ...over });

/** A Run's envelope that still shows every option's goal chance, with THIS Run's evaluations. */
const envelope = (graph: Rec, evaluations?: Rec[]): Rec => ({
  option_comparison: (graph.nodes as Rec[]).filter((n) => n.kind === 'option').map((n, i) => ({ option_id: n.id, probability_of_goal: 0.3 + 0.2 * i })),
  ...(evaluations !== undefined ? { identity_evaluations: evaluations } : {}),
});
const targetWithheld = (r: Rec): boolean => (r.inference_warnings ?? []).some((w: Rec) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE);

describe('DL row 1 (D1): the ask never names a link that already carries the brief\'s figure', () => {
  it('RED: ‘Starter tier launched’ → ‘Starter subscribers’ is the user\'s 150 with its quote and range, and P5 never names it', async () => {
    const { graph, id, named } = await d1();
    const won = (graph.edges as Rec[]).find((e) => e.from === id('Starter tier launched') && e.to === id('Starter subscribers'))!;
    expect(won.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: WIN });
    expect(won.provenance.natural_effect.stated_range).toMatchObject({ low: 80, high: 250, end: 'centre' });
    for (const evaluations of [undefined, [evaluation(id)]]) {
      expect(named(targetTestabilityOf(graph, evaluations))).not.toContain('Starter tier launched → Starter subscribers');
    }
  });
});

describe('P5 reads an inferred product THIS Run evaluated as exact (Science d5 6009457214)', () => {
  it('RED: evaluated → no P5 failure, and the DR-row-4 withhold leaves every chance shown', async () => {
    const { graph, id } = await d1();
    expect(targetTestabilityOf(graph, [evaluation(id)]).kind).not.toBe('not_testable');
    const env = envelope(graph, [evaluation(id)]);
    expect(targetWithheld(withholdGoalFiguresForUntestableTarget(env, graph) as Rec)).toBe(false);
  });

  it('CONTROL (before a Run / no evaluations): P5 still names the price link — and only it', async () => {
    const { graph, named } = await d1();
    expect(named(targetTestabilityOf(graph))).toEqual(['Starter subscription price → Starter-tier MRR']);
    expect(targetWithheld(withholdGoalFiguresForUntestableTarget(envelope(graph), graph) as Rec)).toBe(true);
  });

  it('CONTROL (DL 2a): an inferred product this Run did NOT evaluate stays P5-withheld', async () => {
    const { graph, id } = await d1();
    expect(targetWithheld(withholdGoalFiguresForUntestableTarget(envelope(graph, [evaluation(id, { evaluated: false })]), graph) as Rec)).toBe(true);
  });

  it('CONTROL (DL 2b, stale): an evaluation of ANOTHER operand set (the graph changed since) attests nothing', async () => {
    const { graph, id } = await d1();
    const stale = evaluation(id, { factor_ids: [id('Starter subscription price'), id('Customers lost from price rise')] });
    expect(targetWithheld(withholdGoalFiguresForUntestableTarget(envelope(graph, [stale]), graph) as Rec)).toBe(true);
  });
});

describe('Codex r1: only the declared operands of an evaluated product are exact, and only a true evaluation counts', () => {
  it('CONTROL (F2): an Olumi-guessed link INTO the evaluated product from a non-operand stays P5-withheld', async () => {
    const { graph, id, named } = await d1();
    // An option-moved lever into the product, sized only by Olumi (not an operand of price × subscribers).
    graph.nodes.push({ id: 'promo_spend', kind: 'factor', label: 'Promo spend', observed_state: { value: 0, unit: '£/month' }, scale_frame: 1000 });
    graph.edges.push({ from: id('Launch starter tier'), to: 'promo_spend', effect_direction: 'positive', origin: 'option' });
    graph.edges.push({ from: 'promo_spend', to: id('Starter-tier MRR'), effect_direction: 'positive', strength: { mean: 0.3, std: 0.1 },
      exists_probability: 0.8, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } });
    expect(named(targetTestabilityOf(graph, [evaluation(id)]))).toContain('Promo spend → Starter-tier MRR');
  });

  it('CONTROL (F4): an evaluation of [price, price] is not price × subscribers — withheld, and no product sentence', async () => {
    const { graph, id } = await d1();
    const twice = evaluation(id, { factor_ids: [id('Starter subscription price'), id('Starter subscription price')] });
    expect(targetWithheld(withholdGoalFiguresForUntestableTarget(envelope(graph, [twice]), graph) as Rec)).toBe(true);
    expect(buildGoalReadingDisclosure(graph, id('monthly recurring revenue'), [twice])).not.toContain('Olumi works out');
  });
});

describe('DL condition 3: the Run says the product reading its chance rests on (d5\'s words)', () => {
  it('RED: evaluated → the reading tail says it, the forwarder rebuilds the same tail, and the egress admits it', async () => {
    const { graph, id } = await d1();
    const goal = id('monthly recurring revenue');
    const tail = buildGoalReadingDisclosure(graph, goal, [evaluation(id)]);
    expect(tail).toContain(SAID);
    expect(goalReadingTailOf({ __goal_reading_source: { graph, goal_node_id: goal, identity_evaluations: [evaluation(id)] } })).toBe(tail);
    expect(isAllowedRunAnalysisAssistantText(`Ran analysis on your current scenario.${tail}`, tail)).toBe(true);
  });

  it('CONTROL: not evaluated (the Run walked the links) → nothing is said about a product', async () => {
    const { graph, id } = await d1();
    expect(buildGoalReadingDisclosure(graph, id('monthly recurring revenue'))).not.toContain('Olumi works out');
    expect(buildGoalReadingDisclosure(graph, id('monthly recurring revenue'), [evaluation(id, { evaluated: false })])).not.toContain('Olumi works out');
  });
});

/** The Run's stored goal-chance licence, as the producer records it on the Run (turn and reload read this one record). */
const licenceOf = (graph: Rec, goal: string, evaluations?: Rec[]): Rec | undefined =>
  ((withGoalChanceLicence(envelope(graph, evaluations), graph, goal) as Rec).inference_warnings ?? [])
    .find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED');

describe('DL 13:55Z (old DGAI #2668): the licensed chance carries Olumi\'s reading of the goal it rests on, typed', () => {
  it('⭐ RED: evaluated product → the licence says the chance rests on Olumi\'s reading, by node, in the reply\'s own words', async () => {
    const { graph, id } = await d1();
    const goal = id('monthly recurring revenue');
    const licence = licenceOf(graph, goal, [evaluation(id)]);
    expect(Object.keys(licence?.pct_by_option ?? {}).length, JSON.stringify(licence)).toBeGreaterThan(0);
    expect(licence!.goal_reading).toEqual({ origin: 'olumi', readings: [{ kind: 'product', node_id: id('Starter-tier MRR'), words: SAID }] });
    // One predicate: the label's words are exactly the reply's tail, in order.
    expect(licence!.goal_reading.readings.map((r: Rec) => ` ${r.words}`).join('')).toBe(buildGoalReadingDisclosure(graph, goal, [evaluation(id)]));
  });

  it('CONTROL: not evaluated (the Run walked the links) → the same licence, no reading label', async () => {
    const { graph, id } = await d1();
    const licence = licenceOf(graph, id('monthly recurring revenue'));
    expect(Object.keys(licence?.pct_by_option ?? {}).length).toBeGreaterThan(0);
    expect(licence).not.toHaveProperty('goal_reading');
  });
});

/** The REAL Run handler on the constructed graph (snapshot loaded as served), PLoT faked with THIS Run's evaluations. */
/** D1 with no horizon (a goal for month 9 on a today-only model is withheld before any licence: the horizon gate). */
const T1B_NOW = T1B.replace(' within 9 months', '');
const D1_NOW = { ...D1, goal: { ...D1.goal, horizon_months: null } };

async function runFact(graph: Rec, evaluations: (sent: Rec) => Rec[]): Promise<Rec> {
  const stored = GraphV3.parse(structuredClone(graph)) as unknown as Rec;
  const snapshot = await loadScenarioSnapshotForRunAnalysis('a9ee494a-0000-4000-8000-000000a9ee49', 'req-load', {
    readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(stored), briefText: T1B_NOW }),
    loadGraph: async () => structuredClone(stored),
  } as never);
  const plotRun = vi.fn(async (sent: unknown) => {
    const payload = sent as Rec;
    return { ...structuredClone(minimalFixture), inference_warnings: [],
      results: payload.options.map((o: Rec, i: number) => ({ option_id: o.id ?? o.option_id, option_label: o.label, win_probability: [0.2, 0.5, 0.3][i] })),
      option_comparison: payload.options.map((o: Rec, i: number) => ({ option_id: o.id ?? o.option_id, option_label: o.label,
        win_probability: [0.2, 0.5, 0.3][i], probability_of_goal: [0.3, 0.6, 0.2][i],
        outcome: { p10: 118000, p50: 124000 + 2000 * i, p90: 132000, mean: 124000 + 2000 * i, std: 4000,
          n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1, percentiles_source: 'samples' } })),
      identity_evaluations: evaluations(payload),
    } as unknown as V2RunResponseEnvelope;
  });
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot });
  const outcome = await handler({ payload: { scenario_id: 'a9ee494a-0000-4000-8000-000000a9ee49', turn_id: 't-run' }, requestId: 'req-run',
    signal: new AbortController().signal, context: {}, orientationText: '' } as unknown as HandlerInvocation) as unknown as Rec;
  expect(plotRun).toHaveBeenCalledOnce();
  return (outcome.handler_facts as Rec[]).find((f) => f.fact_type === 'run_analysis')!;
}
const storedLicence = (fact: Rec): Rec | undefined =>
  (fact.result?.enrichment?.inference_warnings ?? []).find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED');

describe('DL 13:55Z, real Run: the Run\'s stored licence (turn and reload) carries the reading its chances rest on', () => {
  it('⭐ RED: real construction → real Run, the product evaluated → `goal_reading` on the stored licence, by node, in the reply\'s words', async () => {
    const { graph, id } = await d1(T1B_NOW, D1_NOW);
    const fact = await runFact(graph, () => [evaluation(id)]);
    const licence = storedLicence(fact);
    expect(Object.keys(licence?.pct_by_option ?? {}).length, JSON.stringify(fact.result?.enrichment?.inference_warnings)).toBeGreaterThan(0);
    expect(licence!.goal_reading).toEqual({ origin: 'olumi', readings: [{ kind: 'product', node_id: id('Starter-tier MRR'), words: SAID }] });
  });

  it('CONTROL (real Run): the Run walked the links (no evaluation) → licensed chances, no reading label', async () => {
    const { graph } = await d1(T1B_NOW, D1_NOW);
    const licence = storedLicence(await runFact(graph, () => []));
    expect(Object.keys(licence?.pct_by_option ?? {}).length).toBeGreaterThan(0);
    expect(licence).not.toHaveProperty('goal_reading');
  });
});
