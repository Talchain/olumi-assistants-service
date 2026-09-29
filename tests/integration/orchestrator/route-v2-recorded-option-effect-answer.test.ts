/**
 * B5: the question's durable option/factor identity, not today's first blocker,
 * owns a subsequent natural answer. Real Fastify route; dispatcher/storage/LLM
 * boundaries are mocked deliberately. This is not a persistence/live witness.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { TurnSource } from '@talchain/schemas/boundary';
import type { FastifyInstance } from 'fastify';
import type { PendingAction } from '../../../src/orchestrator-v5/session/pending-action.js';
import { parsePendingAction } from '../../../src/orchestrator-v5/session/pending-action.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../src/orchestrator/tools/analysis-ready-helper.js';
import { deriveMissingEffectPairs } from '../../../src/orchestrator-v5/routing/repair-value-binding.js';

const dispatchEditGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));
const appendMock = vi.fn().mockResolvedValue({ id: 'test-parent-row' });
const loadGraphMock = vi.fn();
const readPendingsMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_scenario: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: readPendingsMock,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));
const chatWithToolsMock = vi.fn(async () => ({
  content: [{ type: 'text', text: 'Ordinary unrelated continuation.' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
}));
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test', model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test', model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const SCENARIO = '55555555-5555-4555-8555-55555555555b';
const ASKED = {
  optionId: 'opt_courier', optionLabel: 'Green courier',
  factorId: 'fac_cost', factorLabel: 'Delivery cost',
};
const OTHER = {
  optionId: 'opt_pass', optionLabel: 'Pass charges through',
  factorId: 'fac_price', factorLabel: 'Customer price',
};
function edge(from: string, to: string) {
  return { from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' };
}
function graph(onlyAskedMissing = false) {
  // OTHER intentionally precedes ASKED. The producer-derived assertion below
  // proves this is a real first-blocker conflict, not just a fixture comment.
  return {
    goal_node_id: 'goal',
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Protect margin' },
      { id: OTHER.factorId, kind: 'factor', label: OTHER.factorLabel, category: 'controllable' },
      { id: ASKED.factorId, kind: 'factor', label: ASKED.factorLabel, category: 'controllable' },
      { id: OTHER.optionId, kind: 'option', label: OTHER.optionLabel,
        ...(onlyAskedMissing ? { data: { interventions: { [OTHER.factorId]: 0.3 } } } : {}) },
      { id: ASKED.optionId, kind: 'option', label: ASKED.optionLabel },
    ],
    edges: [edge(OTHER.optionId, OTHER.factorId), edge(ASKED.optionId, ASKED.factorId),
      edge(OTHER.factorId, 'goal'), edge(ASKED.factorId, 'goal')],
  };
}
function pending(currentGraph = graph(), pair = ASKED): PendingAction {
  const graphHash = computeAnalysisAffectingGraphHash(currentGraph);
  if (graphHash === null) throw new Error('Pending fixture graph did not hash');
  return {
    id: randomUUID(), scenario_id: SCENARIO, chip_id: 'chip_configure_option_clarify',
    action: { kind: 'elicit_option_effect', option_id: pair.optionId, option_label: pair.optionLabel,
      factor_id: pair.factorId, factor_label: pair.factorLabel },
    preconditions: { graph_hash: graphHash },
    expires_at_turn_count: 3, emitted_at_iso: new Date().toISOString(),
    expires_at_iso: new Date(Date.now() + 120_000).toISOString(),
  };
}
function sibling(asked: PendingAction, action: PendingAction['action']): PendingAction {
  return { ...asked, id: randomUUID(), chip_id: `sibling-${action.kind}`, action };
}
function mockDispatchSuccess() {
  dispatchEditGraphMock.mockResolvedValue({
    response: { response_version: 2, assistant_text: 'Applied edit.', blocks: [],
      suggested_actions: [], insights: [], stage_indicator: 'frame' },
    commitPerformed: true,
  });
}
function request(message: string, extra: Record<string, unknown> = {}) {
  return { kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'frame',
    turn_class: 'frame', source: 'composer', message, ...extra };
}
type RecordedDispatch = {
  payload: { message: string };
  recordedEffectAnswer?: {
    pending: PendingAction; pair: typeof ASKED; valueText: string; instruction: string;
    priorPendingActions: readonly PendingAction[];
  };
};
function dispatched(): RecordedDispatch {
  expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
  return dispatchEditGraphMock.mock.calls[0]![0] as RecordedDispatch;
}
function expectNoGraphWrite() {
  expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  for (const [write] of appendMock.mock.calls) expect(write.graph).toBeUndefined();
}

describe('B5 recorded option-effect answer — exact asked cell survives the route', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = Fastify(); await ceeOrchestratorRouteV2(app); await app.ready(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    dispatchEditGraphMock.mockReset(); appendMock.mockClear(); chatWithToolsMock.mockClear();
    loadGraphMock.mockReset(); readPendingsMock.mockReset();
    loadGraphMock.mockResolvedValue(graph()); readPendingsMock.mockResolvedValue([]);
    mockDispatchSuccess();
  });
  const send = (message: string, extra: Record<string, unknown> = {}) => app.inject({
    method: 'POST', url: '/orchestrate/v2/turn', payload: request(message, extra),
  });

  it('fixture contrast: canonical readiness first names OTHER while the persisted ask names ASKED', () => {
    const pairs = deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(graph()));
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual(OTHER);
    expect(parsePendingAction(pending())).not.toBeNull();
  });

  it('natural set-it answer carries exact persisted IDs beyond route, not just a label sentence', async () => {
    const asked = pending(); readPendingsMock.mockResolvedValue([asked]);
    expect((await send('Set it to about 0.9.')).statusCode).toBe(200);
    const args = dispatched();
    expect(args.recordedEffectAnswer).toMatchObject({ pending: { id: asked.id }, pair: ASKED, valueText: '0.9' });
    expect(args.recordedEffectAnswer?.instruction).toContain('Green courier');
    expect(args.payload.message).toBe('Set it to about 0.9.');
    expect(readPendingsMock).toHaveBeenCalledWith(SCENARIO, { validation: 'strict' });
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it.each(TurnSource.options)('recorded identity is source-union invariant: %s', async source => {
    const asked = pending(); readPendingsMock.mockResolvedValue([asked]);
    const response = await send('Set it to about 0.9.', { source });
    expect(response.statusCode).toBe(200);
    expect(dispatched().recordedEffectAnswer).toMatchObject({ pending: { id: asked.id }, pair: ASKED });
  });

  it('same input but different durable ask binds OTHER, not the previous test target', async () => {
    const asked = pending(graph(), OTHER); readPendingsMock.mockResolvedValue([asked]);
    await send('Set it to about 0.9.');
    expect(dispatched().recordedEffectAnswer).toMatchObject({ pending: { id: asked.id }, pair: OTHER, valueText: '0.9' });
  });

  it('20 does not invent percent; question survives and a subsequent explicit 20% supplies .2', async () => {
    const asked = pending(); readPendingsMock.mockResolvedValue([asked]);
    const invalid = await send('20');
    expect(invalid.statusCode).toBe(200); expectNoGraphWrite();
    expect(appendMock).toHaveBeenCalled();
    const persisted = appendMock.mock.calls.at(-1)![0];
    expect(persisted.pending_actions).toEqual(expect.arrayContaining([expect.objectContaining({ id: asked.id })]));
    expect(invalid.json().assistant_text).toContain(ASKED.optionLabel);
    expect(invalid.json().assistant_text).toContain(ASKED.factorLabel);
    readPendingsMock.mockResolvedValue(persisted.pending_actions);
    appendMock.mockClear(); dispatchEditGraphMock.mockClear();
    await send('20%');
    expect(dispatched().recordedEffectAnswer).toMatchObject({ pending: { id: asked.id }, pair: ASKED, valueText: '0.2' });
  });

  it('a competing live baseline ask blocks global missing-effect fallback', async () => {
    const currentGraph = graph(true); loadGraphMock.mockResolvedValue(currentGraph);
    const asked = pending(currentGraph);
    const baseline = sibling(asked, { kind: 'elicit_target_baseline', target_id: 'fac_price',
      target_label: 'Customer price', constraint_type: 'at_most', value: 40, unit: '%' });
    expect(parsePendingAction(baseline)).not.toBeNull();
    readPendingsMock.mockResolvedValue([asked, baseline]);
    await send('Set it to about 0.9.');
    expectNoGraphWrite();
  });

  it('an unrelated run offer must not suppress the sole actual numerical question', async () => {
    const asked = pending();
    const run = sibling(asked, { kind: 'run_analysis' });
    readPendingsMock.mockResolvedValue([asked, run]);
    await send('Set it to about 0.9.');
    expect(dispatched().recordedEffectAnswer).toMatchObject({ pending: { id: asked.id }, pair: ASKED });
    expect(dispatched().recordedEffectAnswer?.priorPendingActions).toEqual([asked, run]);
  });

  it('pending read failure cannot become authoritative absence and global fallback', async () => {
    loadGraphMock.mockResolvedValue(graph(true));
    readPendingsMock.mockRejectedValue(new Error('read unavailable'));
    await send('Set it to about 0.9.');
    expectNoGraphWrite();
    expect(readPendingsMock).toHaveBeenCalledWith(SCENARIO, { validation: 'strict' });
  });

  it('malformed authoritative row refuses strict read instead of tolerant-drop and fallback', async () => {
    loadGraphMock.mockResolvedValue(graph(true));
    readPendingsMock.mockImplementation(async (_id: string, options?: { validation: string }) => {
      if (options?.validation === 'strict') throw new Error('malformed pending row');
      return []; // existing tolerant reader would discard the malformed entry
    });
    await send('Set it to about 0.9.');
    expectNoGraphWrite();
    expect(readPendingsMock).toHaveBeenCalledWith(SCENARIO, { validation: 'strict' });
  });

  it('expired recorded ask does not resurrect as a sole-missing global binding', async () => {
    const currentGraph = graph(true); loadGraphMock.mockResolvedValue(currentGraph);
    const asked = { ...pending(currentGraph), expires_at_iso: new Date(Date.now() - 10_000).toISOString() };
    readPendingsMock.mockResolvedValue([asked]);
    await send('Set it to about 0.9.'); expectNoGraphWrite();
  });

  it('graph-hash divergence cannot use the old asked cell or global fallback', async () => {
    const currentGraph = graph(true); loadGraphMock.mockResolvedValue(currentGraph);
    const asked = { ...pending(currentGraph), preconditions: { graph_hash: 'different-canonical-version' } };
    readPendingsMock.mockResolvedValue([asked]);
    await send('Set it to about 0.9.'); expectNoGraphWrite();
  });

  it('explicitly named OTHER edit remains the ordinary route rather than pending hijack', async () => {
    readPendingsMock.mockResolvedValue([pending()]);
    const message = "Set the Pass charges through option's effect on Customer price to 0.4.";
    await send(message);
    const args = dispatched();
    expect(args.payload.message).toBe(message);
    expect(args.recordedEffectAnswer).toBeUndefined();
  });

  it('caller graph canaries cannot replace the persisted asked identity', async () => {
    const asked = pending(); readPendingsMock.mockResolvedValue([asked]);
    const caller = graph();
    caller.nodes = caller.nodes.map((node) => ({ ...node, label: `CALLER ${node.label}` }));
    await send('Set it to about 0.9.', { graph_state: caller });
    const args = dispatched();
    expect(args.recordedEffectAnswer).toMatchObject({ pending: { id: asked.id }, pair: ASKED });
    expect(args.recordedEffectAnswer?.instruction).not.toContain('CALLER');
  });
});
