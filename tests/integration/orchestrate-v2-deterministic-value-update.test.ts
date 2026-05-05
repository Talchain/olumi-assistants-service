/**
 * V5 P0 golden-path repair (follow-up) — end-to-end HTTP boundary test
 * for the deterministic value-update path.
 *
 * Wave 6 of the original brief shipped an in-process acceptance suite.
 * Review feedback correctly noted that this didn't exercise the full
 * route → handler → commit → finalised response path. This test fills
 * that gap: a real Fastify route + B1 ingress validation + extension
 * parsing + turn executor + handler registry + response finaliser.
 *
 * The properties asserted are the brief's hard acceptance gates for
 * Wave 2:
 *
 *   1. UI sends `selected_elements` on the wire and CEE consumes it
 *      (Wave 0 confirmed plumbing; this test confirms the wire-to-
 *      handler path actually fires).
 *   2. "Update that factor to £30k" with one factor selected dispatches
 *      `set_factor_value` deterministically — no LLM call, no
 *      edit_graph dispatch.
 *   3. The wire response carries a `graph_patch` block with
 *      `operation: set_factor_value` and the correct target.
 *   4. The receipt copy uses the human label and user units (£30,000),
 *      not raw IDs or normalised model-unit fractions.
 *
 * This test does NOT exercise the freshness-after-mutation property
 * end-to-end (that requires a multi-turn replay; it is covered by
 * tools/v5-journey-replay/ which needs CEE_API_KEY). The single-turn
 * properties above are the ones that previously had no HTTP-boundary
 * coverage.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink } from '../../src/utils/telemetry.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// Throwing routing adapter — if the LLM is called, the test fails
// loudly. This is the strongest assertion that the deterministic
// pre-route fired.
const llmCallTracker = { count: 0 };

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test-throwing-adapter',
    chat: async () => {
      llmCallTracker.count += 1;
      throw new Error('LLM should not be called when deterministic pre-route matches');
    },
    chatWithTools: async () => {
      llmCallTracker.count += 1;
      throw new Error('LLM should not be called when deterministic pre-route matches');
    },
  }),
  getAdapterWithResolution: (task?: string) => ({
    adapter: {
      name: 'test-throwing-adapter',
      chat: async () => {
        llmCallTracker.count += 1;
        throw new Error('LLM should not be called when deterministic pre-route matches');
      },
      chatWithTools: async () => {
        llmCallTracker.count += 1;
        throw new Error('LLM should not be called when deterministic pre-route matches');
      },
    },
    resolution: {
      task: task ?? 'orchestrator',
      resolved_model: 'test-throwing-adapter',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// In-memory session store. The test mutates this between runs to
// simulate prior facts and verify subsequent freshness behaviour.
let mockedPriorFacts: unknown[] = [];
const appendCalls: unknown[] = [];

vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => mockedPriorFacts,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

let v5Enabled = true;
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestratorV5') return v5Enabled;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';

function buildGraphState() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit', successThreshold: 100 },
      // Two factors with overlapping label words. Deictic message has
      // no label evidence — selection is the ONLY way to disambiguate.
      {
        id: 'fac_advertising',
        kind: 'factor',
        label: 'Advertising budget',
        observed_state: {
          value: 0.2,
          raw_value: 20000,
          unit: '£',
          cap: 100000,
        },
      },
      {
        id: 'fac_headcount',
        kind: 'factor',
        label: 'Headcount',
        observed_state: { value: 0.5, raw_value: 50, unit: undefined },
      },
      { id: 'opt_a', kind: 'option', label: 'Plan A' },
      { id: 'opt_b', kind: 'option', label: 'Plan B' },
    ],
    edges: [
      {
        from: 'fac_advertising',
        to: 'goal_1',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
    ],
    options: [
      { id: 'opt_a', status: 'ready', interventions: { fac_advertising: { value: 30000 } } },
      { id: 'opt_b', status: 'ready', interventions: { fac_advertising: { value: 20000 } } },
    ],
    goal_node_id: 'goal_1',
  };
}

function buildRequest(message: string, selectedNodeIds: string[]) {
  return {
    kind: 'message' as const,
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide' as const,
    stage: 'analyse' as const,
    source: 'composer' as const,
    graph_state: buildGraphState(),
    selected_elements: { node_ids: selectedNodeIds, edge_ids: [] },
  };
}

describe('POST /orchestrate/v2/turn — deterministic value-update HTTP boundary', () => {
  let app: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    v5Enabled = true;
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });
  afterAll(async () => {
    setTestSink(null);
    await app.close();
  });
  beforeEach(() => {
    events = [];
    appendCalls.length = 0;
    mockedPriorFacts = [];
    llmCallTracker.count = 0;
    process.env = { ...originalEnv };
  });

  it('"Update that factor to £30,000" + one factor selected → 200 + set_factor_value graph_patch, no LLM call, no edit_graph', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Update that factor to £30,000', ['fac_advertising']),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);

    // Acceptance Gate 1: no LLM call. Strongest signal that the
    // deterministic pre-route fired.
    expect(llmCallTracker.count).toBe(0);

    // Acceptance Gate 2: dispatched set_factor_value, NOT edit_graph.
    const patchBlock = parsed.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toBeDefined();
    expect((patchBlock as { operation?: string }).operation).toBe('set_factor_value');
    expect((patchBlock as { target_id?: string }).target_id).toBe('fac_advertising');

    // No edit_graph block surfaces.
    const editGraphBlock = parsed.blocks.find(
      (b) => (b as { operation?: string }).operation === 'edit_graph',
    );
    expect(editGraphBlock).toBeUndefined();

    // Acceptance Gate 3: receipt uses human label and user units; no
    // raw IDs, no normalised fractions.
    expect(parsed.assistant_text).toContain('Advertising budget');
    expect(parsed.assistant_text).toMatch(/£30,000|£30000/);
    expect(parsed.assistant_text).not.toMatch(/\bfac_advertising\b/);
    // Receipts must show user units, not normalised model-unit fractions.
    // 0.3 is the model-unit equivalent of £30,000 / £100,000 — must NOT leak.
    expect(parsed.assistant_text).not.toMatch(/0\.\d+/);

    // Telemetry: deterministic pre-route emitted set_factor_value dispatch.
    const preRouteEvent = events.find(
      (e) => e.event === 'v5.deterministic_value_update',
    );
    expect(preRouteEvent?.data.matched).toBe(true);
    expect(preRouteEvent?.data.dispatch).toBe('set_factor_value');
  });

  it('"Update that factor to £30,000" + NO selection → clarify, no edit_graph, no LLM call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Update that factor to £30,000', []),
    });

    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);

    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);

    // No graph_patch — no mutation occurred.
    const patchBlock = parsed.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toBeUndefined();

    // Curated clarify copy. No internal terms.
    expect(parsed.assistant_text).toMatch(/factor/i);
    expect(parsed.assistant_text).not.toMatch(/\bedit_graph\b/);
    expect(parsed.assistant_text).not.toMatch(/\bnoop\b/);
    expect(parsed.assistant_text).not.toMatch(/\bfac_/);
  });

  it('"Update that factor to £30,000" + selected option (non-factor) → clarify, no mutation', async () => {
    // Option pre-filtering is in turn-executor: only factor-kind ids
    // are passed to the deterministic pre-route. A selected option
    // must NOT silently become the value-update target.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Update that factor to £30,000', ['opt_a']),
    });

    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);

    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);

    const patchBlock = parsed.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toBeUndefined();
  });
});
