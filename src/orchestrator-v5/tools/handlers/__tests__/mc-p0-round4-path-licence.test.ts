import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as target from '../../../admission/target-testability.js';
import * as certainty from '../../../agent-lane/goal-certainty.js';
import { bindStatedLinkSizes } from '../../../agent-lane/admit-model.js';
import { withholdOptionGoalFigures } from '../../../../orchestrator/context/constraint-feasibility.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../../orchestrator/context/option-result-source.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';

type R = Record<string, any>;
const brief = readFileSync(new URL('../../../admission/__tests__/fixtures/mc-p0/BRIEF.txt', import.meta.url), 'utf8');
const licence = (g: R, ids: string[]) => (certainty as any).unsizedLeaderGoalPaths?.(g, ids) ?? [];
function graph(draw: number, noTarget = false): R {
  const g = JSON.parse(readFileSync(new URL(`../../../admission/__tests__/fixtures/mc-p0/draw${draw}.json`, import.meta.url), 'utf8'));
  const nodes = g.nodes.map((n: R) => ({ ...n, unit: n.observed_state?.unit ?? (n.kind === 'goal' ? n.goal_threshold_unit : undefined) ?? n.unit }));
  for (const [i, sentence] of bindStatedLinkSizes(g.edges.map((e: R) => ({ ...e, natural_effect: e.provenance?.natural_effect })), nodes, brief)) {
    if (g.edges[i].provenance?.magnitude === 'olumi_estimate') Object.assign(g.edges[i].provenance, { magnitude: 'user_stated', source_quote: sentence });
  }
  if (noTarget) {
    for (const n of g.nodes.filter((n: R) => n.kind === 'goal')) {
      for (const k of Object.keys(n)) if (k.startsWith('goal_threshold') || ['success_threshold', 'threshold_source', 'goal_comparator'].includes(k)) delete n[k];
    }
    g.goal_constraints = (g.goal_constraints ?? []).filter((c: R) => !g.nodes.some((n: R) => n.kind === 'goal' && n.id === c.node_id));
  }
  return g;
}
const idsOf = (g: R): string[] => g.nodes.filter((n: R) => n.kind === 'option').map((n: R) => n.id);
function carrier(g: R): R {
  const ids = idsOf(g);
  const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8'));
  happy.option_comparison = ids.map((id, i) => ({ option_id: id, option_label: g.nodes.find((n: R) => n.id === id).label, win_probability: i === 0 ? 0.8 : 0.1, probability_of_goal: 0.6, status: 'computed', outcome: { mean: 0.8 - i * 0.2, std: 0.05, p10: 0.5, p50: 0.6, p90: 0.9, n_samples: 10000, n_valid_samples: 10000, validity_ratio: 1, percentiles_source: 'samples' } }));
  happy.results = structuredClone(happy.option_comparison);
  happy.option_comparison_status = 'computed';
  happy.identity_evaluations = []; happy.inference_warnings = []; happy.fact_objects = []; happy.review_cards = [];
  happy.decision_brief = { options: structuredClone(happy.option_comparison), analysis_summary: { leading_option: ids[0], win_probability: 0.8 } };
  return happy;
}
async function run(g: R): Promise<R> {
  const scenario = '714abc5c-4e82-4436-9454-eec6c8f68589';
  const store = { readMostRecentPendingActions: async () => [], loadGraphAndBriefText: vi.fn(async () => ({ graph: structuredClone(g), briefText: brief })), loadGraph: vi.fn(async () => structuredClone(g)) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(scenario, 'r4-load', store as never);
  const plotRun = vi.fn(async () => carrier(g));
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as never, scenarioReader: vi.fn(async () => snapshot) });
  const outcome = await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: scenario, request_id: 'r4', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null }, payload: makeMessagePayload({ turn_id: 'r4', scenario_id: scenario, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never), requestId: 'r4', signal: new AbortController().signal, orientationText: '' } as never);
  expect(plotRun).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis')!;
  expect(fact).toBeDefined();
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  return fact.result as R;
}

describe('MC P0 R4: target-independent licence on stored T1b paths', () => {
  const measurements: R[] = [];
  it('capture all six handler responses for verbatim string comparison', async () => {
    const rows = [];
    for (const d of [1, 2, 3]) for (const noTarget of [false, true]) {
      const g = graph(d, noTarget); rows.push({ draw: d, tag: noTarget ? 'no-target' : 'target', result: await run(g) });
    }
  });
  it.each([1, 2, 3])('d%i stored rows and no-target twins give identical actual handler leader decisions', async d => {
    const before = graph(d); const noTarget = graph(d, true);
    expect(target.targetTestabilityOf(noTarget).kind).toBe('no_target');
    const outputs = [];
    for (const [tag, g] of [['target', before], ['no-target', noTarget]] as const) {
      const paths = licence(g, idsOf(g));
      const r = await run(g);
      const warnings = r.enrichment?.inference_warnings ?? [];
      const warning = warnings.find((w: R) => w.code === GOAL_FIGURES_PLACEHOLDER_PATH);
      // Science 393023 LICENCE (a)/(b), 7 Oct: d1/d3 untagged door constants are unsized paths; d2 stays sized.
      const expectedLinks = d === 1 ? [{ from: 'starter_support_cost', to: 'mrr_lost_to_starter_support_burden' }]
        : [{ from: 'starter_monthly_price', to: 'starter_tier_monthly_recurring_revenue' },
          { from: 'starter_subscribers', to: 'starter_tier_monthly_recurring_revenue' }];
      expect(paths).toEqual(d === 2 ? [] : [{ option_id: 'launch_starter_tier', links: expectedLinks }]);
      // Science 393023 LICENCE (a)/(b), 7 Oct: an unsized compared path withholds the leader, independent of target.
      expect(r.leading_option_id).toBe(d === 2 ? idsOf(g)[0] : null);
      // Science 393023 LICENCE (a)/(b), 7 Oct: d1/d3 now record the exact placeholder links.
      if (d === 2) expect(warning).toBeUndefined();
      else expect(warning.links).toEqual(expectedLinks);
      const legacy = warnings.find((w: R) => w.code === 'GOAL_FIGURES_OLUMI_SUPPLIED_LINK');
      // Science 393023 LICENCE (a)/(b), 7 Oct: door constants no longer produce legacy disclosure.
      expect(legacy).toBeUndefined();
      if (d !== 2) {
        // Science 393023 LICENCE (a)/(b), 7 Oct: preserve the endpoint-name check on the new warning.
        if (d === 1) expect(warning.message).toContain('Starter support cost');
        // Science 393023 LICENCE (a)/(b), 7 Oct: without a leader, the existing generic summary replaces legacy prose.
        expect(r.summary.startsWith('Ran analysis on your current scenario.')).toBe(true);
      }
      measurements.push({ draw: d, tag, leading_option_id: r.leading_option_id, paths, warnings, result: r }); outputs.push(r.leading_option_id);
    }
    expect(outputs[0]).toBe(outputs[1]);
  });
  it('d2 before Fi retains the leader on its actual olumi_estimate + natural_effect path (over-withholding mutant)', async () => {
    const g = JSON.parse(readFileSync(new URL('../../../admission/__tests__/fixtures/mc-p0/draw2.json', import.meta.url), 'utf8'));
    const edge = g.edges.find((e: R) => e.from === 'price_increase' && e.to === 'monthly_recurring_revenue');
    expect(edge.provenance.magnitude).toBe('olumi_estimate'); expect(edge.provenance.natural_effect).toBeDefined();
    expect(licence(g, idsOf(g))).toEqual([]); expect((await run(g)).leading_option_id).toBe(idsOf(g)[0]);
  });
  it('approval/coaching and licence walks agree on stored d1/d2/d3', () => {
    for (const d of [1, 2, 3]) {
      const g = graph(d);
      // Science 393023 LICENCE (a)/(b), 7 Oct: d1/d3 empty → the same door links as the handler row; d2 remains empty.
      const links = d === 1 ? [{ from: 'starter_support_cost', to: 'mrr_lost_to_starter_support_burden' }]
        : [{ from: 'starter_monthly_price', to: 'starter_tier_monthly_recurring_revenue' }, { from: 'starter_subscribers', to: 'starter_tier_monthly_recurring_revenue' }];
      const expected = d === 2 ? [] : [{ option_id: 'launch_starter_tier', links }];
      expect(certainty.placeholderGoalPaths(g, idsOf(g)).map(p => ({ ...p, links: [...p.links].sort((a, b) => a.from.localeCompare(b.from)) }))).toEqual(expected);
      expect(licence(g, idsOf(g))).toEqual(expected);
    }
  });
  it('P5 and the licence import the SAME exported walk and both call it (no copied walker)', () => {
    const p5 = target as any, leader = certainty as any;
    expect(typeof p5.reachedGoalPaths).toBe('function'); expect(leader.reachedGoalPaths).toBe(p5.reachedGoalPaths);
    const source = readFileSync(new URL('../../../admission/target-testability.ts', import.meta.url), 'utf8');
    expect(source.slice(source.indexOf('export function targetTestabilityOf'))).toMatch(/reachedGoalPaths\(graph/);
    const ls = readFileSync(new URL('../../../agent-lane/goal-certainty.ts', import.meta.url), 'utf8');
    expect(ls.slice(ls.indexOf('export function unsizedLeaderGoalPaths'), ls.indexOf('export function placeholderGoalPaths'))).toMatch(/reachedGoalPaths\(graph, optionIds/);
  });
});

describe('R4 predicate controls: only a link nobody sized withholds', () => {
  const base = () => ({ nodes: [{ id: 'a', kind: 'option', interventions: { x: 1 } }, { id: 'b', kind: 'option', interventions: { x: 2 } }, { id: 'x', kind: 'factor' }, { id: 'g', kind: 'goal' }], edges: [{ from: 'a', to: 'x' }, { from: 'b', to: 'x' }, { from: 'x', to: 'g', defaulted: true, provenance: { mean_projected: true } }] });
  it.each([
    ['legacy defaulted', {}, false], ['projected mean', { mean_projected: true }, true], ['placeholder', { magnitude: 'olumi_placeholder' }, true],
    ['definitional', { definitional: true }, false], ['example', { magnitude: 'example_figure' }, false],
    ['estimate with effect', { magnitude: 'olumi_estimate', natural_effect: { amount: 1 } }, false],
    ['user', { source: 'user_specified', magnitude: 'olumi_placeholder' }, false],
  ] as const)('%s', (_label, provenance, withheld) => {
    const g: R = base(); g.edges[2].provenance = provenance;
    expect(licence(g, ['a', 'b']).length > 0).toBe(withheld);
  });
  it('confirmed identity operands are exact, other inbound links are not', () => {
    const g: R = base(); g.nodes[3].nonlinear_identity = { operation: 'product', stated_in_brief: true, factor_ids: ['x', 'y'] };
    expect(licence(g, ['a', 'b'])).toEqual([]);
    g.nodes[3].nonlinear_identity.factor_ids = ['y', 'z']; expect(licence(g, ['a', 'b']).length).toBe(2);
  });
  it('an inferred operand THIS Run evaluated is exact; an unevaluated operand stays unsized', () => {
    const g: R = base(); g.nodes[3].nonlinear_identity = { operation: 'product', stated_in_brief: false, factor_ids: ['x', 'y'] };
    expect(licence(g, ['a', 'b']).length).toBe(2);
    expect((certainty as any).unsizedLeaderGoalPaths(g, ['a', 'b'], [{ node_id: 'g', evaluated: true }])).toEqual([]);
  });
  it('dead branches, option set edges and paths through option/decision nodes cannot withhold', () => {
    const g: R = base(); g.edges[2].provenance = { magnitude: 'example_figure' };
    g.nodes.push({ id: 'dead', kind: 'factor' }, { id: 'dec', kind: 'decision' });
    g.edges.push({ from: 'x', to: 'dead', defaulted: true }, { from: 'x', to: 'b', defaulted: true }, { from: 'b', to: 'g', defaulted: true }, { from: 'x', to: 'dec', defaulted: true }, { from: 'dec', to: 'g', defaulted: true });
    expect(licence(g, ['a'])).toEqual([]);
  });
  it('RT-12 in-tree example-sized path retains a result', () => {
    // The same a/b -> subscribers -> revenue -> goal path pinned in conditional-input-basis.test.ts, RT-12.
    const g: R = { nodes: ['a', 'b'].map<R>(id => ({ id, kind: 'option', interventions: { subscribers: id === 'a' ? 1 : 2 } })).concat(['subscribers', 'revenue', 'goal'].map(id => ({ id, kind: id === 'goal' ? 'goal' : 'factor' }))), edges: [{ from: 'a', to: 'subscribers' }, { from: 'b', to: 'subscribers' }, { from: 'subscribers', to: 'revenue', defaulted: true, provenance: { magnitude: 'example_figure' } }, { from: 'revenue', to: 'goal', defaulted: true, provenance: { magnitude: 'example_figure' } }] };
    expect(licence(g, ['a', 'b'])).toEqual([]);
    const result = { option_comparison: [{ option_id: 'a', win_probability: 0.8 }, { option_id: 'b', win_probability: 0.2 }], decision_brief: { analysis_summary: { leading_option: 'a' } } };
    expect(withholdOptionGoalFigures(result, new Set(), certainty.placeholderGoalWarning(g, [], GOAL_FIGURES_PLACEHOLDER_PATH))).toEqual(result);
  });
});
