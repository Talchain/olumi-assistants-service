import { legacyDoorGraph } from '../../../agent-lane/__tests__/licence-test-graphs.js';
/**
 * ⛔ (S) A GOAL CHANCE THAT MOVES WITH AN UNSIZED OLUMI LINK IS WITHHELD (DL #75 5902570568; AIQ 5902548598; R3 rows
 * 5902591666; AIQ ACK 5902606752).
 *
 * Served cut-costs on CEE `1f9d769` (DL alt-B r0, scenario 714abc5c): "Switch fully to GCP" reached the target in 6.17% of
 * runs (`probability_of_goal`, `analysis_summary.goal_fit`; the goal card read "Chance 8%" on a sibling run, R3
 * 5902550605) through `Monthly GCP cost saving → Monthly cloud spend` and `Migration downtime → Monthly cloud spend`,
 * both `olumi_placeholder`. The user's "GCP ~25% cheaper" could not move it (R3 5902454621). MG measured 15/15 served
 * cut-costs drafts with both movers on such a path (5902726040).
 *
 * THE PATH: the served graph through the REAL loader (`loadScenarioSnapshotForRunAnalysis`) and the REAL handler; the
 * PLoT client returns the served run body. Rung: TESTED (in-process), not a wire witness.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../../orchestrator/context/option-result-source.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { goalChanceWithheldForAgent, PLACEHOLDER_PATH_NOTE } from '../../../agent-lane/goal-chance-withheld.js';
import { placeholderGoalPaths, placeholderGoalWarning } from '../../../agent-lane/goal-certainty.js';
import { buildAnalysisResultBlock } from '../../../compose.js';
import { composeAnalysisStateV1, readRawRobustnessFromResponseBody } from '../../../compose/analysis-state-v1.js';
import { mayPresentLeaderClaimForFact } from '../../../compose/unrequested-analysis-confinement.js';
import { claimPermissionsFrom } from '../../../agent-lane/first-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Json = Record<string, any>;
const F = JSON.parse(readFileSync(new URL('./fixtures/served-cut-costs-altB-r0-1f9d769.json', import.meta.url), 'utf8')) as {
  _provenance: { brief_text: string }; graph: Json; plot_body: Json;
};
// Science 393023 LICENCE (a)/(b), 7 Oct: std 0.125 → 0.1 on a clone preserves this independent claim; captured bytes stay unchanged.
const SERVED_GRAPH = F.graph;
const WORKING = { ...F, graph: legacyDoorGraph(F.graph) };
const SCENARIO = '714abc5c-4e82-4436-9454-eec6c8f68589';
const SWITCH = 'switch_fully_to_gcp';
const PHASE = 'phase_50_to_gcp';
const REMAIN = 'remain_on_aws';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function runOn(graph: Json, body: Json = F.plot_body): Promise<Json> {
  const store = {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: F._provenance.brief_text })),
    loadGraph: vi.fn(async () => clone(graph)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-s-load', store as never);
  const run = vi.fn(async () => clone(body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot),
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-s-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({
      turn_id: 't-s', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse',
    } as never),
    requestId: 'req-s-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  lastFact = fact;
  return fact.result as Json;
}
let lastFact: unknown;

const CANONICAL_FRESH = {
  status: 'ready', freshness: 'fresh', freshness_reason: 'hash_match', selected_fact_index: 0, computed_at: '2026-09-30T01:48:05.000Z',
  graph_hash_at_run: 'h1', current_graph_hash: 'h1', blockers: [], model_adjustments: [], goal_node_id: 'monthly_cloud_spend', degraded_fact_status: null,
  contradictions: [], usableForProse: true, usableForChips: true, usableForFollowupContext: true, requiresRerun: false, blockedUnusable: false,
} as never;
/** The leader permission every consumer obeys (the cards, the egress guard, the Agent), composed as the read route composes it. */
function leaderClaimOf(fact: unknown): { claim: Json; mayBeNamed: boolean } {
  const block = buildAnalysisResultBlock(fact as never);
  const state = composeAnalysisStateV1({
    canonical: CANONICAL_FRESH,
    mayNameLeadingOption: mayPresentLeaderClaimForFact(fact as never),
    rawRobustness: readRawRobustnessFromResponseBody({ blocks: [block] }),
  } as never)!;
  const perms = claimPermissionsFrom(state, { analysis_admission: { permitted_analysis_mode: 'comparative_leader' } }, { requested: true });
  return { claim: (state as Json).leader_claim, mayBeNamed: perms.leader_may_be_named };
}

/** Every option-result entry for `id`, in every carrier the readers use. */
function entriesFor(env: Json, id: string): Json[] {
  const carriers = [env.option_comparison, env.results, env.results?.option_comparison, env.results?.options, env.decision_brief?.options];
  return carriers.flatMap((c) => (Array.isArray(c) ? c : [])).filter((e: Json) => e?.option_id === id || e?.id === id);
}

describe('PREMISE — the served run, read off the stored bytes', () => {
  it('Switch and Phase carry a goal chance and a win share, and the brief names Switch the leader at goal_fit 0.0617', () => {
    const oc = F.plot_body.option_comparison as Json[];
    expect(oc.find((o) => o.option_id === SWITCH)).toMatchObject({ probability_of_goal: 0.0617 });
    expect(oc.every((o) => typeof o.win_probability === 'number')).toBe(true);
    expect(F.plot_body.decision_brief.analysis_summary).toMatchObject({ goal_fit: 0.0617, leading_option: 'Switch fully to GCP' });
  });
  it('the movers reach spend through olumi_placeholder links; the status quo moves nothing', () => {
    const paths = placeholderGoalPaths(WORKING.graph, [REMAIN, SWITCH, PHASE]);
    expect(paths.map((p) => p.option_id).sort()).toEqual([PHASE, SWITCH]);
    expect(paths.find((p) => p.option_id === SWITCH)!.links).toEqual(expect.arrayContaining([
      { from: 'monthly_gcp_cost_saving', to: 'monthly_cloud_spend' }, { from: 'migration_downtime', to: 'monthly_cloud_spend' },
    ]));
  });
});

describe('(S) at the call site: the stored run withholds what the placeholder moves', () => {
  it('RED: Switch and Phase carry no goal chance, joint chance, goal estimate or downside in ANY carrier', async () => {
    const r = await runOn(WORKING.graph);
    const env = r.enrichment ?? r;
    for (const id of [SWITCH, PHASE]) {
      const entries = entriesFor(env, id);
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(e).not.toHaveProperty('probability_of_goal');
        expect(e).not.toHaveProperty('probability_of_joint_goal');
        expect(e).not.toHaveProperty('downside');
        for (const k of ['mean', 'p10', 'p50', 'p90', 'std']) expect(e.outcome ?? {}).not.toHaveProperty(k);
      }
    }
    expect(JSON.stringify(env)).not.toContain('0.0617');
  });

  it('RED: no win share on any option and no leader anywhere (a win share compares every option)', async () => {
    const r = await runOn(WORKING.graph);
    const env = r.enrichment ?? r;
    for (const id of [REMAIN, SWITCH, PHASE]) for (const e of entriesFor(env, id)) expect(e).not.toHaveProperty('win_probability');
    expect(env.decision_brief.analysis_summary).not.toHaveProperty('goal_fit');
    expect(env.decision_brief.analysis_summary).not.toHaveProperty('leading_option');
    expect(env.decision_brief).not.toHaveProperty('headline_banded');
    expect(env.decision_brief).not.toHaveProperty('headline');
    expect(env.robustness).toEqual({ fragile_edges: [], robust_edges: [] });
    for (const k of ['flip_thresholds', 'conditional_winners', 'p_win_sensitivity']) expect(env).not.toHaveProperty(k);
    expect(r).toHaveProperty('leading_option_id', null);
  });

  it('RED (AIQ 5902834053): the leader permission every consumer obeys is withheld, by name', async () => {
    await runOn(WORKING.graph);
    const { claim, mayBeNamed } = leaderClaimOf(lastFact);
    expect(claim.permitted).toBe(false);
    expect(typeof claim.withheld_reason).toBe('string');
    expect(claim.withheld_reason).not.toBe('');
    expect(mayBeNamed).toBe(false);
  });

  it('ASK CONTROL: with the downtime level gone too, nothing is asked; both links are still named', () => {
    const g = clone(WORKING.graph);
    delete (g.nodes as Json[]).find((n) => n.id === 'migration_downtime')!.observed_state;
    const w = placeholderGoalWarning(g, placeholderGoalPaths(g, [REMAIN, SWITCH, PHASE]), GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w.message).toBe('This comparison turns on the links from ‘Monthly GCP cost saving’ to ‘Monthly cloud spend’ and from ‘Migration downtime’ to ‘Monthly cloud spend’, whose strengths aren\'t sized in the model yet. Set them to see how much they matter.');
    expect(w.message).not.toContain('Give a figure');
  });

  it('CONTROL (AIQ 5903627210): without the user\'s downtime limit, the same levelled link IS asked for — the limit alone decides', () => {
    const g = clone(WORKING.graph);
    g.goal_constraints = [];
    const w = placeholderGoalWarning(g, placeholderGoalPaths(g, [REMAIN, SWITCH, PHASE]), GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w.message).toBe('This comparison turns on the links from ‘Monthly GCP cost saving’ to ‘Monthly cloud spend’ and from ‘Migration downtime’ to ‘Monthly cloud spend’, whose strengths aren\'t sized in the model yet. Set them to see how much they matter.');
    expect(w.message).not.toContain('only guessed');
  });

  it('names the link in the ask even when every unsized link is askable', () => {
    const graph = { nodes: [
      { id: 'switch', kind: 'option', label: 'Switch to GCP' },
      { id: 'saving', kind: 'factor', label: 'Expected saving', observed_state: { value: 1 } },
      { id: 'costs', kind: 'goal', label: 'Costs' },
    ], goal_constraints: [] };
    const w = placeholderGoalWarning(graph, [{ option_id: 'switch', links: [{ from: 'saving', to: 'costs' }] }], GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w.message).toBe('This comparison turns on the link from ‘Expected saving’ to ‘Costs’, whose strength isn\'t sized in the model yet. Set it to see how much it matters.');
    expect(w.message).not.toContain('Give a figure for that link');
    expect(w.message.length).toBeLessThanOrEqual(400);
  });

  it('keeps the named-link ask within the warning budget when labels are long', () => {
    const graph = { nodes: [
      { id: 'switch', kind: 'option', label: 'Switch to GCP' },
      { id: 'saving', kind: 'factor', label: `Expected saving ${'over many months '.repeat(9)}`, observed_state: { value: 1 } },
      { id: 'costs', kind: 'goal', label: `Costs ${'across several teams '.repeat(9)}` },
    ], goal_constraints: [] };
    const w = placeholderGoalWarning(graph, [{ option_id: 'switch', links: [{ from: 'saving', to: 'costs' }] }], GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w.message.length).toBeLessThanOrEqual(400);
    expect(w.message).toContain('This comparison turns on the link from ‘Expected saving');
    expect(w.message).toContain('to ‘Costs');
  });

  it('CONTROL (AIQ 5903874730 follow-up): a guessed link out of the limit-watched node into a NON-goal node is still asked for — only a link INTO the goal is the guess', () => {
    const g = clone(WORKING.graph);
    const nodes = g.nodes as Json[];
    const edges = g.edges as Json[];
    const out = edges.find((e) => e.from === 'migration_downtime' && e.to === 'monthly_cloud_spend')!;
    const downtime = nodes.find((n) => n.id === 'migration_downtime')!;
    nodes.push({ ...clone(downtime), id: 'downtime_cost', label: 'Downtime cost' });
    edges.splice(edges.indexOf(out), 1, { ...clone(out), to: 'downtime_cost' }, { ...clone(out), from: 'downtime_cost' });
    const w = placeholderGoalWarning(g, placeholderGoalPaths(g, [REMAIN, SWITCH, PHASE]), GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w.node_ids).toContain('downtime_cost');
    expect(w.message).toBe('This comparison turns on the links from ‘Monthly GCP cost saving’ to ‘Monthly cloud spend’, from ‘Downtime cost’ to ‘Monthly cloud spend’ and from ‘Migration downtime’ to ‘Downtime cost’, whose strengths aren\'t sized in the model yet. Set them to see how much they matter.');
    expect(w.message).toContain('Set them to see how much they matter.');
    expect(w.message).not.toContain('only guessed');
  });

  it('CONTROL (R3 row): the status quo moves nothing, so its earned 0 stays', async () => {
    const r = await runOn(WORKING.graph);
    const env = r.enrichment ?? r;
    expect((env.option_comparison as Json[]).find((o) => o.option_id === REMAIN)).toMatchObject({ probability_of_goal: 0 });
  });

  it('RED: ONE typed warning says which options, which links, and asks for the size; the Agent is told what to say', async () => {
    const r = await runOn(WORKING.graph);
    const env = r.enrichment ?? r;
    const w = (env.inference_warnings as Json[]).filter((x) => x.code === GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w).toHaveLength(1);
    expect(w[0]!.option_ids.sort()).toEqual([PHASE, SWITCH]);
    expect(w[0]!.message.startsWith('This comparison turns on the links from ')).toBe(true);
    expect(w[0]!.message.length).toBeLessThanOrEqual(400);
    expect(w[0]!.message).toBe('This comparison turns on the links from ‘Monthly GCP cost saving’ to ‘Monthly cloud spend’ and from ‘Migration downtime’ to ‘Monthly cloud spend’, whose strengths aren\'t sized in the model yet. Set them to see how much they matter.');
    // The saving holds no level, so its size alone would add to EVERY option ("Stay on AWS" too): named, not asked.
    // ⛔ AIQ 5903604206 / 5903627210 (supersedes this row's earlier "Give a figure for how 'Migration downtime' moves …"):
    // downtime is the node the user's "≤ 2 weeks" limit watches, and its link into spend is Olumi's guess. It is said as a
    // guess and NEVER asked for a size (the answer would make Olumi's invented cause the user's); no removal is offered.
    expect(w[0]!.message).not.toContain('Give a figure');
    expect(w[0]!.message).toContain('Set them to see how much they matter.');
    expect(w[0]!.message).not.toMatch(/take (the|it|that) link out|checked on its own|Olumi’s estimate:/);
    const chance = goalChanceWithheldForAgent({ enrichment: env });
    expect(chance).toMatchObject({ withheld: true, note: PLACEHOLDER_PATH_NOTE });
    expect(chance!.option_ids!.slice().sort()).toEqual([PHASE, SWITCH]);
    expect(chance!.say.startsWith('This comparison turns on the links from ')).toBe(true);
  });

  it('CONTROL: with those two links sized by Olumi, nothing is withheld and the served figures stand', async () => {
    const g = clone(WORKING.graph);
    for (const e of g.edges as Json[]) if (e.provenance?.magnitude === 'olumi_placeholder') e.provenance.magnitude = 'olumi_estimate';
    const r = await runOn(g);
    const env = r.enrichment ?? r;
    expect((env.option_comparison as Json[]).find((o) => o.option_id === SWITCH)).toMatchObject({ probability_of_goal: 0.0617 });
    expect((env.inference_warnings as Json[] | undefined ?? []).some((x) => x.code === GOAL_FIGURES_PLACEHOLDER_PATH)).toBe(false);
    expect(r).toHaveProperty('leading_option_id', SWITCH);
  });

  it('CONTROL: a strength the user stated is theirs, not a placeholder', async () => {
    const g = clone(WORKING.graph);
    for (const e of g.edges as Json[]) if (e.provenance?.magnitude === 'olumi_placeholder') e.provenance.source = 'user_specified';
    expect(placeholderGoalPaths(g, [REMAIN, SWITCH, PHASE])).toEqual([]);
  });

  it('CONTROL (#416 speaks first): a run PLoT already withheld gets no second warning', async () => {
    const body = clone(F.plot_body);
    body.inference_warnings = [...(body.inference_warnings ?? []), { code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', message: 'Not shown. x', severity: 'warning', node_ids: [] }];
    const r = await runOn(WORKING.graph, body);
    const env = r.enrichment ?? r;
    expect((env.inference_warnings as Json[]).some((x) => x.code === GOAL_FIGURES_PLACEHOLDER_PATH)).toBe(false);
  });
});

describe('the one exact link: an operand INTO an identity this run evaluated', () => {
  const g0 = (): Json => {
    const g = clone(WORKING.graph);
    const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
    goal.nonlinear_identity = { operation: 'sum', factor_ids: ['monthly_gcp_cost_saving', 'migration_downtime'], stated_in_brief: true };
    return g;
  };
  it('evaluated → exact: nothing withheld', () => {
    expect(placeholderGoalPaths(g0(), [SWITCH, PHASE], [{ node_id: 'monthly_cloud_spend', evaluated: true }])).toEqual([]);
  });
  it('CARD ROUTE (AIQ 5902606752): an INFERRED product on the goal this run did not evaluate → (S) stands down (#416 / C46 speak)', () => {
    const g = g0();
    (g.nodes as Json[]).find((n) => n.kind === 'goal')!.nonlinear_identity = { operation: 'product', factor_ids: ['monthly_gcp_cost_saving', 'migration_downtime'], stated_in_brief: false };
    expect(placeholderGoalPaths(g, [SWITCH, PHASE], [])).toEqual([]);
    // Once the user's Yes makes it theirs and the run evaluates it, operand links are exact and the rest is read as usual.
    (g.nodes as Json[]).find((n) => n.kind === 'goal')!.nonlinear_identity.stated_in_brief = true;
    expect(placeholderGoalPaths(g, [SWITCH, PHASE], []).map((p) => p.option_id).sort()).toEqual([PHASE, SWITCH]);
  });

  it('declared but NOT evaluated → still a placeholder: withheld', () => {
    expect(placeholderGoalPaths(g0(), [SWITCH, PHASE], [{ node_id: 'monthly_cloud_spend', evaluated: false }]).map((p) => p.option_id).sort()).toEqual([PHASE, SWITCH]);
  });
});

/**
 * ⭐ DL [R2] (5930827933): the row's ONE click, "Accept starting strength", is offered only for links whose size can make
 * the figure right — exactly the links the sentence asks about (`acceptable_links`). A guessed mechanism (a link out of a
 * limit-watched node into the goal) or a link from a node with no level is never offered.
 */
describe('[R2] acceptable_links: the offer gate is the ask', () => {
  it('RED: without the downtime limit the levelled downtime → spend link is asked for AND offered', () => {
    const g = clone(WORKING.graph);
    g.goal_constraints = [];
    const w = placeholderGoalWarning(g, placeholderGoalPaths(g, [REMAIN, SWITCH, PHASE]), GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w.acceptable_links).toContainEqual({ from: 'migration_downtime', to: 'monthly_cloud_spend' });
  });

  it('CONTROL: the limit-watched guess is named but never offered', () => {
    const g = clone(WORKING.graph);
    const w = placeholderGoalWarning(g, placeholderGoalPaths(g, [REMAIN, SWITCH, PHASE]), GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w.acceptable_links ?? []).not.toContainEqual({ from: 'migration_downtime', to: 'monthly_cloud_spend' });
  });

  it('CONTROL: no source level → nothing asked, nothing offered', () => {
    const g = clone(WORKING.graph);
    delete (g.nodes as Json[]).find((n) => n.id === 'migration_downtime')!.observed_state;
    const w = placeholderGoalWarning(g, placeholderGoalPaths(g, [REMAIN, SWITCH, PHASE]), GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(w).not.toHaveProperty('acceptable_links');
  });
});

it('Science 393023: as-served cost graph two → three unsized links, including workload → saving', async () => {
  const r = await runOn(structuredClone(SERVED_GRAPH));
  expect(r.leading_option_id).toBeNull();
  const w = r.enrichment.inference_warnings.find((w: Json) => w.code === GOAL_FIGURES_PLACEHOLDER_PATH);
  expect(w.links).toEqual([
    { from: 'monthly_gcp_cost_saving', to: 'monthly_cloud_spend' },
    { from: 'migration_downtime', to: 'monthly_cloud_spend' },
    { from: 'gcp_workload_share', to: 'monthly_gcp_cost_saving' },
  ]);
});
