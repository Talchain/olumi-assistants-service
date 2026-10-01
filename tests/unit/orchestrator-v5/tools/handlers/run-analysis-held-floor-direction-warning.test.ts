/**
 * ⭐ A9 RESIDUAL — A GOAL THE USER HELD AS A FLOOR IS NOT "NO OBJECTIVE SENSE STATED" (R3 accept-paul A9; MG lease #75 5923478493).
 *
 * Served R3 train-2255Z (`09-cold-reload`): Paul approved "at least £1m", the goal held `goal_direction ">="`, and the reloaded
 * Run still carried PLoT's GOAL_DIRECTION_UNATTESTED on `enrichment.inference_warnings[]` and `decision_brief.warning_codes[]`,
 * whose message says the ranking "is an assumption, not the team's stated aim". DGAI renders it as "the model does not say
 * which way your goal should go": false. The run ranked by the largest goal value, which IS the user's floor.
 *
 * Real path: `createRunAnalysisHandler` with PLoT's response mocked (served code + message verbatim) on the served c96fc4bb
 * graph (its goal holds ">"), and the controls the lease names.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../../../../src/orchestrator-v5/tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../../../../src/orchestrator-v5/tools/registry.js';
import type { PLoTClient } from '../../../../../src/orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../../src/orchestrator/types.js';

import minimalFixture from '../../../../fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../../../fixtures/served/c96fc4bb-saved-graph.json', import.meta.url), 'utf8')) as { goal_node_id: string; graph: Rec };
const CODE = 'GOAL_DIRECTION_UNATTESTED';
/** PLoT's entry as served on train-2255Z, verbatim to the cut. */
const DIRECTION = { code: CODE, severity: 'warning', message: 'No objective sense was stated for the goal node, so options were ranked by largest goal value. That is an assumption, not the team\'s stated aim.' };
const OTHER = { code: 'EDGE_E_VALUE_NON_FINITE_DROPPED', severity: 'info', message: 'kept as served' };

afterEach(() => { vi.restoreAllMocks(); });

function goal(edit?: (g: Rec) => void): Rec {
  const graph = JSON.parse(JSON.stringify(FX.graph)) as Rec;
  edit?.(graph.nodes.find((n: Rec) => n.id === FX.goal_node_id));
  return graph;
}
function plotResponse(): V2RunResponseEnvelope {
  return { ...JSON.parse(JSON.stringify(minimalFixture)), inference_warnings: [OTHER, DIRECTION], decision_brief: { warning_codes: [CODE, 'OTHER_CODE'], warnings: [{ code: CODE }, { code: 'OTHER_CODE' }] } } as unknown as V2RunResponseEnvelope;
}
/** Every place the run's result carries the code, by JSON path. */
function carriers(o: unknown, path = ''): string[] {
  if (Array.isArray(o)) return o.flatMap((v, i) => carriers(v, `${path}[${i}]`));
  if (o !== null && typeof o === 'object') return Object.entries(o as Rec).flatMap(([k, v]) => carriers(v, `${path}.${k}`));
  return o === CODE ? [path] : [];
}
async function run(graph: Rec): Promise<unknown> {
  const options = graph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => ({ id: n.id, option_id: n.id, label: n.label, interventions: { pro_plan_price: 59 } }));
  const snapshot = { graph, options, goal_node_id: FX.goal_node_id, rawPersistedGraph: JSON.parse(JSON.stringify(graph)) } as RunAnalysisScenarioSnapshot;
  const runMock = vi.fn(async () => plotResponse());
  const plotClient = { run: runMock, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: async () => snapshot });
  const invocation = { payload: { scenario_id: 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4' }, requestId: 'req-a9', signal: new AbortController().signal, context: {}, orientationText: '' } as unknown as HandlerInvocation;
  const outcome = await handler(invocation);
  expect(runMock).toHaveBeenCalledTimes(1);
  return outcome;
}

describe('A9 residual: PLoT\'s GOAL_DIRECTION_UNATTESTED never reaches a run whose goal the user held as a floor', () => {
  it('RED: the served goal holds ">" → the code is on NO carrier of the run, and the other codes stay', async () => {
    const out = await run(goal());
    expect(carriers(out)).toEqual([]);
    expect(JSON.stringify(out)).toContain(OTHER.message);
    expect(JSON.stringify(out)).toContain('OTHER_CODE');
  });

  it.each([
    ['no direction held', (g: Rec) => { delete g.goal_direction; }],
    ['a held ceiling ("<=")', (g: Rec) => { g.goal_direction = '<='; }],
    ['"at least a 20% cut": ">=" on a NEGATIVE change points DOWN', (g: Rec) => { g.goal_direction = '>='; g.goal_threshold_frame = 'change_rel'; g.goal_threshold_raw = -0.2; }],
  ])('control: %s → the code is kept on every carrier', async (_label, edit) => {
    const out = await run(goal(edit));
    expect(carriers(out).length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(out)).toContain(DIRECTION.message);
  });
});
