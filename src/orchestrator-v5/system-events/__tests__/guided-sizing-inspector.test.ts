/** The inspector's edge_strength_edit is a real deterministic turn with a CEE reply. */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OrchestratorTurnPayloadSchema, type SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { _resetConfigCache } from '../../../config/index.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { runExplanationChip, RUN_EXPLANATION_PREFIX } from '../../agent-lane/run-explanation.js';
import { getSessionStore, resetSessionStoreForTests } from '../../session/index.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { dispatchSystemEvent } from '../dispatch.js';

type Json = Record<string, any>;
const capture = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/guided-sizing-draw2.json', import.meta.url), 'utf8')) as Json;
const SCENARIO = capture.capture.scenario_id as string;
const PROGRESS = '2 more to go; with 1 left, Olumi can show a range.';
const savedEnv = new Map<string, string | undefined>();
let graph: Json;
let writes: SessionTurnWrite[];
let readCount: number;
let runKey: string;
type AnyFn = (...args: unknown[]) => unknown;
const stub = (target: object, name: string, impl: (...args: never[]) => unknown) =>
  vi.spyOn(target as Record<string, AnyFn>, name).mockImplementation(impl as AnyFn);

function placeholder(graph: Json, from: string, to: string): void {
  const edge = graph.edges.find((e: Json) => e.from === from && e.to === to);
  edge.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', mean_projected: true };
  edge.defaulted = true;
}
beforeEach(() => {
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'http://127.0.0.1:1',
    SUPABASE_SERVICE_ROLE_KEY: 'offline-fixture', CEE_V5_GRAPH_CAS_RPC: 'enforce', CEE_V5_EDGE_STRENGTH_EDIT: 'true' })) {
    savedEnv.set(key, process.env[key]); process.env[key] = value;
  }
  _resetConfigCache(); resetSessionStoreForTests();
  graph = structuredClone(capture.graph); writes = []; readCount = 0;
  placeholder(graph, 'pro_plan_price', 'monthly_churn');
  for (const edge of graph.edges) edge.id = `edge:${edge.from}:${edge.to}`;
  const runHash = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(graph))!;
  const computedAt = capture.analysis_state.run_state.computed_at as string;
  const fact = RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: { scenario_id: SCENARIO, summary: capture.analysis_result.summary,
      leading_option_id: capture.analysis_result.leading_option_id,
      enrichment: capture.analysis_result.enrichment, graph_hash_at_run: runHash, computed_at: computedAt } });
  runKey = runExplanationChip(SCENARIO, { graphHash: runHash, analysisState: capture.analysis_state,
    analysisResult: { ...capture.analysis_result, computed_against_hash: runHash } })!.id.slice(RUN_EXPLANATION_PREFIX.length);
  const store = getSessionStore()!;
  stub(globalThis, 'fetch', async () => { throw new Error('offline rows prohibit network'); });
  stub(store, 'loadGraph', async () => { readCount++; return graph; });
  stub(store, 'loadGraphAndBriefText', async () => ({ graph, briefText: null }));
  stub(store, 'readMostRecentPendingActions', async () => []);
  stub(store, 'readAnalysisInvalidatedAt', async () => null);
  stub(store, 'readRecent', async () => []);
  stub(store, 'readFactsWithTurnFor', async () => []);
  stub(store, 'readScenarioRunAnalysisFactsFor', async () => ({ facts: [{ fact,
    fact_row_id: '11111111-1111-4111-8111-111111111111', fact_created_at: computedAt }], total_count: 1 }));
  stub(store, 'getScenarioOwner', async () => null);
  stub(store, 'append', async (write: SessionTurnWrite) => {
    writes.push(write);
    if (write.graph !== undefined && write.graph !== null) graph = write.graph as Json;
    return { id: `22222222-2222-4222-8222-${String(writes.length).padStart(12, '0')}` };
  });
});
afterEach(() => {
  vi.restoreAllMocks(); resetSessionStoreForTests();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  savedEnv.clear(); _resetConfigCache();
});
async function size(from: string, to: string): Promise<Json> {
  const edge = graph.edges.find((e: Json) => e.from === from && e.to === to);
  const payload = OrchestratorTurnPayloadSchema.parse({ kind: 'system_event',
    turn_id: `33333333-3333-4333-8333-${String(writes.length + 1).padStart(12, '0')}`,
    scenario_id: SCENARIO, stage: 'analyse', event: { kind: 'edge_strength_edit', from, to, intent: 'set',
      magnitude: 0.7, direction_intent: 'preserve', expected: { mean: edge.strength.mean, effect_direction: edge.effect_direction } } }) as SystemEventTurnPayload;
  const result = await dispatchSystemEvent({ payload, requestId: 'guided-inspector-row' });
  expect(result.commitPerformed).toBe(true);
  expect(result.graph).not.toBeNull();
  return result.response as Json;
}

it('INSPECTOR DOOR: successful canonical commit replies with fresh M=2 and one identical press per remaining id', async () => {
  const response = await size('monthly_churn', 'paying_pro_subscribers');
  expect(readCount).toBeGreaterThan(0);
  expect(writes).toHaveLength(1);
  expect(response.assistant_text.endsWith(PROGRESS)).toBe(true);
  const hook = response.guided_sizing;
  expect(hook).toBeDefined();
  expect(hook.remaining).toBe(2);
  expect(hook.total).toBe(2);
  expect(hook.progress_line).toBe(PROGRESS);
  expect(hook.graph_hash).toBe(computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(graph)));
  expect(hook.run_key).toBe(runKey);
  expect(hook.links.map((l: Json) => [l.from, l.to])).toEqual([
    ['pro_plan_price', 'mrr_lost_to_price_sensitivity'], ['pro_plan_price', 'monthly_churn']]);
  for (const link of hook.links) {
    const press = response.suggested_actions.find((p: Json) => p.id === link.press.id);
    expect(link.press).toEqual({ id: press.id, parameters: press.parameters });
    expect(link.press.parameters.edge_id).toBe(link.id);
    expect(link.id).toBe(graph.edges.find((e: Json) => e.from === link.from && e.to === link.to).id);
  }
});

it('INSPECTOR DOOR M=1: second edit reads the new stored graph and emits no progress line or hook', async () => {
  await size('monthly_churn', 'paying_pro_subscribers');
  const readsBefore = readCount;
  const response = await size('pro_plan_price', 'mrr_lost_to_price_sensitivity');
  expect(readCount).toBeGreaterThan(readsBefore);
  expect(writes).toHaveLength(2);
  expect(response.assistant_text).not.toContain('more to go');
  expect(response.guided_sizing).toBeUndefined();
});
