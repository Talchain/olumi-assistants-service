/**
 * Structural-restructure routing — the propose side of the four-turn-nothing
 * fix (LATENCY-RECAPTURE finding 3; probe 69a2f44f, build e7f312d).
 *
 * THE DEFECT (base): a free-text restructure request carries no
 * EDIT_GRAPH_POSITIVE_REGEX verb — "split the shared factor into per-option
 * links" contains none of change/update/edit/…/lower — so `editIntentDetected`
 * is false and the message falls through to the coach (turn_executor), which
 * DESCRIBES the change without seeding any apply action. A following
 * "Yes, apply it now" then has no held proposal to resume.
 *
 * THE FIX: `detectStructuralRestructureIntent` joins `editIntentDetected` as a
 * third edit-lane candidate (the `configureOptionIntent` precedent), so the
 * restructure request reaches `dispatchEditGraph` — the sole structural-
 * proposal producer (add_node/add_edge → STRUCTURAL_APPLY_HELD held proposal +
 * confirm chip). The bare consent then resumes through the already-wired
 * short-confirm → executeGmHeldResume path (proven by
 * route-v2-held-proposal-confirm.test.ts — the confirm side of the journey).
 *
 * This suite pins the PROPOSE side: a restructure request must REACH the edit
 * lane, and a plain conversational message must NOT. Mutation-check: revert the
 * `structuralRestructureIntent` addition to `editIntentDetected` → the two
 * restructure cases stop calling `dispatchEditGraph` (they reach the coach) —
 * RED, proving the routing (not a pre-existing path) carries the turn.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { GraphV3 } from '../../schemas/cee-v3.js';
import type { ChatWithToolsResult } from '../../adapters/llm/types.js';
import { _resetConfigCache } from '../../config/index.js';

const SCENARIO_ID = '88888888-8888-4888-8888-888888888888';

// Spy on the edit lane. A resolved `commitPerformed` result is enough — this
// suite asserts REACHABILITY (was the edit lane called?), not the lane's own
// held-proposal internals (covered by the edit-graph-dispatch suites).
const dispatchEditGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

// The coach path: a text-only routing result → interpreted as converse. Only
// the negative-control turn should reach it; the restructure turns must not.
const chatWithToolsMock = vi.fn(async (): Promise<ChatWithToolsResult> => ({
  content: [{ type: 'text', text: 'Here is a reflection on the shared factor.' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 20 },
  model: 'test-model',
  latencyMs: 10,
}));
vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: {
      task: 'orchestrator',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => SHARED_FACTOR_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: SHARED_FACTOR_GRAPH, briefText: null }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

/**
 * A model with a SHARED factor ('Cost') linked to the goal, and two options —
 * the exact shape a "split the shared factor into per-option links" request
 * addresses. Passes GraphV3 + the ingress parse.
 */
const SHARED_FACTOR_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Build in-house' },
    { id: 'opt-b', kind: 'option', label: 'Outsource' },
    { id: 'goal-g', kind: 'goal', label: 'Ship the platform' },
    {
      id: 'fac-cost',
      kind: 'factor',
      label: 'Cost',
      observed_state: { value: 0.3, raw_value: 30, cap: 100 },
    },
  ],
  edges: [
    {
      from: 'fac-cost',
      to: 'goal-g',
      strength: { mean: -0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  ],
};
{
  const parsed = GraphV3.safeParse(SHARED_FACTOR_GRAPH);
  if (!parsed.success) {
    throw new Error('Fixture failed GraphV3.safeParse: ' + JSON.stringify(parsed.error.issues));
  }
}

function payload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '99999999-9999-4999-8999-999999999999',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message: 'placeholder',
    turn_class: 'decide',
    source: 'composer',
    graph_state: SHARED_FACTOR_GRAPH,
    ...overrides,
  };
}

describe('POST /orchestrate/v2/turn — free-text structural restructure routes to the edit lane', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('ENABLE_V5_ORCHESTRATOR', 'true');
    vi.stubEnv('CEE_PIPELINE_V4_ENABLED', 'false');
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
    dispatchEditGraphMock.mockReset();
    dispatchEditGraphMock.mockResolvedValue({
      response: {
        response_version: 2 as const,
        assistant_text: "I'll split 'Cost' into a per-option link for each option. Confirm to apply.",
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'analyse' as const,
      },
      commitPerformed: true,
    });
    chatWithToolsMock.mockClear();
    appendMock.mockClear();
  });

  it('the probe message "split the shared factor into per-option links" reaches dispatchEditGraph (per_option_term)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'split the shared factor into per-option links' }),
    });
    expect(res.statusCode).toBe(200);
    // Routed to the structural-proposal producer, NOT the coach.
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('the "each option its own X" framing reaches dispatchEditGraph (each_option_own)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'give each option its own cost factor' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(chatWithToolsMock).not.toHaveBeenCalled();
  });

  it('a plain conversational message does NOT reach the edit lane (reaches the coach)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'tell me about the shared factor across my options' }),
    });
    expect(res.statusCode).toBe(200);
    // The negative control: no restructure phrasing → the coach owns it, the
    // edit lane is never touched. This is what the two positives discriminate
    // against — the fix routes ONLY restructure requests to the edit lane.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).toHaveBeenCalled();
  });
});
