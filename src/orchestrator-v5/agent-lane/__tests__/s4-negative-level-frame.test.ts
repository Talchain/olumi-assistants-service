/**
 * ⭐ S4 NET LOSS, the carrier (DL ruling 15 Oct, conditional; met: ISL staging a5725a15 accepts a negative normalised
 * baseline, and the same model as a magnitude, 15 lost with a negative link, gives the same goal chance within 0.006). A
 * stated net loss of 15 members a month was admitted with NO raw value and NO frame, so every Run refused it
 * (`baseline_scale_unresolved`, unseen brief R4). It is now the edit writer's framed pair on the drafted range,
 * `{ value: raw / frame, raw_value: raw }` beside `scale_frame`, never a cap (a cap has no negative), and the Run's scale gate
 * reads that pair against its stored frame. Rows: the real drafter raw for a brief PROMPT wrote, through the real
 * `buildModelFromBrief`, then the real `run_analysis` handler.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { createRunAnalysisHandler, HandlerInvocationFailedError, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import { findScaleIncoherentBaselineFactorIds } from '../../tools/plot-intervention-scale.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

type Rec = Record<string, any>;
type Case = { brief: string; call1_text: string; call2_text: string; _source: Rec };
const GYM = JSON.parse(readFileSync('tests/fixtures/sys2/s4-net-loss-gym.json', 'utf8')) as Case;
const SCENARIO = '6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c';
const AT = '2026-10-15T07:00:00.000Z';
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(AT)); });
afterEach(() => { vi.useRealTimers(); });

async function registered(c: Case): Promise<Rec> {
  let graph: Rec | undefined;
  const answers = [c.call1_text, c.call2_text];
  let call = 0;
  const result = await buildModelFromBrief(SCENARIO, c.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: answers[Math.min(call++, answers.length - 1)]!, status: 'completed' })) as never) as Rec;
  if (result.ok !== true || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return graph;
}
const LOSS = 'Net monthly member change';
const lossNode = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.label === LOSS)!;

function snapshotOf(graph: Rec): RunAnalysisScenarioSnapshot {
  const options = (graph.nodes as Rec[]).filter((n) => n.kind === 'option')
    .map((o) => ({ id: o.id, option_id: o.id, label: o.label, interventions: o.interventions ?? o.data?.interventions ?? {} }));
  return { graph, rawPersistedGraph: graph, goal_node_id: (graph.nodes as Rec[]).find((n) => n.kind === 'goal')!.id, options } as never;
}
function invocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO, request_id: 'req-s4', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ turn_id: 't1', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-s4', signal: new AbortController().signal, orientationText: '',
  };
}
async function runOn(graph: Rec): Promise<{ sent: Rec | undefined; failure: unknown }> {
  const run = vi.fn(async () => ({ meta: { seed_used: 1, n_samples: 100, response_hash: 'sha256:s4' }, results: [], response_hash: 'sha256:s4-top', analysis_status: 'completed' }));
  const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(() => Promise.resolve(snapshotOf(graph))) });
  let failure: unknown = null;
  try { await handler(invocation()); } catch (e) { failure = e; }
  return { sent: run.mock.calls[0]?.[0] as Rec | undefined, failure };
}

describe('S4: a stated net loss carries its raw value and frame, and the Run reads it', () => {
  it('PRECONDITION (as captured on 87d5f90e): no raw value, no frame pair', () => {
    expect(GYM._source.registered_as_captured.net_monthly_member_change_observed_state).not.toHaveProperty('raw_value');
  });

  it('GYM: −15 is the framed pair on the drafted range, beside scale_frame, never a cap', async () => {
    const n = lossNode(await registered(GYM));
    expect(n.observed_state).toMatchObject({ value: -15 / 200, raw_value: -15, unit: 'members per month', source: 'brief_extraction', extractionType: 'explicit' });
    expect(n.observed_state.cap).toBeUndefined();
    expect(n.scale_frame).toBe(200);
  });

  it('GYM: the Run is not refused for that factor, and PLoT receives −0.075 for it', async () => {
    const graph = await registered(GYM);
    expect(findScaleIncoherentBaselineFactorIds(graph.nodes, [])).not.toContain(lossNode(graph).id);
    const { sent, failure } = await runOn(graph);
    expect((failure as HandlerInvocationFailedError | null)?.details).toBeUndefined();
    const wire = JSON.stringify(sent);
    const id = lossNode(graph).id as string;
    const node = (sent?.graph?.nodes as Rec[] | undefined)?.find((x) => x.id === id);
    expect(node?.observed_state?.value, wire.slice(0, 400)).toBe(-15 / 200);
  });

  it('CONTROL: a bare raw −15 beside the same frame (no pair) still blocks, naming the factor', async () => {
    const graph = await registered(GYM);
    const n = lossNode(graph);
    n.observed_state = { ...n.observed_state, value: -15, raw_value: -15 };
    expect(findScaleIncoherentBaselineFactorIds(graph.nodes, [])).toEqual([n.id]);
    const { sent, failure } = await runOn(graph);
    expect(sent).toBeUndefined();
    expect((failure as HandlerInvocationFailedError).details).toMatchObject({ reason_code: 'baseline_scale_unresolved' });
  });
});
