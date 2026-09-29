/**
 * ⭐ A GOAL TO GET STRICTLY ABOVE A TARGET THE USER WROTE ("MRR above £85k") IS SCORED STRICTLY — AND ITS STATED
 * CURRENT LEVEL IS USED (R1 S4 (B); #72 5879133964 root cause, 5879602608 claim; ISL #209 carries the flag).
 *
 * Measured at CEE `ad627e9b`: Paul's exact pricing brief through the live drafter writes `operator: '>'` on 3/3 runs,
 * and admission withheld the stated £75k because ISL scored every goal `>=` — a status quo held exactly at the target
 * would have scored 100% on a goal it has not reached. ISL #209 adds `goal_threshold_strict`; this is CEE's hop: the
 * level is admitted beside a held `'>'` the run scores strictly, and the SAME request carries the flag.
 *
 * THE PATH (as `construction-held-ceiling-goal-minimise.test.ts`): the REAL `buildModelFromBrief` (drafter faked with
 * the live draft, verbatim) → the registered graph read back cold (`GraphV3`) → the REAL `run_analysis` handler, PLoT
 * faked; every assertion reads the registered goal or the payload PLoT receives.
 *
 * CORPUS: `fixtures/pricing-above-85k-live-draft-20260928.json` — run 0 of the live N=3, verbatim, with Paul's brief
 * verbatim. The `>=` control is the real Baseline v1 A-0 draft with its real brief. Rows marked AUTHORED edit one field
 * of the live draft, and say which.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { admitStatedGoalLevel } from '../admit-model.js';
import { heldStrictFloorIsScoredStrictly, resolveGoalThresholdStrict } from '../../goal-target/goal-direction.js';

type Rec = Record<string, unknown>;
type Node = Rec & { id: string; kind: string; label: string };
type Graph = Rec & { nodes: Node[]; edges: Rec[]; goal_constraints?: unknown[] };

const SCENARIO = '5e1f0c3a-7d1b-4c2e-9a41-2f9b1c7e0a12';
const LIVE = JSON.parse(readFileSync(new URL('./fixtures/pricing-above-85k-live-draft-20260928.json', import.meta.url), 'utf8')) as {
  brief: string; output_text: string;
};
const PRICING = LIVE.brief;
const liveDraft = (): Rec => JSON.parse(LIVE.output_text) as Rec;
/** AUTHORED: the live draft with its goal edited (say which field in the row). */
const withGoal = (goal: Rec): Rec => { const d = liveDraft(); return { ...d, goal: { ...(d.goal as Rec), ...goal } }; };
const BASELINE_V1 = JSON.parse(readFileSync(new URL('./fixtures/baseline-v1-medium-drafts-20260928.json', import.meta.url), 'utf8')) as {
  briefs: Record<string, string>; drafts: Record<string, { brief: string; output_text: string }>;
};

async function build(brief: string, candidate: Rec): Promise<{ result: Rec; graph: Graph; goal: Node }> {
  let stored: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)));
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate) });
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
  expect(stored, 'the build registered a graph').toBeDefined();
  const graph = GraphV3.parse(JSON.parse(stored!)) as unknown as Graph;
  const goals = graph.nodes.filter((n) => n.kind === 'goal');
  expect(goals).toHaveLength(1);
  return { result, graph, goal: goals[0]! };
}

/** The REAL `run_analysis` handler over the registered graph, PLoT faked: the request PLoT receives. */
async function plotRequestFor(graph: Graph): Promise<Rec & { graph: Graph }> {
  const run = vi.fn(async (_request: unknown) => ({
    meta: { seed_used: 1, n_samples: 1, response_hash: 'sha256:s' }, results: [], response_hash: 'sha256:t', analysis_status: 'completed',
  }) as unknown as V2RunResponseEnvelope);
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const snapshot = {
    graph, rawPersistedGraph: graph,
    goal_node_id: graph.nodes.find((n) => n.kind === 'goal')?.id ?? null,
    goal_constraints: graph.goal_constraints,
    options: graph.nodes.filter((n) => n.kind === 'option').map((n) => ({
      id: n.id, option_id: n.id, label: n.label, interventions: mergeInterventionSourceObjects(n as never),
    })),
  } as unknown as RunAnalysisScenarioSnapshot;
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: vi.fn(async () => snapshot) });
  await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run, 'PLoT was called exactly once').toHaveBeenCalledTimes(1);
  return run.mock.calls[0]![0] as Rec & { graph: Graph };
}

const said = (r: Rec): string => ((r.not_represented ?? []) as string[]).join(' · ');
const goalOnWire = (req: { graph: Graph }, id: string): Node => req.graph.nodes.find((n) => n.id === id)!;

describe("Paul's pricing brief: a goal to get ABOVE £85k, today £75k", () => {
  it('⭐ RED row 1: the goal holds ">" and carries the stated £75k (#1840 shape, the threshold\'s own cap); nothing says "not used"', async () => {
    const { result, goal } = await build(PRICING, liveDraft());
    expect(goal.label).toBe('MRR');
    expect(goal.goal_direction, 'construction held the comparator of the target the user wrote').toBe('>');
    expect(goal.goal_threshold_raw).toBe(85000);
    expect(goal.goal_threshold_cap).toBe(106250);
    expect(goal.observed_state).toStrictEqual({
      value: 75000 / 106250, baseline: 75000 / 106250, unit: 'GBP per month', source: 'brief_extraction', raw_value: 75000, cap: 106250,
    });
    expect(said(result)).not.toMatch(/strictly above 85000|was not used/);
  });

  it('⭐ RED row 2: the SAME request PLoT receives carries goal_threshold_strict: true beside the level, and no goal_direction (maximise)', async () => {
    const { graph, goal } = await build(PRICING, liveDraft());
    const req = await plotRequestFor(graph);
    expect(req.goal_threshold_strict).toBe(true);
    expect('goal_direction' in req).toBe(false);
    const onWire = goalOnWire(req, goal.id);
    expect(onWire.goal_threshold).toBe(0.8);
    expect((onWire.observed_state as Rec | undefined)?.raw_value, 'the level ISL reads travels in the same request').toBe(75000);
  });

  it('AUTHORED (level = the target, "£85k now"): admitted — strict scoring is what makes a level AT the target honest', async () => {
    const brief = PRICING.replace('£75k MRR', '£85k MRR');
    const { goal } = await build(brief, withGoal({ baseline_value: 85000 }));
    expect(goal.goal_direction).toBe('>');
    expect((goal.observed_state as Rec | undefined)?.raw_value).toBe(85000);
  });

  it('AUTHORED (level ABOVE the target, "£90k now"): withheld and said, exactly as the floor rule withholds it for ">="', async () => {
    const brief = PRICING.replace('£75k MRR', '£90k MRR');
    const { result, goal } = await build(brief, withGoal({ baseline_value: 90000 }));
    expect(goal.observed_state).toBeUndefined();
    expect(said(result)).toMatch(/already above the target/);
  });

  it('AUTHORED (the level is Olumi\'s estimate, baseline_provenance "inferred"): withheld, as any estimate is', async () => {
    const { result, goal } = await build(PRICING, withGoal({ baseline_provenance: 'inferred' }));
    expect(goal.observed_state).toBeUndefined();
    expect(said(result)).toMatch(/Olumi's own estimate/);
  });
});

describe('controls: every other goal is byte-identical', () => {
  it('CONTROL (real A-0, "reaching £100k", operator ">="): no strict key, the level exactly as before', async () => {
    const a0 = BASELINE_V1.drafts['A-0']!;
    const { graph, goal } = await build(BASELINE_V1.briefs[a0.brief]!, JSON.parse(a0.output_text) as Rec);
    expect(goal.goal_direction).toBe('>=');
    const req = await plotRequestFor(graph);
    expect('goal_threshold_strict' in req).toBe(false);
  });

  it('AUTHORED (target NOT in the brief, "above £95k" drafted beside "£85k" written): nothing held, the level withheld as before, no key', async () => {
    const { result, graph, goal } = await build(PRICING, withGoal({ value: 95000 }));
    expect(goal.goal_direction).toBeUndefined();
    expect(goal.observed_state).toBeUndefined();
    expect(said(result)).toMatch(/strictly above 95000/);
    const req = await plotRequestFor(graph);
    expect('goal_threshold_strict' in req).toBe(false);
  });
});

describe('ONE rule for admission and the wire (heldStrictFloorIsScoredStrictly)', () => {
  const args = { metric: 'MRR', operator: '>', rawTarget: 85000, rawBaseline: 75000, cap: 106250 } as const;

  it('a held ">" on a maximised goal admits the ">" level; no held comparator refuses it exactly as before', () => {
    expect(admitStatedGoalLevel({ ...args, heldComparator: '>' })).toStrictEqual({ admitted: true, normalised: 75000 / 106250 });
    const none = admitStatedGoalLevel(args);
    expect(none.admitted).toBe(false);
    expect(!none.admitted && none.reason).toMatch(/strictly above 85000/);
  });

  it('a held ">" beside a REDUCE label (the run minimises from the label) is not scored strictly: refused, and no key', () => {
    expect(heldStrictFloorIsScoredStrictly('>', 'Reduce monthly churn')).toBe(false);
    const v = admitStatedGoalLevel({ ...args, metric: 'Reduce monthly churn', heldComparator: '>' });
    expect(v.admitted).toBe(false);
    const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Reduce monthly churn', goal_direction: '>', goal_threshold: 0.8 }] };
    expect(resolveGoalThresholdStrict(graph, 'g')).toBe(false);
  });

  it('an "at least" reading beside a held ">" contradicts the user\'s comparator: refused, and said', () => {
    const v = admitStatedGoalLevel({ ...args, operator: '>=', heldComparator: '>' });
    expect(v.admitted).toBe(false);
    expect(!v.admitted && v.reason).toMatch(/held as a goal to get above 85000/);
  });

  it('">=", "<=", "<" held, or none: never strict; ">" with no threshold on the node: no key (ISL 422s strict without one)', () => {
    for (const held of ['>=', '<=', '<', undefined, null, 'above']) expect(heldStrictFloorIsScoredStrictly(held, 'MRR')).toBe(false);
    const node = { id: 'g', kind: 'goal', label: 'MRR', goal_direction: '>' };
    expect(resolveGoalThresholdStrict({ nodes: [node] }, 'g')).toBe(false);
    expect(resolveGoalThresholdStrict({ nodes: [{ ...node, goal_threshold: 0.8 }] }, 'g')).toBe(true);
    expect(resolveGoalThresholdStrict({ nodes: [{ ...node, goal_threshold: 0.8 }] }, 'other')).toBe(false);
  });
});
