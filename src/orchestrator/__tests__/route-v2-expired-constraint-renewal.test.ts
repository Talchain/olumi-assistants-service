/**
 * An expired limit offer may be renewed, but the expired confirmation cannot
 * apply it. The next confirmation must use the newly committed offer and the
 * real add_constraint handler, leaving the target's current observation alone.
 *
 * HTTP harness follows route-v2-held-proposal-confirm.test.ts. The route,
 * executor, registry, proposal producers and constraint handler are real.
 * Only persistence and external model/prompt boundaries are mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { buildWarrantDemotion } from '../../orchestrator-v5/compose/warrant-demotion.js';
import { emitProposedChange } from '../../orchestrator-v5/compose/proposed-change.js';
import { getDefaultRegistry } from '../../orchestrator-v5/tools/registry.js';
import { isPendingActionExpired, type PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import type { SessionTurnWrite } from '../../orchestrator-v5/session/store.js';
import type { ProposalAction } from '../../orchestrator-v5/routing/types.js';

let storedGraph: GraphV3T;
let storedPendings: readonly PendingAction[] = [];
let committedWrites: SessionTurnWrite[] = [];
let failNextAppend = false;

const appendMock = vi.fn(async (write: SessionTurnWrite) => {
  if (failNextAppend) {
    failNextAppend = false;
    throw new Error('Test store rejected the atomic save');
  }
  // Copy only after the whole mocked transaction succeeds. A rejected append
  // cannot publish either the renewed pending or the changed graph.
  const committed = structuredClone(write);
  committedWrites.push(committed);
  if (committed.graph !== undefined) storedGraph = structuredClone(committed.graph) as GraphV3T;
  if (committed.pending_actions !== undefined) storedPendings = structuredClone(committed.pending_actions);
  return { id: `stored-turn-${committedWrites.length}` };
});

vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
    invalidateScoped: async (_scenario: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_scenario: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => structuredClone(storedGraph),
    loadGraphAndBriefText: async () => ({ graph: structuredClone(storedGraph), briefText: null }),
    readMostRecentPendingActions: async () => structuredClone(storedPendings),
    hasPriorTurns: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const modelCallMock = vi.fn(async () => {
  throw new Error('Expired constraint renewal and confirmation must not call a model');
});
vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: modelCallMock, chatWithTools: modelCallMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: modelCallMock, chatWithTools: modelCallMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));
vi.mock('../../config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop !== 'features') return Reflect.get(target, prop);
        return new Proxy(Reflect.get(target, prop) as object, {
          get(features, feature) {
            return feature === 'pipelineV4Enabled' ? false : Reflect.get(features, feature);
          },
        });
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../route-v2.js');
const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
const FUNDING_ID = 'funding-amount';
const FUNDING_LABEL = 'Funding Amount Secured';
const FIRST_TURN_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_TURN_ID = '44444444-4444-4444-8444-444444444444';
// olumi-debug-8121ccc7-20260919.json, turn b4cc5aa4-df2e-47f0-b7ec-76ef3e718245.
const CAPTURED_RESTATED_OFFER = 'Nothing has been changed. I want to confirm this with you before I edit the model, and a limit keeping "Funding Amount Secured" at or above £1,300,000 looks like it would help. Say the word and I will make it. - Make this update.';

function initialGraph(): GraphV3T {
  return GraphV3.parse({
    nodes: [
      { id: 'funds-option', kind: 'option', label: 'Raise from funds' },
      { id: 'funding-goal', kind: 'goal', label: 'Fund the next stage' },
      {
        id: FUNDING_ID, kind: 'factor', label: FUNDING_LABEL,
        observed_state: { value: 0, unit: '£', source: 'user' },
      },
    ],
    edges: [{
      from: FUNDING_ID, to: 'funding-goal',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9, effect_direction: 'positive',
    }],
    goal_constraints: [],
  });
}

function graphHash(graph: GraphV3T): string {
  const hash = computeAnalysisAffectingGraphHash(
    graph as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (hash === null) throw new Error('Strict fixture must have an analysis-affecting graph hash');
  return hash;
}

function expiredOffer(value = 1_300_000): PendingAction {
  const action: ProposalAction = {
    handler_id: 'add_constraint',
    entity: { id: FUNDING_ID, kind: 'node', label: FUNDING_LABEL,
      resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [
      { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
      { name: 'value', value, source: 'user_explicit' },
      { name: 'unit', value: '£', source: 'user_explicit' },
    ],
    cited_context_fields: ['graph.nodes'],
  };
  const demotion = buildWarrantDemotion(action, [], `${FUNDING_LABEL} must be at least £${value}.`);
  if (!demotion.ok) throw new Error('The real offer producer refused the complete fixture');
  expect(demotion.proposal.constraint_value_frame).toBe('level');
  const emitted = emitProposedChange(demotion.proposal, {
    scenario_id: SCENARIO_ID,
    graph_hash: graphHash(storedGraph),
    emitted_at_iso: '2020-01-01T00:00:00.000Z',
    registry: getDefaultRegistry(),
  });
  if (emitted.status !== 'success') throw new Error('The real proposal emitter refused the fixture');
  expect(isPendingActionExpired(emitted.pending, Date.now())).toBe(true);
  return emitted.pending;
}

function payload(message: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'message', turn_id: FIRST_TURN_ID, scenario_id: SCENARIO_ID,
    stage: 'analyse', turn_class: 'decide', source: 'composer', message,
    graph_state: structuredClone(storedGraph), ...overrides,
  };
}

type ResponseBody = {
  assistant_text: string;
  suggested_actions: Array<{ id: string; label: string; message: string; detail?: string; action_type?: string }>;
  [key: string]: unknown;
};

function liveLimitOffers(pendings: readonly PendingAction[]): PendingAction[] {
  return pendings.filter((pending) => pending.action.kind === 'apply_proposed_change'
    && pending.action.inline_patch.handler_id === 'add_constraint'
    && !isPendingActionExpired(pending, Date.now()));
}

function expectNoGraphMutation(expectedGraph: GraphV3T = initialGraph()): void {
  expect(committedWrites.filter((write) => write.graph !== undefined)).toEqual([]);
  expect(storedGraph).toEqual(expectedGraph);
  expect(committedWrites.flatMap((write) => write.handler_facts)).toEqual([]);
  expect(modelCallMock).not.toHaveBeenCalled();
}

function expectCommitFailure(body: ResponseBody): void {
  expect(body).toMatchObject({
    error: 'INTERNAL_ERROR', boundary: 'B1', direction: 'egress', validator: 'turn_commit',
    details: { reason: 'state_commit_failed_or_turn_runtime_failure', failure_type: 'INTERNAL_ERROR', stage: 'analyse' },
    request_id: expect.any(String),
  });
  expect(body).not.toHaveProperty('assistant_text');
  expect(body).not.toHaveProperty('suggested_actions');
  expect(body).not.toHaveProperty('blocks');
  expect(body).not.toHaveProperty('draft_graph');
}

function expectSavedFundingFloor(body: ResponseBody): void {
  expect(modelCallMock).not.toHaveBeenCalled();
  const graphWrites = committedWrites.filter((write) => write.graph !== undefined);
  expect(graphWrites).toHaveLength(1);
  expect(graphWrites[0]!.handler_facts).toEqual([expect.objectContaining({ fact_type: 'add_constraint' })]);
  const rows = storedGraph.goal_constraints?.filter((row) => row.node_id === FUNDING_ID && row.operator === '>=');
  expect(rows).toHaveLength(1);
  expect(rows![0]).toMatchObject({ node_id: FUNDING_ID, operator: '>=', value: 1_300_000, unit: '£', value_frame: 'level' });
  expect(storedGraph.goal_constraints).toHaveLength(1);
  expect(storedGraph.nodes.find((node) => node.id === FUNDING_ID)?.observed_state)
    .toEqual(initialGraph().nodes.find((node) => node.id === FUNDING_ID)?.observed_state);
  expect(liveLimitOffers(storedPendings)).toEqual([]);
  expect(body.assistant_text).toContain(FUNDING_LABEL);
  expect(body.assistant_text).toMatch(/(?:added|updated|saved|applied)\s+(?:the\s+)?(?:constraint|limit)/i);
}

describe('POST /orchestrate/v2/turn — renew expired limit, then confirm the fresh offer', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });
  beforeEach(() => {
    storedGraph = initialGraph();
    storedPendings = [];
    committedWrites = [];
    failNextAppend = false;
    appendMock.mockClear();
    modelCallMock.mockClear();
    storedPendings = [expiredOffer()];
  });

  async function post(message: string, overrides: Record<string, unknown> = {}, expectedStatus = 200) {
    const response = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payload(message, overrides) });
    expect(response.statusCode).toBe(expectedStatus);
    return JSON.parse(response.body) as ResponseBody;
  }

  async function renew(overrides: Record<string, unknown> = {}) {
    const previous = storedPendings[0]!;
    const body = await post('Make that update.', overrides);
    expectNoGraphMutation();
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(committedWrites).toHaveLength(1);
    const offers = liveLimitOffers(storedPendings);
    expect(offers).toHaveLength(1);
    const renewed = offers[0]!;
    expect(renewed.id).not.toBe(previous.id);
    expect(renewed.emitted_at_iso).not.toBe(previous.emitted_at_iso);
    expect(renewed.preconditions.graph_hash).toBe(graphHash(storedGraph));
    expect(renewed.action).toMatchObject({ kind: 'apply_proposed_change', inline_patch: {
      handler_id: 'add_constraint', target_entity_ids: [FUNDING_ID],
      params: { constraint_type: 'at_least', value: 1_300_000, unit: '£' },
      constraint_value_frame: 'level',
    } });
    expect(liveLimitOffers(committedWrites[0]!.pending_actions ?? [])).toEqual([renewed]);
    const chips = body.suggested_actions.filter((chip) => chip.id === renewed.chip_id);
    expect(chips).toHaveLength(1);
    const chip = chips[0]!;
    if (renewed.action.kind !== 'apply_proposed_change') throw new Error('Expected a renewed proposal');
    expect(chip.label).toBe(renewed.action.public_label);
    expect(chip.message).toBe(renewed.action.public_message);
    const offerCopy = [body.assistant_text, chip.label, chip.message, chip.detail ?? ''].join(' ');
    expect(offerCopy).toContain(FUNDING_LABEL);
    expect(offerCopy).toMatch(/£(?:1,?300,?000|1\.3\s*m(?:illion)?)/i);
    expect(offerCopy).toMatch(/at least|at or above|minimum|floor/i);
    expect(body.assistant_text).not.toMatch(/(?:added|updated|saved|applied)\s+(?:the\s+)?(?:constraint|limit)/i);
    return { body, renewed, chip };
  }

  it('renews atomically without applying, then the emitted chip saves a level floor without changing the observation', async () => {
    const { chip } = await renew();
    const body = await post(chip.message, {
      turn_id: SECOND_TURN_ID, source: 'chip_click',
      chip: { id: chip.id, action_type: chip.action_type },
    });
    expect(appendMock).toHaveBeenCalledTimes(2);
    expectSavedFundingFloor(body);
  });

  it('the expired offer’s own stored chip message renews the same tuple without applying it', async () => {
    const original = storedPendings[0]!;
    if (original.action.kind !== 'apply_proposed_change' || original.action.__legacy_no_public_copy === true) {
      throw new Error('Expected an emitted proposal with public replay copy');
    }
    const body = await post(original.action.public_message, {
      source: 'chip_click', chip: { id: original.chip_id, action_type: 'add_constraint' },
    });
    expectNoGraphMutation();
    expect(appendMock).toHaveBeenCalledTimes(1);
    const renewed = liveLimitOffers(storedPendings);
    expect(renewed).toHaveLength(1);
    expect(renewed[0]!.action).toMatchObject({ inline_patch: original.action.inline_patch });
    expect(body.suggested_actions.some((chip) => chip.id === renewed[0]!.chip_id)).toBe(true);
  });

  it.each(['missing funding node', 'renamed funding node'] as const)(
    'a stale ingress echo with %s cannot replace the canonical renewal target', async (control) => {
      const staleEcho = initialGraph();
      const staleLabel = 'Outdated funding label from the request';
      if (control === 'missing funding node') {
        staleEcho.nodes = staleEcho.nodes.filter((node) => node.id !== FUNDING_ID);
        staleEcho.edges = staleEcho.edges.filter((edge) => edge.from !== FUNDING_ID && edge.to !== FUNDING_ID);
        expect(graphHash(staleEcho)).not.toBe(graphHash(storedGraph));
      } else {
        staleEcho.nodes = staleEcho.nodes.map((node) => node.id === FUNDING_ID ? { ...node, label: staleLabel } : node);
      }
      const canonicalBefore = structuredClone(storedGraph);
      const { body, chip, renewed } = await renew({ graph_state: staleEcho });
      expect(storedGraph).toEqual(canonicalBefore);
      expect(renewed.preconditions.graph_hash).toBe(graphHash(canonicalBefore));
      const copy = [body.assistant_text, chip.label, chip.message, chip.detail ?? ''].join(' ');
      expect(copy).toContain(FUNDING_LABEL);
      expect(copy).not.toContain(staleLabel);

      const confirmed = await post(chip.message, {
        turn_id: SECOND_TURN_ID, source: 'chip_click',
        chip: { id: chip.id, action_type: chip.action_type }, graph_state: staleEcho,
      });
      expect(appendMock).toHaveBeenCalledTimes(2);
      expectSavedFundingFloor(confirmed);
      expect(storedGraph.nodes.find((node) => node.id === FUNDING_ID))
        .toEqual(canonicalBefore.nodes.find((node) => node.id === FUNDING_ID));
      expect(storedGraph.edges).toEqual(canonicalBefore.edges);
    },
  );

  it.each([
    { name: 'factor-value action', actionType: 'set_factor_value', wrongId: false },
    { name: 'explanation action', actionType: 'explain_results', wrongId: false },
    { name: 'constraint action with another chip identity', actionType: 'add_constraint', wrongId: true },
  ])('$name cannot renew an expired constraint by replaying its message', async ({ actionType, wrongId }) => {
    const original = storedPendings[0]!;
    if (original.action.kind !== 'apply_proposed_change' || original.action.__legacy_no_public_copy === true) {
      throw new Error('Expected an emitted proposal with public replay copy');
    }
    const before = structuredClone(storedGraph);
    const response = await app.inject({
      method: 'POST', url: '/orchestrate/v2/turn',
      payload: payload(original.action.public_message, {
        source: 'chip_click',
        chip: { id: wrongId ? 'prop_unrelated_offer' : original.chip_id, action_type: actionType },
      }),
    });
    const body = JSON.parse(response.body) as ResponseBody;
    // A forced non-constraint path may reach the fail-on-call adapter. That
    // existing error remains an error; it is not a successful renewal.
    if (modelCallMock.mock.calls.length > 0) {
      expect(response.statusCode).toBe(500);
      expect(body.error).toBe('INTERNAL_ERROR');
      expect(body).not.toHaveProperty('assistant_text');
    } else {
      expect(response.statusCode).toBe(200);
    }
    expect(committedWrites.filter((write) => write.graph !== undefined)).toEqual([]);
    expect(storedGraph).toEqual(before);
    expect(liveLimitOffers(storedPendings)).toEqual([]);
    expect(committedWrites.flatMap((write) => liveLimitOffers(write.pending_actions ?? []))).toEqual([]);
    expect(committedWrites.flatMap((write) => write.handler_facts)
      .filter((fact) => fact.fact_type === 'add_constraint')).toEqual([]);
    expect((body.suggested_actions ?? []).filter((chip) => chip.action_type === 'add_constraint')).toEqual([]);
  });

  it.each(['missing target', 'wrong target kind', 'stale graph', 'multiple expired offers'] as const)(
    '%s cannot renew or apply an expired limit', async (control) => {
      const original = storedPendings[0]!;
      if (original.action.kind !== 'apply_proposed_change') throw new Error('Expected proposal fixture');
      if (control === 'missing target' || control === 'wrong target kind') {
        const target = control === 'missing target' ? 'missing-node' : 'funds-option';
        storedPendings = [{ ...original, action: { ...original.action,
          inline_patch: { ...original.action.inline_patch, target_entity_ids: [target] },
        }, preconditions: { ...original.preconditions, target_entity_ids: [target] } }];
      } else if (control === 'stale graph') {
        storedPendings = [{ ...original, preconditions: { ...original.preconditions, graph_hash: 'different-saved-graph' } }];
      } else {
        storedPendings = [original, expiredOffer(1_400_000)];
      }
      const body = await post('Make that update.');
      expectNoGraphMutation();
      expect(liveLimitOffers(storedPendings)).toEqual([]);
      expect(committedWrites.flatMap((write) => liveLimitOffers(write.pending_actions ?? []))).toEqual([]);
      expect(body.suggested_actions.filter((chip) => chip.action_type === 'add_constraint')).toEqual([]);
    },
  );

  it('a rejected renewal save publishes neither a new confirm chip nor a renewed pending', async () => {
    const original = structuredClone(storedPendings);
    failNextAppend = true;
    const body = await post('Make that update.', {}, 500);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(committedWrites).toEqual([]);
    expect(storedPendings).toEqual(original);
    expectNoGraphMutation();
    expectCommitFailure(body);
  });

  it('a rejected fresh-confirm save leaves the observation and constraints unchanged and emits no success receipt', async () => {
    const { chip } = await renew();
    const renewedBeforeFailure = structuredClone(storedPendings);
    failNextAppend = true;
    const body = await post(chip.message, {
      turn_id: SECOND_TURN_ID, source: 'chip_click',
      chip: { id: chip.id, action_type: chip.action_type },
    }, 500);
    expect(appendMock).toHaveBeenCalledTimes(2);
    expect(committedWrites).toHaveLength(1);
    expectNoGraphMutation();
    expect(storedPendings).toEqual(renewedBeforeFailure);
    expectCommitFailure(body);
  });

  it.each([
    ['the captured copied offer with an explicit fresh instruction', CAPTURED_RESTATED_OFFER],
    ['an ordinary keep-above instruction', 'Keep Funding Amount Secured above £1.3m.'],
    ['an ordinary minimum instruction', 'Set minimum Funding Amount Secured to £1.3m.'],
  ])('%s saves a constraint without a pending offer or an observation change', async (_name, message) => {
    storedPendings = [];
    const body = await post(message!);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expectSavedFundingFloor(body);
  });

  it.each(['duplicate target label', 'incompatible currency', 'unknown subject'] as const)(
    'a fresh limit with %s cannot become a graph mutation', async (control) => {
      storedPendings = [];
      let message = 'Keep Funding Amount Secured above £1.3m.';
      if (control === 'duplicate target label') {
        storedGraph.nodes.push({
          id: 'funding-amount-second', kind: 'factor', label: FUNDING_LABEL,
          observed_state: { value: 0, unit: '£', source: 'user' },
        });
      } else if (control === 'incompatible currency') {
        message = 'Keep Funding Amount Secured above $1.3m.';
      } else {
        message = 'Keep Competitor Funding Amount Secured above £1.3m.';
      }
      const before = structuredClone(storedGraph);
      const body = await post(message);
      expectNoGraphMutation(before);
      expect(storedGraph.goal_constraints).toEqual([]);
      expect(body.assistant_text).not.toMatch(/(?:added|updated|saved|applied)\s+(?:the\s+)?(?:constraint|limit)/i);
    },
  );
});
