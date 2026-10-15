/**
 * ⭐ S4 2b, a SIGNED current goal level (AIE 6187351293: scoped approval on the existing frame path). "Right now we're losing a
 * net £2,000 a month … I want us to break even within 6 months": the goal "Net monthly profit" (today −2000, target ≥ 0) lost
 * its current level AND its target's scale, because a 0 target has no magnitude for the target-derived scale. One positive,
 * zero-preserving scale F = |today| now carries both: today −1, the target 0, the comparator kept. Rows: the real drafter raw
 * for a brief PROMPT wrote, through the real `buildModelFromBrief`, then the real `run_analysis` handler.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

type Rec = Record<string, any>;
type Case = { brief: string; call1_text: string; call2_text: string; _source: Rec };
const CAFE = JSON.parse(readFileSync('tests/fixtures/sys2/s4-net-loss-cafe.json', 'utf8')) as Case;
const SCENARIO = '6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c';
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-15T08:00:00.000Z')); });
afterEach(() => { vi.useRealTimers(); });

/** The café raw with its goal edited (both passes), so one recorded draft drives every reading below. */
async function goalOf(edit: (goal: Rec) => Rec = (g) => g): Promise<{ graph: Rec; goal: Rec }> {
  let graph: Rec | undefined;
  const answers = [CAFE.call1_text, CAFE.call2_text].map((t) => { const r = JSON.parse(t); return JSON.stringify({ ...r, goal: edit(r.goal) }); });
  let call = 0;
  const result = await buildModelFromBrief(SCENARIO, CAFE.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: answers[Math.min(call++, answers.length - 1)]!, status: 'completed' })) as never) as Rec;
  if (result.ok !== true || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return { graph, goal: (graph.nodes as Rec[]).find((n) => n.kind === 'goal')! };
}
async function sentGoal(graph: Rec): Promise<Rec | undefined> {
  const run = vi.fn(async () => ({ meta: { seed_used: 1, n_samples: 100, response_hash: 'sha256:2b' }, results: [], response_hash: 'sha256:2b-top', analysis_status: 'completed' }));
  const options = (graph.nodes as Rec[]).filter((n) => n.kind === 'option')
    .map((o) => ({ id: o.id, option_id: o.id, label: o.label, interventions: o.interventions ?? {} }));
  const goalId = (graph.nodes as Rec[]).find((n) => n.kind === 'goal')!.id;
  const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(() => Promise.resolve({ graph, rawPersistedGraph: graph, goal_node_id: goalId, options } as RunAnalysisScenarioSnapshot)) });
  try {
    await handler({
      context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [{ role: 'user', content: 'run analysis' }],
        session_id: SCENARIO, request_id: 'req-2b', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
        scenarioBriefText: null, persistedGraph: null } as unknown as HandlerInvocation['context'],
      payload: makeMessagePayload({ turn_id: 't1', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-2b', signal: new AbortController().signal, orientationText: '',
    });
  } catch { /* a refusal sends nothing; the caller asserts on what was sent */ }
  const sent = (run.mock.calls as unknown[][])[0]?.[0] as Rec | undefined;
  return (sent?.graph?.nodes as Rec[] | undefined)?.find((n) => n.id === goalId);
}

describe('S4 2b: a negative current goal level on its own magnitude\'s scale', () => {
  it('PRECONDITION (as captured on 87d5f90e): the café goal had no current level', () => {
    expect(CAFE._source.registered_as_captured.goal_observed_state).toBeNull();
  });

  it('CAFE: today −£2,000 and "break even" (≥ 0) are −1 and 0 on F = 2000; the comparator is kept', async () => {
    const { goal } = await goalOf();
    expect(goal).toMatchObject({ goal_threshold_raw: 0, goal_threshold: 0, goal_threshold_cap: 2000, goal_threshold_cap_provenance: 'level_frame' });
    expect(goal.observed_state).toMatchObject({ value: -1, baseline: -1, raw_value: -2000, cap: 2000, unit: '£/month' });
  });

  it('CAFE: a target still below zero (−£500) keeps its sign on the same scale: −0.25, never abs() or clipped', async () => {
    const { goal } = await goalOf((g) => ({ ...g, value: -500 }));
    expect(goal).toMatchObject({ goal_threshold_raw: -500, goal_threshold: -0.25, goal_threshold_cap: 2000 });
    expect(goal.observed_state).toMatchObject({ value: -1, raw_value: -2000 });
  });

  it('CAFE: the Run sends the goal with today −1 and the target 0', async () => {
    const { graph } = await goalOf();
    const wire = await sentGoal(graph);
    expect(wire, 'the Run must reach PLoT').toBeDefined();
    expect(wire).toMatchObject({ goal_threshold: 0 });
    expect(wire!.observed_state).toMatchObject({ baseline: -1 });
  });

  it('CONTRAST: today AT the target (0) has no scale; nothing is divided by zero and the level is not written', async () => {
    const { goal } = await goalOf((g) => ({ ...g, baseline_value: 0 }));
    expect(goal.goal_threshold_cap).toBeUndefined();
    expect(goal.observed_state).toBeUndefined();
  });

  it('CONTRAST: today ABOVE the target (+£500, ≥ 0) is not given the signed scale', async () => {
    const { goal } = await goalOf((g) => ({ ...g, baseline_value: 500 }));
    expect(goal.goal_threshold_cap_provenance).not.toBe('level_frame');
    expect(goal.observed_state).toBeUndefined();
  });

  it('CONTRAST: a ceiling ("keep the loss at or below 0") is not read as a floor', async () => {
    const { goal } = await goalOf((g) => ({ ...g, operator: '<=' }));
    expect(goal.goal_threshold_cap_provenance).not.toBe('level_frame');
  });
});
