/**
 * Wave 6 — local journey replay smoke cordon for the named brief
 * failures that ARE proveable at the HTTP boundary in this file.
 *
 * Coverage in this file:
 *   - Failure 1 — chip-click on `what_would_flip` with fresh analysis
 *     dispatches the handler; explanation prose composed; no LLM call.
 *   - Failure 3 (UNAMBIGUOUS happy path only) — single-turn
 *     `Update that factor to £30,000` with selection dispatches
 *     `set_factor_value`; no LLM call; no edit_graph leak. The
 *     CLARIFICATION-LOOP variant of Failure 3 (the actual brief
 *     evidence #3) is NOT in this file — it lives in
 *     `orchestrate-v2-clarify-reply-two-turn.test.ts` ("Turn 1 emits
 *     clarify chips… Turn 2 typed factor label dispatches…").
 *   - Failure 4 — `what_would_flip` deterministic explanation prose
 *     contains no raw decimals and no forbidden internal terms on
 *     the wire.
 *
 * EXPLICITLY NOT IN THIS FILE:
 *   - Failure 2 (at-limit add-risk preflight) — exercised at the
 *     handler-dispatch layer in
 *     `edit-graph-dispatch-preflight.test.ts`. Reaching the same
 *     path through HTTP would require constructing a 30-edge graph
 *     fixture; the Wave 6 acceptance report labels Failure 2 as
 *     handler-layer-proven only, NOT wire-proven.
 *   - Failure 3 clarification loop — see the dedicated
 *     `orchestrate-v2-clarify-reply-two-turn.test.ts` file.
 *   - Generated-forbidden-answer downgrade — handler-layer only.
 *   - Deferred A4 add-risk continuity (Wave 5G) and deterministic
 *     apply_proposed_change wiring.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { parseDeliveredOlumiResponse } from '../helpers/parse-delivered-response.js';
import type { PendingAction } from '../../src/orchestrator-v5/session/pending-action.js';

// Throwing routing adapter — any LLM call fails the journey loudly.
// The four named failures all dispatch deterministically; a Sonnet
// call here means a deterministic path silently skipped.
const llmCallTracker = { count: 0 };

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test-throwing-adapter',
    chat: async () => {
      llmCallTracker.count += 1;
      throw new Error('Wave 6: deterministic path skipped — LLM should not be called');
    },
    chatWithTools: async () => {
      llmCallTracker.count += 1;
      throw new Error('Wave 6: deterministic path skipped — LLM should not be called');
    },
  }),
  getAdapterWithResolution: (task?: string) => ({
    adapter: {
      name: 'test-throwing-adapter',
      chat: async () => {
        llmCallTracker.count += 1;
        throw new Error('Wave 6: deterministic path skipped — LLM should not be called');
      },
      chatWithTools: async () => {
        llmCallTracker.count += 1;
        throw new Error('Wave 6: deterministic path skipped — LLM should not be called');
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

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// In-memory session state. Tests mutate the let-bindings to seed
// per-failure fixtures.
const appendCalls: Array<unknown> = [];
let mockedPriorRunAnalysisGraphHash: string | null = null;
let mockedMostRecentPendingActions: ReadonlyArray<PendingAction> = [];

// ROADMAP 1.148 C7 — the anti-false-fresh doctrine (PR #306/#298) derives
// the CURRENT graph hash for chip-click freshness ONLY from the server-side
// PERSISTED graph, never from the wire `graph_state`. Tests that want
// freshness='fresh' must mock a persisted graph matching the prior fact.
let mockedPersistedGraph: unknown = null;

// ROADMAP 1.148 — importOriginal-spread + complete shared store mock
// (derive, don't mirror): interface growth can't silently break this suite.
vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore, makeSessionTurnRow } = await import(
    '../utils/mock-session-store.js'
  );
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: async (write) => {
          appendCalls.push(write);
          // Mirror production: latest write determines what the next turn
          // reads as "most recent pending actions".
          const pending = (write as { pending_actions?: ReadonlyArray<PendingAction> })
            .pending_actions;
          mockedMostRecentPendingActions = pending ?? [];
          return {
            id: `row-${appendCalls.length}`,
            ...(write.graph != null
              ? { graph_write_disposition: 'accepted_insert' as const }
              : {}),
          };
        },
        readRecent: async () => [
          makeSessionTurnRow({
            id: '66666666-6666-4666-8666-666666666666',
            scenario_id: SCENARIO_ID,
            turn_id: 'prior-turn-id',
            turn_class: 'handler',
            handler_id: 'run_analysis',
          }),
        ],
        readFactsFor: async () =>
          [
            {
              fact_type: 'run_analysis' as const,
              fact_version: 1,
              noop: false,
              result: {
                scenario_id: SCENARIO_ID,
                leading_option_id: 'opt-a',
                summary: 'Prior analysis summary.',
                win_probabilities: { 'opt-a': 0.62, 'opt-b': 0.38 },
                ...(mockedPriorRunAnalysisGraphHash != null
                  ? { graph_hash_at_run: mockedPriorRunAnalysisGraphHash }
                  : {}),
                computed_at: '2026-05-04T00:00:00.000Z',
                enrichment: { analysis_status: 'success' },
              },
            },
          ] as never,
        loadGraph: async () => mockedPersistedGraph,
        loadGraphAndBriefText: async () => ({
          graph: mockedPersistedGraph,
          briefText: null,
        }),
        ensureScenarioExists: async () => ({ user_id: null }),
        readMostRecentPendingActions: async () => mockedMostRecentPendingActions,
      }),
    resetSessionStoreForTests: () => undefined,
  };
});
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
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
function valueUpdateGraph() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit', successThreshold: 100 },
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
      { id: 'opt_a', kind: 'option', label: 'Plan A' },
      { id: 'opt_b', kind: 'option', label: 'Plan B' },
    ],
    edges: [
      {
        from: 'fac_advertising',
        to: 'goal_1',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive' as const,
      },
    ],
    options: [
      {
        id: 'opt_a',
        status: 'ready',
        interventions: { fac_advertising: { value: 30000 } },
      },
      {
        id: 'opt_b',
        status: 'ready',
        interventions: { fac_advertising: { value: 20000 } },
      },
    ],
    goal_node_id: 'goal_1',
  };
}

describe('Wave 6 — journey replay across the four named brief failures', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    appendCalls.length = 0;
    mockedPriorRunAnalysisGraphHash = null;
    mockedMostRecentPendingActions = [];
    mockedPersistedGraph = null;
    llmCallTracker.count = 0;
  });

  // ─────────────────────────────────────────────────────────────────
  // Failure 1 — chip click on what_would_flip dispatches handler
  // ─────────────────────────────────────────────────────────────────

  // F2 CHANGE A — removed: deterministic what_would_flip chip dispatch is gone (removed from DETERMINISTIC_CHIP_ACTION_TYPES); the pill now routes to the coach — covered by tests/integration/orchestrator/route-v2-chip-click-explain.test.ts.

  // ─────────────────────────────────────────────────────────────────
  // Failure 3 (HAPPY PATH only) — unambiguous deterministic
  // value-update at the HTTP boundary. The CLARIFICATION LOOP variant
  // of Failure 3 lives in `orchestrate-v2-clarify-reply-two-turn.test.ts`
  // — that's the proof for brief evidence #3. This test is the
  // single-turn cordon that catches a regression where the
  // deterministic value-update detector silently routes to the LLM.
  // ─────────────────────────────────────────────────────────────────

  it('failure 3 (happy path) — single-turn unambiguous "Update that factor to £30,000" dispatches set_factor_value, no LLM call, no edit_graph leak', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: randomUUID(),
        scenario_id: SCENARIO_ID,
        message: 'Update that factor to £30,000',
        turn_class: 'decide',
        stage: 'analyse',
        source: 'composer',
        graph_state: valueUpdateGraph(),
        selected_elements: { node_ids: ['fac_advertising'], edge_ids: [] },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const body = parseDeliveredOlumiResponse(JSON.parse(res.body));
    const patch = body.blocks.find((b) => b.type === 'graph_patch');
    expect(patch).toBeDefined();
    expect((patch as { operation?: string }).operation).toBe('set_factor_value');
    expect((patch as { target_id?: string }).target_id).toBe('fac_advertising');
    // No edit_graph fall-through.
    const editGraph = body.blocks.find(
      (b) => (b as { operation?: string }).operation === 'edit_graph',
    );
    expect(editGraph).toBeUndefined();
    // Receipt uses human label and user units; no raw ids, no
    // normalised model-unit fractions.
    expect(body.assistant_text).toContain('Advertising budget');
    expect(body.assistant_text).toMatch(/£30,000|£30000/);
    expect(body.assistant_text).not.toMatch(/\bfac_advertising\b/);
    expect(body.assistant_text).not.toMatch(/0\.\d+/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Failure 4 — explanation egress is bucketed and clean
  // ─────────────────────────────────────────────────────────────────

  // F2 CHANGE A — removed: the what_would_flip PILL now routes to the coach; its wire egress safety (no raw decimals / internal terms) is enforced by validateExplanationAnswer (raw_decimal_coefficient + forbidden_internal_term guards, unit-tested) and the routed composer tests. Coach-routing itself: route-v2-chip-click-explain.test.ts.

  // Failure 2 (at-limit add-risk preflight) is intentionally NOT in
  // this file. Coverage lives in
  // `src/orchestrator-v5/handlers/__tests__/edit-graph-dispatch-preflight.test.ts`
  // at the handler-dispatch layer. A no-op `expect(true).toBe(true)`
  // placeholder would overclaim HTTP-boundary coverage; the
  // acceptance report instead labels Failure 2 as handler-layer
  // proven only.
});
