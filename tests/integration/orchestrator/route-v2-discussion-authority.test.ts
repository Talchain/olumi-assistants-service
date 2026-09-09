/**
 * Native a4ca975f, 2026-09-09: the lean composer request was intercepted as
 * a vague edit because its explicit refusal contains "change the model".
 * Real Fastify route -> context loader -> executor -> router -> handlers.
 * Only the model adapter and session I/O are replaced; no network/provider.
 * The persisted fixture is representative, NOT the complete native model.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { SessionTurnWithContent } from '../../../src/orchestrator-v5/session/conversation-content.js';
import type { SessionTurnWrite } from '../../../src/orchestrator-v5/session/store.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import type { GraphStateIngress } from '../../../src/orchestrator-v5/boundary/request-extensions.js';

const { append, editDispatch, coachCall, routeReceiver, handlerReceiver, telemetry } = vi.hoisted(() => ({
  append: vi.fn<(write: SessionTurnWrite) => Promise<{ id: string }>>(),
  editDispatch: vi.fn(),
  coachCall: vi.fn(),
  routeReceiver: vi.fn(),
  handlerReceiver: vi.fn(),
  telemetry: vi.fn(),
}));

const SCENARIO = 'd66123ea-cc6a-40aa-a33c-afcb14f3af59';
const REMINDER = 'Please remind me how the two-and-two split addresses my reliability concern.';
const NATIVE_MESSAGE = `${REMINDER} Discuss only; don't change the model or run analysis.`;
const ANSWER = 'The split allocates some capacity to platform reliability and some to sales. Whether that addresses your concern depends on which reliability bottleneck the engineers can actually remove.';
const GRAPH = {
  goal_node_id: 'goal_revenue',
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Sustainable revenue' },
    { id: 'opt_eng', kind: 'option', label: 'Hire Four Platform Engineers', interventions: { fac_eng: 1 } },
    { id: 'opt_split', kind: 'option', label: 'Two-and-Two Split (AE + Engineer)', interventions: { fac_eng: 0.5 } },
    { id: 'fac_eng', kind: 'factor', label: 'Platform Engineer Headcount Added', observed_state: { value: 1 } },
  ],
  edges: [{ from: 'fac_eng', to: 'goal_revenue', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9 }],
} satisfies GraphStateIngress;
const GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH);
if (GRAPH_HASH === null) throw new Error('The persisted discussion fixture must have a real graph hash.');
const PRIOR_TURN = {
  id: '37fedec1-6d73-4f40-8854-201206f42dd5',
  scenario_id: SCENARIO,
  user_id: null,
  turn_id: '22222222-2222-4222-8222-222222222222',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-analysis',
  response_emitted: true,
  llm_calls_used: 0,
  duration_ms: 8,
  created_at: '2026-09-09T06:07:04.202Z',
  user_message: 'Run the analysis.',
  assistant_message: 'Analysis complete. Reliability remains a concern.',
} satisfies SessionTurnWithContent;
const PRIOR_FACT = {
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: SCENARIO, leading_option_id: null, summary: 'Previous analysis', enrichment: { analysis_status: 'complete' }, graph_hash_at_run: GRAPH_HASH, computed_at: '2026-09-09T06:07:04.202Z' },
} satisfies HandlerFact;

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append,
    readRecent: async () => [PRIOR_TURN],
    readFactsFor: async () => [PRIOR_FACT],
    loadGraph: async () => structuredClone(GRAPH),
    loadGraphAndBriefText: async () => ({ graph: structuredClone(GRAPH), briefText: 'Balance growth with reliable platform delivery.' }),
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async (_scenario: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    ensureScenarioExists: async (_scenario: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({ dispatchEditGraph: editDispatch }));
vi.mock('../../../src/orchestrator-v5/routing/route-with-tool-use.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/orchestrator-v5/routing/route-with-tool-use.js')>();
  return { ...actual, routeWithToolUse: (...args: Parameters<typeof actual.routeWithToolUse>) => {
    routeReceiver(...args);
    return actual.routeWithToolUse(...args);
  } };
});
vi.mock('../../../src/orchestrator-v5/tools/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/orchestrator-v5/tools/registry.js')>();
  return { ...actual, resolveHandler: (...args: Parameters<typeof actual.resolveHandler>) => {
    const handler = actual.resolveHandler(...args);
    if (!handler) return null;
    return (invocation: Parameters<typeof handler>[0]) => {
      handlerReceiver(args[1], invocation);
      return handler(invocation);
    };
  } };
});
vi.mock('../../../src/utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/telemetry.js')>();
  return { ...actual, emit: (...args: Parameters<typeof actual.emit>) => {
    telemetry(...args);
    return actual.emit(...args);
  } };
});
vi.mock('../../../src/adapters/llm/router.js', () => {
  const adapter = {
    name: 'test', model: 'test-model',
    chat: async () => ({ content: ANSWER, usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: (...args: unknown[]) => {
      coachCall(...args);
      return Promise.resolve({
        content: [{ type: 'tool_use', id: 'toolu_discuss', name: 'olumi_action', input: {
          intent_class: 'execute',
          action: { handler_id: 'explain_from_structure', entity: { id: 'opt_split', kind: 'option', resolution_status: 'resolved', resolution_method: 'context_inference' }, parameters: [], cited_context_fields: [], explanation: { answer_text: ANSWER } },
        } }],
        stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20 }, model: 'test-model', latencyMs: 1,
      });
    },
  };
  return { getAdapter: () => adapter, getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' } }), getMaxTokensFromConfig: () => undefined };
});
vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'Test system prompt.' }));
vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/index.js')>();
  return { ...actual, config: new Proxy(actual.config, {
    get(target, property) {
      if (property === 'features') return new Proxy(target.features, {
        get(features, key) { return key === 'pipelineV4Enabled' ? false : Reflect.get(features, key); },
      });
      return Reflect.get(target, property);
    },
  }) };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

// Exact native request keys, including no graph_state, analysis_state or history.
function nativeRequest(message = NATIVE_MESSAGE, selected = true) {
  return {
    kind: 'message', turn_id: '226cb149-9c1e-4518-9300-53eabac3fd33', scenario_id: SCENARIO,
    stage: 'analyse', turn_class: 'frame', message, source: 'composer',
    ...(selected ? { selected_elements: [{ id: 'opt_eng', kind: 'option', label: 'Hire Four Platform Engineers' }] } : {}),
  };
}
function wroteGraph(): boolean {
  return append.mock.calls.some(([write]) => write.graph != null);
}
function intercepted(): boolean {
  return telemetry.mock.calls.some(([name]) => name === 'v5.edit_graph.intercepted_vague_edit' || name === 'v5.edit_graph.intercepted_chip_clarify');
}

describe('lean native discussion respects explicit no-change authority at both edit doors', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = Fastify(); await ceeOrchestratorRouteV2(app); await app.ready(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    vi.clearAllMocks();
    append.mockResolvedValue({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    editDispatch.mockResolvedValue({ response: { response_version: 2, assistant_text: 'EDIT DISPATCH SENTINEL', blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse' }, commitPerformed: true });
  });

  it.each([
    { name: 'exact capture with selection', message: NATIVE_MESSAGE, selected: true },
    { name: 'same capture without selection', message: NATIVE_MESSAGE, selected: false },
    // The year makes the legacy vague guard decline on its numeric check.
    // This synthetic neighbour independently exercises the FINAL edit door.
    { name: 'final-dispatch contrast with a planning year', message: `${NATIVE_MESSAGE} The planning horizon is 2027.`, selected: true },
  ])('$name reaches the real conversational receiver', async ({ message, selected }) => {
    const request = nativeRequest(message, selected);
    expect(request).not.toHaveProperty('graph_state');
    expect(request).not.toHaveProperty('analysis_state');
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: request });
    expect(res.statusCode, res.body).toBe(200);
    expect(intercepted()).toBe(false);
    expect(editDispatch).not.toHaveBeenCalled();
    expect(routeReceiver).toHaveBeenCalledTimes(1);
    expect(coachCall).toHaveBeenCalledTimes(1);
    expect(handlerReceiver.mock.calls.map(([id]) => id)).toEqual(['explain_from_structure']);
    expect(res.json().assistant_text).toContain('platform reliability');
    expect(JSON.stringify(coachCall.mock.calls)).toContain(PRIOR_TURN.assistant_message);
    expect(wroteGraph()).toBe(false);
  });

  it('ordinary reminder without protective wording still reaches discussion', async () => {
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: nativeRequest(REMINDER) });
    expect(res.statusCode, res.body).toBe(200);
    expect(routeReceiver).toHaveBeenCalledTimes(1);
    expect(handlerReceiver.mock.calls.map(([id]) => id)).toEqual(['explain_from_structure']);
    expect(editDispatch).not.toHaveBeenCalled();
    expect(wroteGraph()).toBe(false);
  });

  it('a genuine vague edit retains its clarification, without calling the coach', async () => {
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: nativeRequest('Please change the model.') });
    expect(res.statusCode, res.body).toBe(200);
    expect(intercepted()).toBe(true);
    expect(res.json().assistant_text).toContain('specific factor, edge, option, or value');
    expect(routeReceiver).not.toHaveBeenCalled();
    expect(editDispatch).not.toHaveBeenCalled();
    expect(wroteGraph()).toBe(false);
  });

  it('a scoped prohibition preserves an affirmative canonical value edit', async () => {
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: nativeRequest("Set Platform Engineer Headcount Added to 0.75, and don't change anything else.") });
    expect(res.statusCode, res.body).toBe(200);
    expect(intercepted()).toBe(false);
    expect(editDispatch).not.toHaveBeenCalled();
    expect(handlerReceiver.mock.calls.map(([id]) => id)).toContain('set_factor_value');
    expect(wroteGraph()).toBe(true);
    const graphWrites = append.mock.calls.map(([write]) => write.graph).filter((graph) => graph != null);
    expect(graphWrites).toHaveLength(1);
    expect(graphWrites[0]).toMatchObject({ nodes: expect.arrayContaining([
      ...GRAPH.nodes.filter((node) => node.id !== 'fac_eng'),
      expect.objectContaining({ id: 'fac_eng', observed_state: expect.objectContaining({ value: 0.75 }) }),
    ]) });
    expect(coachCall).not.toHaveBeenCalled();
  });
});
