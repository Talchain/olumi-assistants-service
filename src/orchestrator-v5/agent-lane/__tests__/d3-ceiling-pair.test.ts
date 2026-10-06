/**
 * D3 MILESTONE 1, STEP 1 — A GOAL CEILING IS SCORED AS ONE (Science #87 6005138341 + cap ruling + step-1 design check;
 * DL 0df0e1 sequencing): "at most 400" reaches ISL as ONE atomic pair — the threshold AND `minimise` — so ISL's existing
 * minimise branch computes each option's P(goal ≤ 400) instead of nothing.
 *
 * Measured (red team rt10b, guest 078e521e; real PLoT body 2473ace): after the goal card's "at most 400" the goal held
 * `goal_direction: '<='` and its own `<= 400` row, but NO threshold on the node, so the run sent `minimise` with nothing
 * to score and PLoT returned no `probability_of_goal` for any option.
 *
 * Science's rules (one pair writer; the threshold is the ceiling ROW's own value, read by identity; the cap is the goal's
 * own level frame — the today's-level card's cap — or 100 for %, never target headroom; X/cap ≥ 1 stays stamped and P2
 * withholds it; a ceiling with no frame stays unpaired). The pair is written by WHICHEVER writer completes it: the level
 * card when the ceiling came first (rt10b's real order), the target card when the level came first.
 *
 * THE PATH: the Agent's real `dispatchTool` → `propose_goal_current_level` → `authorise_change` → a store that enforces
 * the register route's contract and CAS; the target card through the REAL `applyGoalTargetEdit` → `add_constraint`;
 * then the REAL `run_analysis` handler with PLoT faked, returning the request PLoT receives. Rung: TESTED (in-process).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type AgentCapabilities, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { applyGoalTargetEdit } from '../../system-events/goal-target-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
type Graph = { nodes: Json[]; edges: Json[]; goal_constraints?: Json[] } & Json;
const RT10B = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as {
  graph_without_target: Graph; graph_with_target: Graph;
};
const GOAL = 'monthly_cancellations';
const UNIT = 'cancellations/month';
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400d3';
const SAID = 'We get about 520 cancellations a month right now.';
const LEVEL = { goal_label: 'monthly cancellations', value: 520, unit: UNIT, goal_is: 'at_most', user_stated: true };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const goalOf = (g: Graph): Json => g.nodes.find((n) => n.id === GOAL)!;
const ownRows = (g: Graph): Json[] => (g.goal_constraints ?? []).filter((r) => r.node_id === GOAL && r.deadline_metadata === undefined);

/** A scenario store that behaves like the read and register routes (contract gate + CAS), as goal-current-level-from-chat. */
function scenarioStore(initial: Graph) {
  let graph = clone(initial);
  let rev = 0;
  // The read route's `graph_hash` is the ANALYSIS hash (assist.v1.scenario-graph.ts), the space the card is bound to.
  const hash = () => computeAnalysisAffectingGraphHash(graph as never);
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      return { status: 200, json: { graph: clone(graph), graph_hash: hash(), graph_identity_hash: { value: `id-${hash()}` } } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const b = clone(body) as { graph: Graph; expected_graph_hash?: string };
      if (!GraphStateIngressSchema.safeParse(b.graph).success) return { status: 400, json: { details: { code: 'GRAPH_CONTRACT_INVALID' } } };
      if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== hash()) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = b.graph;
      rev += 1;
      return { status: 200, json: { graph_hash: hash(), model_version: { version_number: rev + 1, version_id: `v${rev}`, mutation_id: `m${rev}` } } };
    }
    return { status: 500, json: {} };
  };
  return { dispatch, graph: () => graph, set: (g: Graph) => { graph = clone(g); rev += 1; } };
}

/** Today's level through the Agent's real propose → approve path. Returns the stored graph after the write. */
async function levelCard(initial: Graph, said = SAID, args: Json = LEVEL): Promise<Graph> {
  const store = scenarioStore(initial);
  const caps: AgentCapabilities = createAgentCapabilities(store.dispatch, new ProposalStore());
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-d3-level', user_text: said };
  const call = (name: string, a: Json): Promise<ToolResult> => dispatchTool(name, JSON.stringify(a), ctx, caps);
  const proposed = await call('propose_goal_current_level', args) as ToolResult & { proposal_id?: string };
  expect(proposed.ok, JSON.stringify(proposed).slice(0, 600)).toBe(true);
  const applied = await call('authorise_change', { proposal_id: proposed.proposal_id }) as ToolResult;
  expect(applied.ok, JSON.stringify(applied).slice(0, 600)).toBe(true);
  return store.graph();
}

/** The goal card's "at most / at least X" through the REAL door. */
async function targetCard(graph: Graph, constraint_type: 'at_least' | 'at_most', raw_value: number, unit = UNIT): Promise<Graph> {
  const parsed = GraphV3.parse(clone(graph));
  const event = { kind: 'goal_target_edit', goal_node_id: GOAL, constraint_type, raw_value, unit, base_graph_hash: computeAnalysisAffectingGraphHash(parsed as never) };
  const r = await applyGoalTargetEdit({
    payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: 'turn-d3-card', stage: 'frame', event } as never,
    event: event as never, requestId: 'req-d3-card', persistedGraph: parsed, priorFacts: [],
  }) as { kind: string; mutatedGraph?: Graph };
  expect(r.kind, JSON.stringify(r).slice(0, 600)).toBe('mutated');
  return r.mutatedGraph!;
}

/** The REAL run_analysis handler over a stored graph, PLoT faked; returns the request PLoT received. */
async function plotRequestFor(graph: Graph): Promise<Json> {
  const run = vi.fn(async (_request: unknown) => ({
    meta: { seed_used: 1, n_samples: 1, response_hash: 'sha256:s' }, results: [], response_hash: 'sha256:t', analysis_status: 'completed',
  }) as unknown as V2RunResponseEnvelope);
  const snapshot = {
    graph, rawPersistedGraph: graph, goal_node_id: GOAL, goal_constraints: graph.goal_constraints,
    options: graph.nodes.filter((n) => n.kind === 'option').map((n) => ({ id: n.id, option_id: n.id, label: n.label, interventions: mergeInterventionSourceObjects(n as never) })),
  } as unknown as RunAnalysisScenarioSnapshot;
  const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient, scenarioReader: vi.fn(async () => snapshot) });
  await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO, request_id: 'req-d3-run',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-d3-run', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-d3-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  return run.mock.calls[0]![0] as Json;
}

/** The pair, read off a stored goal: what ISL is asked to score, in the Run's own units. */
const pairOf = (g: Graph) => {
  const goal = goalOf(g);
  return {
    raw: goal.goal_threshold_raw, cap: goal.goal_threshold_cap, threshold: goal.goal_threshold, direction: goal.goal_direction,
    success: goal.success_threshold, source: goal.threshold_source, levelCap: goal.observed_state?.cap, levelRaw: goal.observed_state?.raw_value,
  };
};

describe('D3 step 1 — a goal ceiling is scored as ONE pair (threshold + minimise)', () => {
  it('PRECONDITION (served rt10b): the ceiling row and the held "<=" are there, but no threshold, so the run sends minimise with nothing to score', async () => {
    const g = RT10B.graph_with_target;
    expect(ownRows(g)).toEqual([expect.objectContaining({ operator: '<=', value: 400 })]);
    expect(goalOf(g).goal_direction).toBe('<=');
    expect(goalOf(g).goal_threshold_raw).toBeUndefined();
    const req = await plotRequestFor(g);
    expect(req.goal_direction).toBe('minimise');
    expect(req.graph.nodes.find((n: Json) => n.id === GOAL).goal_threshold).toBeUndefined();
  });

  it('rt10b ORDER (ceiling, then today\'s level 520): the level write pairs the ceiling on the level\'s own cap; the run sends 400/cap with minimise', async () => {
    const g = await levelCard(RT10B.graph_with_target);
    const p = pairOf(g);
    expect(p.levelRaw).toBe(520);
    expect(p.cap).toBe(p.levelCap);
    expect(p.cap).toBe(650);
    expect(p.raw).toBe(400);
    expect(p.threshold).toBeCloseTo(400 / 650, 12);
    expect(p).toMatchObject({ direction: '<=', success: 400, source: 'user' });
    const req = await plotRequestFor(g);
    expect(req.goal_direction).toBe('minimise');
    const sent = req.graph.nodes.find((n: Json) => n.id === GOAL);
    expect(sent.goal_threshold).toBeCloseTo(400 / 650, 12);
    expect(sent.observed_state.value).toBeCloseTo(520 / 650, 12);
    expect(req.goal_threshold_strict).toBeUndefined(); // "at most": a draw AT 400 meets it (ISL's tolerance), no strict key
  });

  it('a STRICT ceiling ("below 400", held "<" as the brief path writes it) pairs as "<" and the run scores it strictly', async () => {
    const below = clone(RT10B.graph_with_target);
    goalOf(below).goal_direction = '<';
    ownRows(below)[0]!.operator_as_stated = '<';
    const g = await levelCard(below);
    expect(pairOf(g)).toMatchObject({ raw: 400, cap: 650, direction: '<', success: 400, source: 'user' });
    const req = await plotRequestFor(g);
    expect(req.goal_direction).toBe('minimise');
    expect(req.goal_threshold_strict).toBe(true);
    expect(req.graph.nodes.find((n: Json) => n.id === GOAL).goal_threshold).toBeCloseTo(400 / 650, 12);
  });

  it('LEVEL FIRST, then the card\'s "at most 400": the card write pairs it on the level\'s cap (never target headroom 500)', async () => {
    const withLevel = await levelCard(RT10B.graph_without_target);
    expect(goalOf(withLevel).observed_state.cap).toBe(650);
    const g = await targetCard(withLevel, 'at_most', 400);
    const p = pairOf(g);
    expect(p).toMatchObject({ raw: 400, cap: 650, direction: '<=', success: 400, source: 'user', levelRaw: 520, levelCap: 650 });
    expect(p.threshold).toBeCloseTo(400 / 650, 12);
    const req = await plotRequestFor(g);
    expect(req.goal_direction).toBe('minimise');
  });

  it('a COUNT ceiling with no level stays UNPAIRED: the row and the held "<=" only, no threshold (P1 withholds, as today)', async () => {
    const g = await targetCard(RT10B.graph_without_target, 'at_most', 400);
    expect(ownRows(g)).toEqual([expect.objectContaining({ operator: '<=', value: 400 })]);
    expect(goalOf(g).goal_direction).toBe('<=');
    expect(goalOf(g).goal_threshold_raw).toBeUndefined();
    expect(goalOf(g).goal_threshold).toBeUndefined();
  });

  it('a % ceiling with no level pairs on the unit\'s own 100 (metric scale), not on headroom', async () => {
    const pct = clone(RT10B.graph_without_target);
    Object.assign(goalOf(pct), { label: 'monthly churn', goal_threshold_unit: '%' });
    const g = await targetCard(pct, 'at_most', 4, '%');
    const goal = goalOf(g);
    expect(goal).toMatchObject({ goal_threshold_raw: 4, goal_threshold_cap: 100, goal_threshold_cap_provenance: 'metric_scale', goal_direction: '<=' });
    expect(goal.goal_threshold).toBeCloseTo(0.04, 12);
    const req = await plotRequestFor(g);
    expect(req.goal_direction).toBe('minimise');
    expect(req.graph.nodes.find((n: Json) => n.id === GOAL).goal_threshold).toBeCloseTo(0.04, 12);
  });

  it('NO ORPHAN: a count ceiling with no level replacing a held floor clears the floor\'s threshold, never minimises against it', async () => {
    const floored = await targetCard(RT10B.graph_without_target, 'at_least', 300);
    expect(goalOf(floored).goal_threshold_raw).toBe(300); // PRECONDITION: the floor stamped the channel
    const g = await targetCard(floored, 'at_most', 400);
    expect(goalOf(g).goal_direction).toBe('<=');
    for (const k of ['goal_threshold_raw', 'goal_threshold', 'goal_threshold_cap', 'success_threshold', 'threshold_source']) expect(goalOf(g)[k], k).toBeUndefined();
    const req = await plotRequestFor(g);
    expect(req.goal_direction).toBe('minimise');
    expect(req.graph.nodes.find((n: Json) => n.id === GOAL).goal_threshold).toBeUndefined();
  });

  it('a NEW level on a paired ceiling renormalises the pair onto the new level\'s own cap, in the same write', async () => {
    const paired = await levelCard(RT10B.graph_with_target);
    const g = await levelCard(paired, 'Correction: we get about 900 cancellations a month now.', { ...LEVEL, value: 900 });
    const p = pairOf(g);
    expect(p).toMatchObject({ raw: 400, levelRaw: 900, direction: '<=' });
    expect(p.cap).toBe(p.levelCap);
    expect(p.cap).toBe(1125);
    expect(p.threshold).toBeCloseTo(400 / 1125, 12);
  });

  it('a level card prepared on a FLOOR never lands after the goal flips to a ceiling at the same figure and cap (census BLIND row: the comparator is inside the hash the card is bound to)', async () => {
    const floored = await targetCard(RT10B.graph_without_target, 'at_least', 400);
    const withLevel = await levelCard(floored, 'We get about 350 cancellations a month right now.', { ...LEVEL, value: 350, goal_is: 'at_least' });
    const capBefore = goalOf(withLevel).goal_threshold_cap;
    const store = scenarioStore(withLevel);
    const caps: AgentCapabilities = createAgentCapabilities(store.dispatch, new ProposalStore());
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-d3-flip', user_text: 'Actually we get about 360 a month.' };
    const call = (name: string, a: Json): Promise<ToolResult> => dispatchTool(name, JSON.stringify(a), ctx, caps);
    const proposed = await call('propose_goal_current_level', { ...LEVEL, value: 360, goal_is: 'at_least' }) as ToolResult & { proposal_id?: string };
    expect(proposed.ok, JSON.stringify(proposed).slice(0, 600)).toBe(true);
    const flipped = await targetCard(store.graph(), 'at_most', 400);
    expect(pairOf(flipped)).toMatchObject({ raw: 400, cap: capBefore, direction: '<=' }); // PRECONDITION: same figure, same cap
    store.set(flipped);
    const applied = await call('authorise_change', { proposal_id: proposed.proposal_id }) as ToolResult & { refusal?: string };
    expect(applied).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(goalOf(store.graph()).observed_state.raw_value).toBe(350);
    // CONTROL: an intervening edit OUTSIDE the analysis hash (a label) does not supersede the same card.
    const relabelled = clone(withLevel);
    relabelled.nodes.find((n) => n.kind === 'option')!.label += ' (renamed)';
    const control = scenarioStore(withLevel);
    const cCaps: AgentCapabilities = createAgentCapabilities(control.dispatch, new ProposalStore());
    const cCall = (name: string, a: Json): Promise<ToolResult> => dispatchTool(name, JSON.stringify(a), ctx, cCaps);
    const cProposed = await cCall('propose_goal_current_level', { ...LEVEL, value: 360, goal_is: 'at_least' }) as ToolResult & { proposal_id?: string };
    control.set(relabelled);
    const cApplied = await cCall('authorise_change', { proposal_id: cProposed.proposal_id }) as ToolResult;
    expect(cApplied.ok, JSON.stringify(cApplied).slice(0, 600)).toBe(true);
    expect(goalOf(control.graph()).observed_state.raw_value).toBe(360);
  });

  it('CHANGING the ceiling re-pairs it on the same cap; replacing it with a floor leaves no ceiling threshold and no minimise', async () => {
    const paired = await levelCard(RT10B.graph_with_target);
    const moved = await targetCard(paired, 'at_most', 450);
    expect(pairOf(moved)).toMatchObject({ raw: 450, cap: 650, direction: '<=' });
    expect(pairOf(moved).threshold).toBeCloseTo(450 / 650, 12);
    const floored = await targetCard(paired, 'at_least', 300);
    expect(goalOf(floored).goal_direction).toBe('>=');
    expect(goalOf(floored).goal_threshold_raw).toBe(300);
    expect((await plotRequestFor(floored)).goal_direction).toBeUndefined();
  });
});
