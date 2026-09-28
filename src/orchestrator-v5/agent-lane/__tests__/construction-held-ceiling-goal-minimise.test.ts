/**
 * ⭐ A GOAL TO REDUCE, WHOSE CEILING THE USER WROTE, IS RANKED AS ONE — AND ITS STATED CURRENT LEVEL IS USED
 * (MG #72 5870097103; AIQ defect 1 on Baseline v1's cloud brief).
 *
 * Measured at CEE staging `0a1153f3`, 0 LLM: `run-analysis.ts` sent `goal_direction` ONLY from the goal LABEL, and the
 * label classifier reads nothing for "Monthly spend" / "Monthly cloud spend" — so ISL ran its unattested maximiser
 * and, for a cost goal, crowned the MOST expensive option. The user's own comparator was on the goal node all along
 * (`holdStatedGoalAttributes` holds `goal_direction: '<='` beside a target the user wrote) and nothing read it. And
 * admission refused every `<=` goal's stated current level ("cannot be calculated correctly yet") — stale once
 * `minimise` is sent, because ISL scores a minimise LEVEL frame as `baseline + effect <= threshold`.
 *
 * THE PATH: the REAL `buildModelFromBrief` (drafter faked with the model's OWN Baseline v1 JSON, `callStructured`
 * injected, `/graph/register` recorded) → the registered graph read back cold (`GraphV3`) → the REAL `run_analysis`
 * handler, PLoT faked; every assertion reads the payload PLoT receives or the registered goal, by id.
 *
 * CORPUS (served shape, not self-authored): `fixtures/baseline-v1-medium-drafts-20260928.json` — real gpt-5.6-terra
 * drafts, verbatim, with the Baseline v1 briefs verbatim. ⚠ AUTHORED, and said so: no Baseline v1 brief WRITES a
 * ceiling figure ("cut costs by 20%"), so every held-`<=` row pairs the real cloud-2 draft (`Monthly spend <= 36
 * £k/month`, today 45, both `explicit`) with a brief VARIANT that writes "at most £36k a month". The level / operator
 * variants (rows 3, 6) and the renamed labels (rows 7, 8) are authored edits of a real draft. The real drafts with
 * their real briefs are the no-change controls (rows 4, 5).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { log } from '../../../utils/telemetry.js';
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

type Rec = Record<string, unknown>;
type Node = Rec & { id: string; kind: string; label: string };
type Graph = Rec & { nodes: Node[]; edges: Rec[]; goal_constraints?: unknown[] };

const SCENARIO = '5e1f0c3a-7d1b-4c2e-9a41-2f9b1c7e0a11';
const CORPUS = JSON.parse(readFileSync(new URL('./fixtures/baseline-v1-medium-drafts-20260928.json', import.meta.url), 'utf8')) as {
  briefs: Record<string, string>;
  drafts: Record<string, { brief: string; output_text: string }>;
};
const draft = (id: string): Rec => JSON.parse(CORPUS.drafts[id]!.output_text) as Rec;
const briefOf = (id: string): string => CORPUS.briefs[CORPUS.drafts[id]!.brief]!;
/** A real draft with its goal edited (authored rows only; say which in the row). */
const withGoal = (id: string, goal: Rec): Rec => { const d = draft(id); return { ...d, goal: { ...(d.goal as Rec), ...goal } }; };

const CLOUD = CORPUS.briefs.cloud!;
/** ⚠ AUTHORED brief variant: the Baseline v1 cloud brief, with the ceiling WRITTEN ("at most £36k a month"). */
const CLOUD_CEILING = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut it to at most '
  + '£36k a month without more than 2 weeks of migration downtime risk.';

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

/** The `cee.goal_direction.derived` records `run_analysis` logged. */
const directionLogs = (): Rec[] => vi.mocked(log.info).mock.calls
  .map((c) => c[0] as unknown as Rec)
  .filter((r) => r !== null && typeof r === 'object' && r.event === 'cee.goal_direction.derived');

const said = (r: Rec): string => ((r.not_represented ?? []) as string[]).join(' · ');
const goalOnWire = (req: { graph: Graph }, id: string): Node => req.graph.nodes.find((n) => n.id === id)!;

beforeEach(() => { vi.mocked(log.info).mockClear(); });

describe('a ceiling the user WROTE: the run minimises, and the stated current level is used', () => {
  it('⭐ RED row 1: held `<=` → the payload PLoT receives carries goal_direction "minimise", logged as stated_comparator', async () => {
    const { graph, goal } = await build(CLOUD_CEILING, draft('cloud-2'));
    expect(goal.label).toBe('Monthly spend');
    expect(goal.goal_direction, 'construction held the comparator the user wrote').toBe('<=');
    const req = await plotRequestFor(graph);
    expect(req.goal_direction).toBe('minimise');
    expect(directionLogs()).toEqual([expect.objectContaining({
      goal_direction: 'minimise', goal_node_id: goal.id, provenance: 'stated_comparator',
    })]);
  });

  it('⭐ RED row 2: held `<=` with a stated level ABOVE the target → the goal carries it (#1840 shape, the threshold\'s own cap), nothing says "not used", and the SAME request minimises', async () => {
    const { result, graph, goal } = await build(CLOUD_CEILING, draft('cloud-2'));
    // Target 36 £k/month on the target-derived cap 45 (36 × 1.25): today's 45 is 45 / 45.
    expect(goal.goal_threshold_raw).toBe(36);
    expect(goal.goal_threshold_cap).toBe(45);
    expect(goal.observed_state).toStrictEqual({
      value: 1, baseline: 1, unit: '£k/month', source: 'brief_extraction', raw_value: 45, cap: 45,
    });
    expect(said(result)).not.toMatch(/was not used|cannot be calculated correctly yet/);
    // One request: the level ISL reads AND the sense it reads it with (a level without `minimise` is the untruth).
    const req = await plotRequestFor(graph);
    expect(goalOnWire(req, goal.id).observed_state).toMatchObject({ value: 1, baseline: 1, raw_value: 45, cap: 45 });
    expect(req.goal_direction).toBe('minimise');
  });

  it('⭐ RED row 3: held `<=` with a level AT or BELOW the target → withheld, and said why (authored level variants)', async () => {
    for (const [today, brief] of [
      [30, 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £30k; we want to keep it to at most £36k a month without more than 2 weeks of migration downtime risk.'],
      [36, 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £36k; we want to keep it to at most £36k a month without more than 2 weeks of migration downtime risk.'],
    ] as const) {
      const { result, goal } = await build(brief, withGoal('cloud-2', { baseline_value: today }));
      expect(goal.goal_direction, String(today)).toBe('<=');
      expect(Object.hasOwn(goal, 'observed_state'), String(today)).toBe(false);
      expect(said(result), String(today)).toContain(`The current level of "Monthly spend" (${today}) is already at or below the target of 36`);
      expect(said(result), String(today)).not.toMatch(/cannot be calculated correctly yet/);
    }
  });

  it('row 3b: held `<=` with a level OFF the target\'s cap scale (50 > cap 45) → withheld, and said (authored level variant)', async () => {
    const brief = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £50k; we want to cut it to at most £36k a month without more than 2 weeks of migration downtime risk.';
    const { result, goal } = await build(brief, withGoal('cloud-2', { baseline_value: 50 }));
    expect(goal.goal_direction).toBe('<=');
    expect(Object.hasOwn(goal, 'observed_state')).toBe(false);
    expect(said(result)).toContain('The current level of "Monthly spend" (50) is outside the range the target of 36 is measured on (0 to 45)');
  });

  it('row 6 (R1 S1, AIQ 5871459631): held `<` → the level stays refused exactly as today, so there is no proof the target is a level of the node → nothing sent (authored operator variant)', async () => {
    const brief = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut it to under £36k a month without more than 2 weeks of migration downtime risk.';
    const { result, graph, goal } = await build(brief, withGoal('cloud-2', { operator: '<' }));
    expect(goal.goal_direction).toBe('<');
    expect(Object.hasOwn(goal, 'observed_state')).toBe(false);
    expect(said(result)).toContain('"Monthly spend" is a goal to stay below 36, and the chance of meeting a goal of that kind cannot be calculated correctly yet');
    const req = await plotRequestFor(graph);
    expect('goal_direction' in req).toBe(false);
    expect(directionLogs()).toEqual([]);
  });

  it('⭐ RED row 9 (R1 S1, AIQ 5871459631): "reduce costs by at most 10%" — a held `<=` on a CHANGE target ("% reduction") → nothing sent, the comparator still held (authored variant of the real cloud-2 draft)', async () => {
    const brief = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to reduce costs by at most 10% without more than 2 weeks of migration downtime risk.';
    const { graph, goal } = await build(brief, withGoal('cloud-2', { metric: 'costs', operator: '<=', value: 10, unit: '% reduction' }));
    expect(goal.goal_direction, 'the comparator the user wrote is still held').toBe('<=');
    const req = await plotRequestFor(graph);
    expect('goal_direction' in req).toBe(false);
    expect(directionLogs()).toEqual([]);
  });

  it('⭐ RED row 11 (R1 S1, AIQ 5872082179): a held `<=` in PERCENT beside a stated level in the same unit → the level is NOT admitted and nothing is sent (level and target share one unit, so "at most 4%" cannot be told from "reduce by at most 4%" until S4)', async () => {
    const brief = 'Should we switch our cloud provider from AWS to GCP? Downtime is 4.5% of hours today; we want to keep it to at most 4% without more than 2 weeks of migration risk.';
    const { result, graph, goal } = await build(brief, withGoal('cloud-2', { metric: 'Downtime', operator: '<=', value: 4, unit: '%', baseline_value: 4.5 }));
    expect(goal.goal_direction).toBe('<=');
    expect(Object.hasOwn(goal, 'observed_state')).toBe(false);
    expect(said(result)).toMatch(/cannot be calculated correctly yet/);
    const req = await plotRequestFor(graph);
    expect('goal_direction' in req).toBe(false);
  });

  it('⭐ RED row 10 (R1 S1): a held `<=` with NO stated current level ("at most £36k", today not given) → nothing sent (authored variant)', async () => {
    const brief = 'Should we switch our cloud provider from AWS to GCP? We want monthly spend to be at most £36k a month without more than 2 weeks of migration downtime risk.';
    const { graph, goal } = await build(brief, withGoal('cloud-2', { baseline_value: null, baseline_known: false }));
    expect(goal.goal_direction).toBe('<=');
    expect(Object.hasOwn(goal, 'observed_state')).toBe(false);
    const req = await plotRequestFor(graph);
    expect('goal_direction' in req).toBe(false);
  });
});

describe('CONTROLS — what the user did not write a ceiling for is exactly as before', () => {
  it('row 4: the real A, C and E drafts with their real briefs (floors / no target) → no goal_direction on the wire; A keeps its `>=` level', async () => {
    for (const id of ['A-0', 'C-0', 'E-0']) {
      vi.mocked(log.info).mockClear();
      const { graph, goal } = await build(briefOf(id), draft(id));
      expect(goal.goal_direction === undefined || goal.goal_direction === '>=' || goal.goal_direction === '>', id).toBe(true);
      const req = await plotRequestFor(graph);
      expect('goal_direction' in req, id).toBe(false);
      expect(directionLogs(), id).toEqual([]);
      if (id === 'A-0') {
        expect(goal.goal_direction).toBe('>=');
        expect(goal.observed_state).toStrictEqual({
          value: 0.6, baseline: 0.6, unit: 'GBP/month', source: 'brief_extraction', raw_value: 75000, cap: 125000,
        });
      }
    }
  });

  it('row 5: the real cloud-1 and cloud-2 drafts with the REAL cloud brief (target derived from "cut by 20%", not written) → no comparator held, no level, no emit', async () => {
    for (const id of ['cloud-1', 'cloud-2']) {
      vi.mocked(log.info).mockClear();
      const { result, graph, goal } = await build(CLOUD, draft(id));
      expect(Object.hasOwn(goal, 'goal_direction'), id).toBe(false);
      expect(Object.hasOwn(goal, 'observed_state'), id).toBe(false);
      expect(said(result), id).toMatch(/is a goal to stay at or below 36(000)?, and the chance of meeting a goal of that kind cannot be calculated correctly yet/);
      const req = await plotRequestFor(graph);
      expect('goal_direction' in req, id).toBe(false);
      expect(directionLogs(), id).toEqual([]);
    }
  });

  it('row 4b: the real cloud-0 draft (a floor: "costs >= 20 % reduction") with the real brief → nothing sent', async () => {
    const { graph } = await build(CLOUD, draft('cloud-0'));
    const req = await plotRequestFor(graph);
    expect('goal_direction' in req).toBe(false);
  });

  it('row 7: no held comparator, a label that reads REDUCE → the label classifier still sends minimise, logged as derived_from_goal_label (authored label on the real cloud-1 draft)', async () => {
    const { graph, goal } = await build(CLOUD, withGoal('cloud-1', { metric: 'Reduce monthly cloud spend' }));
    expect(Object.hasOwn(goal, 'goal_direction')).toBe(false);
    const req = await plotRequestFor(graph);
    expect(req.goal_direction).toBe('minimise');
    expect(directionLogs()).toEqual([expect.objectContaining({ provenance: 'derived_from_goal_label' })]);
  });

  it('row 8 (DL E13, 5872375159): a held FLOOR reads exactly as base — the label "Reduce monthly cloud costs" still sends minimise, logged derived_from_goal_label (the floor\'s own sense is S4\'s; authored label on the real cloud-0 draft)', async () => {
    const { graph, goal } = await build(CLOUD, withGoal('cloud-0', { metric: 'Reduce monthly cloud costs' }));
    expect(goal.goal_direction, 'the real cloud-0 comparator is held: "20%" is written').toBe('>=');
    const req = await plotRequestFor(graph);
    expect(req.goal_direction).toBe('minimise');
    expect(directionLogs()).toEqual([expect.objectContaining({ provenance: 'derived_from_goal_label' })]);
  });

  it('⭐ RED row 12 (DL E12, 5872375159): the brief never states today\'s level, the drafter gives one "explicit" (the real cloud-2 draft: 45 £k/month) → NOT stored as the user\'s, nothing sent', async () => {
    const brief = 'Should we switch our cloud provider from AWS to GCP? We want monthly spend to be at most £36k a month without more than 2 weeks of migration downtime risk.';
    const d = draft('cloud-2');
    expect((d.goal as Rec).baseline_value, 'the real draft carries a level the brief does not state').toBe(45);
    const { graph, goal } = await build(brief, d);
    expect(goal.goal_direction).toBe('<=');
    expect(Object.hasOwn(goal, 'observed_state'), 'no level stored as the user\'s').toBe(false);
    const req = await plotRequestFor(graph);
    expect('goal_direction' in req).toBe(false);
  });
});
