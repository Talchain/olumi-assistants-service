/** RPC-boundary OLRV1 -> typed error -> real HTTP mapping, without a database. */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  loadGraph: vi.fn(),
  resolveUserIdentity: vi.fn(),
  chatWithTools: vi.fn(),
  dispatchEditGraph: vi.fn(),
}));
vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false },
    cee: { ...actual.config.cee, modelVersionsEnabled: true } } };
});
vi.mock('../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_target, key) => String(key) }),
}));
vi.mock('../index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index.js')>();
  const { createMockSessionStore } = await import('../../../../tests/utils/mock-session-store.js');
  return { ...actual, getSessionStore: () => createMockSessionStore({
    append: mocks.append,
    loadGraph: mocks.loadGraph,
    loadGraphAndBriefText: async () => ({ graph: await mocks.loadGraph(), briefText: null, revision: 7 }),
    ensureScenarioExists: async () => ({ user_id: null }),
    getScenarioOwner: async () => null,
    scenarioExists: async () => true,
    readCommittedTurn: async () => null,
  }) };
});
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../orchestrator/user-identity.js')>()),
  resolveUserIdentity: mocks.resolveUserIdentity,
}));
vi.mock('../../../adapters/llm/router.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../adapters/llm/router.js')>();
  const adapter = { name: 'revision-wire-test', chat: vi.fn(), chatWithTools: mocks.chatWithTools };
  return { ...actual, getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { resolved_model: adapter.name, resolution_source: 'task_default' } }) };
});
vi.mock('../../../adapters/llm/prompt-loader.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../adapters/llm/prompt-loader.js')>()),
  getSystemPrompt: async () => 'test system prompt',
}));
vi.mock('../../handlers/edit-graph-dispatch.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../handlers/edit-graph-dispatch.js')>()),
  dispatchEditGraph: mocks.dispatchEditGraph,
}));

import registerRoute from '../../../routes/assist.v1.scenario-graph-register.js';
import { GraphStaleWriteError, type SessionTurnWrite } from '../store.js';
import { SupabaseSessionStore, __setUseAppendV6ForTest } from '../supabase-store.js';
import { ceeOrchestratorRouteV2 } from '../../../orchestrator/route-v2.js';
import { getStatusCodeForErrorCode, toErrorV1 } from '../../../utils/errors.js';
import { promoteRevisionConflictResponse, readRevisionConflictDetails } from '../../graph-revision-conflict.js';
import { EMPTY_CONVERSATION_MEMORY } from '../../replacement/conversation-memory.js';
import { EMPTY_PROPOSAL_STORE, openProposal, authoriseProposal, beginApply } from '../../replacement/proposal-store.js';
import { ACCEPT_TOOL_NAME, runReplacementTurn } from '../../replacement/run-replacement-turn.js';

const SCENARIO = 'a6ccf5cf-aab0-4f01-b889-e0d6c072067c';
const OWNER = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b';
const GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Growth' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity', observed_state: { value: 0.5 } },
  ],
  edges: [{ from: 'fac_capacity', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9, effect_direction: 'positive' }],
};
const BASE = { ...GRAPH, nodes: GRAPH.nodes.map((node) => node.id === 'fac_capacity' ? { ...node, label: 'Before import' } : node) };
const rpc = vi.fn();
let app: FastifyInstance | undefined;

beforeEach(() => {
  __setUseAppendV6ForTest(true);
  vi.clearAllMocks();
  mocks.resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: OWNER });
  mocks.loadGraph.mockResolvedValue(BASE);
  mocks.chatWithTools.mockResolvedValue({ content: [{ type: 'text', text: 'A strategic question is ready to discuss.' }],
    usage: { input_tokens: 1, output_tokens: 1 }, model: 'revision-wire-test', latencyMs: 0, stop_reason: 'end_turn' });
});
afterEach(async () => {
  __setUseAppendV6ForTest(false);
  await app?.close();
  app = undefined;
});

async function register() {
  app = Fastify();
  await registerRoute(app);
  return await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph: GRAPH } });
}

describe('revision CAS wire refusal', () => {
  it.each(['accept', 'reconcile'])('lets a known revision refusal escape the replacement %s path to HTTP mapping', async (path) => {
    const now = '2026-10-08T12:00:00.000Z';
    let proposals = openProposal(EMPTY_PROPOSAL_STORE, { id: 'proposal-1', operations: [{ kind: 'set', summary: 'Set capacity' }],
      model_revision: 'rev-1', proposed_at: now, proposed_in_turn: 'prior-turn' });
    if (path === 'reconcile') {
      proposals = authoriseProposal(proposals, 'proposal-1', { authorised_in_turn: 'consent-turn', authorised_at: now, current_model_revision: 'rev-1' });
      proposals = beginApply(proposals, 'proposal-1', { idempotency_key: 'write-1', apply_started_at: now, current_model_revision: 'rev-1' });
    }
    const error = new GraphStaleWriteError('stale revision', { conflict_category: 'revision_conflict',
      cause: { details: JSON.stringify({ reason: 'revision_conflict', expected: 7, current: 8 }) } });
    const applyOperations = vi.fn(async () => { throw error; });
    await expect(runReplacementTurn({ message: 'Yes, go ahead', history: [], memory: EMPTY_CONVERSATION_MEMORY,
      proposals, modelRevision: 'rev-1', workspaceSummary: 'Capacity model', tools: [], turnId: 'accept-turn', now,
      idFor: (purpose, index) => `${purpose}-${index}`,
    }, { checkpoint: async () => undefined, applyOperations,
      chatWithTools: async () => ({ content: [{ type: 'tool_use', id: 'accept-1', name: ACCEPT_TOOL_NAME,
        input: { proposal_id: 'proposal-1', user_agreement_quote: 'Yes, go ahead' } }], stop_reason: 'tool_use' }),
    })).rejects.toBe(error);
    expect(applyOperations).toHaveBeenCalledTimes(1);
  });

  it('maps the edit-graph pipeline revision refusal at its existing HTTP catch', async () => {
    mocks.dispatchEditGraph.mockRejectedValue(new GraphStaleWriteError('stale revision', { conflict_category: 'revision_conflict',
      cause: { details: JSON.stringify({ reason: 'revision_conflict', expected: 7, current: 8 }) } }));
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: {
      kind: 'message', turn_id: 'b2222222-2222-4222-8222-222222222222', scenario_id: SCENARIO,
      message: 'Add a risk for supplier delays affecting the launch', turn_class: 'decide', stage: 'analyse',
      source: 'composer', graph_state: GRAPH,
    } });
    expect(mocks.dispatchEditGraph).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'revision_conflict', expected: 7, current: 8,
      details: { conflict_category: 'revision_conflict', expected: 7, current: 8 } });
  });

  it('preserves an internal HTTP revision refusal before Agent consumers turn it into a normal tool result', () => {
    const response = { status: 409, json: { code: 'revision_conflict', details: { expected: 7, current: 8 } } };
    let caught: unknown;
    try { promoteRevisionConflictResponse(response); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(GraphStaleWriteError);
    expect(readRevisionConflictDetails(caught as GraphStaleWriteError)).toEqual({ expected: 7, current: 8 });
    const hashConflict = { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
    expect(promoteRevisionConflictResponse(hashConflict)).toBe(hashConflict);
  });

  it('maps the real executor failure envelope to HTTP 409 with the DETAIL revisions', async () => {
    mocks.append.mockRejectedValue(new GraphStaleWriteError('stale revision', { conflict_category: 'revision_conflict',
      cause: { code: 'OLRV1', details: JSON.stringify({ reason: 'revision_conflict', expected: 7, current: 8 }) } }));
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: {
      kind: 'message', turn_id: 'b1111111-1111-4111-8111-111111111111', scenario_id: SCENARIO,
      message: 'Consider the strategic framing.', turn_class: 'frame', stage: 'analyse', source: 'composer',
    } });
    expect(mocks.append).toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'revision_conflict', expected: 7, current: 8,
      details: { conflict_category: 'revision_conflict', expected: 7, current: 8 } });
  });

  it('maps errors escaping the Agent and replacement paths through the existing central HTTP mapper', async () => {
    app = Fastify();
    app.setErrorHandler((err, req, reply) => {
      const body = toErrorV1(err, req);
      return reply.code(getStatusCodeForErrorCode(body.code)).send(body);
    });
    app.post('/revision-write', async () => {
      throw new GraphStaleWriteError('stale revision', { conflict_category: 'revision_conflict',
        cause: { code: 'OLRV1', details: JSON.stringify({ reason: 'revision_conflict', expected: 0, current: 1 }) } });
    });
    const res = await app.inject({ method: 'POST', url: '/revision-write' });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('The scenario changed while I was saving, so nothing was saved. Try again.');
    expect(res.json()).toMatchObject({ code: 'revision_conflict', expected: 0, current: 1,
      details: { code: 'revision_conflict', expected: 0, current: 1 } });
  });

  it('maps the OLRV1 DETAIL through GraphStaleWriteError to HTTP 409 revision_conflict', async () => {
    // Initial registration is versioned; the label-only contrast above is presentation-only.
    mocks.loadGraph.mockResolvedValue(null);
    const rpcError = { code: 'OLRV1', message: 'revision_conflict', details: JSON.stringify({ reason: 'revision_conflict', expected: 7, current: 8 }) };
    rpc.mockResolvedValue({ data: null, error: rpcError });
    const store = new SupabaseSessionStore({ rpc } as never, { invalidateAll: vi.fn() } as never, {
      defaultReadLimit: 20, graphCasRpc: 'enforce',
    } as never);
    let caught: unknown;
    mocks.append.mockImplementation(async (write: SessionTurnWrite) => {
      try {
        return await store.append(write);
      } catch (err) {
        caught = err;
        throw err;
      }
    });
    const res = await register();
    expect(mocks.append.mock.calls[0]?.[0]).toHaveProperty('modelVersion');
    expect(rpc.mock.calls[0]?.[0]).toBe('append_turn_atomic_v6');
    expect(caught).toBeInstanceOf(GraphStaleWriteError);
    expect(caught).toMatchObject({ conflict_category: 'revision_conflict', cause: rpcError });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('append_turn_atomic_v6', expect.objectContaining({ p_expected_revision: 7 }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'revision_conflict', expected: 7, current: 8, details: { code: 'revision_conflict', expected: 7, current: 8 } });
  });

  it('keeps an existing graph-hash refusal unchanged', async () => {
    mocks.append.mockRejectedValue(new GraphStaleWriteError('stale graph', { conflict_category: 'rpc_cas_conflict' }));
    const res = await register();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'BAD_INPUT', details: { code: 'GRAPH_STALE' } });
    expect(res.json()).not.toHaveProperty('expected');
    expect(res.json()).not.toHaveProperty('current');
  });

  it.each(['not json', JSON.stringify({ expected: -1, current: '8' })])('keeps a typed 409 but does not invent revisions for invalid DETAIL %s', async (details) => {
    mocks.append.mockRejectedValue(new GraphStaleWriteError('stale revision', { conflict_category: 'revision_conflict', cause: { code: 'OLRV1', details } }));
    const res = await register();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('revision_conflict');
    expect(res.json()).not.toHaveProperty('expected');
    expect(res.json()).not.toHaveProperty('current');
  });
});
