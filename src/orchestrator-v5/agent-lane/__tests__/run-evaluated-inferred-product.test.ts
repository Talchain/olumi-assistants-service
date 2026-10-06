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
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { targetTestabilityOf, untestableTargetTail } from '../../admission/target-testability.js';
import { withholdGoalFiguresForUntestableTarget } from '../../tools/handlers/run-analysis.js';
import { buildGoalReadingDisclosure, goalReadingTailOf } from '../../coaching/goal-reading-disclosure.js';
import { isAllowedRunAnalysisAssistantText } from '../../coaching/analysis-result-headline.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../orchestrator/context/option-result-source.js';

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
async function d1(brief = T1B): Promise<{ graph: Rec; id: (label: string) => string; named: (verdict: Rec) => string[] }> {
  let graph: Rec | null = null;
  const call = (async () => ({ text: JSON.stringify(D1) })) as unknown as CallStructuredModel;
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

describe('a yes/no lever is asked as switched on (a8 + red team 19: "rises by 1 0 / 1", CEE b38592ed)', () => {
  // The served Run-2 graph (red team github-87 @0b005aee, evidence/cut5-pin/c5j4-r2-run, CEE b38592ed / UI 1815ccb4).
  const served = (): Rec => JSON.parse(readFileSync(new URL('./fixtures/served-c5j4-r2-b38592ed.json', import.meta.url), 'utf8')) as Rec;
  const ask = (g: Rec): string => untestableTargetTail(g, targetTestabilityOf(g))!;

  it('RED (served): "…when Starter tier launched is switched on?" — never "rises by 1 0 / 1"', () => {
    const tail = ask(served());
    expect(tail).toContain('Roughly how much does Starter subscribers change, in subscribers, when Starter tier launched is switched on?');
    expect(tail).not.toMatch(/0 ?\/ ?1|rises by 1\b/u);
  });

  it('CONTROL: the same lever measured in money keeps "rises by £1"', () => {
    const g = served();
    const lever = (g.nodes as Rec[]).find((n) => n.label === 'Starter tier launched')!;
    lever.observed_state = { ...lever.observed_state, unit: '£/month', value: 0.5, raw_value: 500, cap: 1000 };
    lever.scale_frame = 1000;
    expect(ask(g)).toMatch(/when Starter tier launched rises by £1\b/u);
  });
});
