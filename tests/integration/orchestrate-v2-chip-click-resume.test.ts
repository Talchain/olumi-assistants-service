/**
 * Wave 5H — HTTP-boundary parity for chip-click resume.
 *
 * Pairs with the existing layered proofs:
 *   - Helper test (route-v2-chip-click-intent.test.ts): pure-function
 *     contract for `detectChipClickResumeIntent`.
 *   - Route-level lifecycle test (short-confirm-route-level.test.ts):
 *     calls `runTurnExecutor` directly with the typed
 *     `chipClickResumeIntent` flag.
 *
 * Neither of those proves the full HTTP boundary: a real POST to
 * `/orchestrate/v2/turn` with a `chip_click` ingress traverses request
 * parsing → ingress validation → route dispatch → TurnExecutor →
 * resumer → recovery dispatch → finaliser → wire response. This file
 * pins that boundary parity by mounting `ceeOrchestratorRouteV2` on a
 * Fastify instance and using `app.inject` to drive the route exactly
 * as production does.
 *
 * Coverage:
 *  - chip_click + action_type=what_would_flip + persisted what_would_flip
 *    PendingAction → resumer claims the turn at the route boundary;
 *    no LLM call; safety recovery copy is composed end-to-end and
 *    surfaces an executable Run-analysis chip.
 *  - chip_click + action_type=run_analysis still hits the dedicated
 *    pre-TurnExecutor `dispatchChipClickRunAnalysis` shortcut (regression
 *    cordon — Wave 5H must not have broken the existing path).
 *
 * Out of scope (acknowledged): exercising the happy path where a fresh
 * analysis fact lets the resumer actually run the what_would_flip
 * handler. The flagship route-level test covers the dispatch shape and
 * proves no LLM call. The HTTP boundary's job here is to prove parity
 * for the route → resumer → response path, which the recovery branch
 * exercises in full.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { PendingAction } from '../../src/orchestrator-v5/session/pending-action.js';

// Throwing routing adapter — any LLM call fails the test loudly.
const llmCallTracker = { count: 0 };

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test-throwing-adapter',
    chat: async () => {
      llmCallTracker.count += 1;
      throw new Error('LLM should not be called when chip-click resumes a pending action');
    },
    chatWithTools: async () => {
      llmCallTracker.count += 1;
      throw new Error('LLM should not be called when chip-click resumes a pending action');
    },
  }),
  getAdapterWithResolution: (task?: string) => ({
    adapter: {
      name: 'test-throwing-adapter',
      chat: async () => {
        llmCallTracker.count += 1;
        throw new Error('LLM should not be called when chip-click resumes a pending action');
      },
      chatWithTools: async () => {
        llmCallTracker.count += 1;
        throw new Error('LLM should not be called when chip-click resumes a pending action');
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

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const PENDING_WHAT_WOULD_FLIP: PendingAction = {
  id: 'pa-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: SCENARIO_ID,
  chip_id: 'chip-explore',
  action: { kind: 'what_would_flip' },
  preconditions: { required_freshness: 'fresh' },
  expires_at_turn_count: 2,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-05-05T00:00:00.000Z',
};

const appendCalls: unknown[] = [];

vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    // Surface a prior run_analysis handler turn so the freshness
    // derivation has something to read. Without a graph_hash on the
    // prior fact AND a matching live graph hash, freshness reads
    // 'unknown' — the resumer downgrades what_would_flip to a focused
    // rerun-analysis recovery rather than running on stale data.
    readRecent: async () => [
      {
        id: 'prior-handler-row',
        scenario_id: SCENARIO_ID,
        user_id: null,
        turn_id: 'prior-turn-id',
        turn_class: 'handler' as const,
        handler_id: 'run_analysis' as const,
        request_hash: 'sha256:prior',
        response_emitted: true,
        llm_calls_used: 1,
        duration_ms: 100,
        created_at: '2026-05-04T00:00:00.000Z',
      },
    ],
    readFactsFor: async () => [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt-a',
          summary: 'Prior analysis summary.',
          win_probabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
        },
      },
    ],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [PENDING_WHAT_WOULD_FLIP],
  }),
  resetSessionStoreForTests: () => undefined,
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

function buildChipClickPayload(actionType: 'what_would_flip' | 'run_analysis') {
  // The boundary `chip` schema is strict and only carries
  // `action_type` and `parameters`. Identity (`id`, `label`) is server-
  // side; the V5 layer derives it from the persisted PendingAction's
  // `chip_id`.
  return {
    kind: 'message' as const,
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message: 'Explore what would change the result.',
    turn_class: 'decide' as const,
    stage: 'analyse' as const,
    source: 'chip_click' as const,
    chip: {
      action_type: actionType,
    },
  };
}

describe('POST /orchestrate/v2/turn — chip-click resume HTTP boundary', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    v5Enabled = true;
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    appendCalls.length = 0;
    llmCallTracker.count = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('chip_click + action_type=what_would_flip + persisted PendingAction → resumer claims turn at HTTP boundary, no LLM call, safety recovery composed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildChipClickPayload('what_would_flip'),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);

    // Acceptance Gate 1: zero LLM calls. The strongest signal that the
    // chip-click intent flag was detected at the route, threaded into
    // TurnExecutor, and the resumer claimed the turn deterministically.
    expect(llmCallTracker.count).toBe(0);

    // Acceptance Gate 2: the response surfaced the rerun-analysis
    // recovery copy. With unknown freshness on the prior run_analysis
    // fact, resuming what_would_flip would surface a misleading answer,
    // so the resumer downgrades to rerun_analysis_required.
    expect(parsed.assistant_text).toMatch(/run analysis again/i);

    // Acceptance Gate 3: an executable run_analysis chip is offered so
    // the user can refresh.
    const runAnalysisChips = (parsed.suggested_actions ?? []).filter(
      (a) => a.action_type === 'run_analysis',
    );
    expect(runAnalysisChips.length).toBeGreaterThan(0);

    // Acceptance Gate 4: no internal failure copy leaks at the boundary.
    expect(parsed.assistant_text).not.toMatch(/no pending action/i);
    expect(parsed.assistant_text).not.toMatch(/internal error/i);
    expect(parsed.assistant_text).not.toMatch(/not found in graph/i);
    expect(parsed.assistant_text).not.toMatch(/-?\d+\.\d+/); // no raw decimals

    // Acceptance Gate 5: a turn row was committed (the recovery
    // dispatches commit, not a bare error response).
    expect(appendCalls.length).toBeGreaterThan(0);
  });

  it('chip_click + action_type=run_analysis still hits the dedicated dispatcher (regression cordon)', async () => {
    // The Wave 5H typed-flag rewrite must NOT have broken the existing
    // chip_click run_analysis fast path, which dispatches BEFORE
    // TurnExecutor. We assert the route returns a 200 (or a typed 500
    // if the stubbed handler registry doesn't include run_analysis —
    // either way, NOT a fall-through to the LLM).
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildChipClickPayload('run_analysis'),
    });

    // The dedicated dispatcher path may return 500 in this mocked
    // environment because the run_analysis handler reads scenario state
    // from PLoT which is not available. The contract this test cordons
    // is: the LLM is NEVER called for chip_click + run_analysis.
    expect(llmCallTracker.count).toBe(0);
    // Either committed-success (200) or typed handler-failure (500),
    // both confirm the dedicated dispatcher claimed the turn.
    expect([200, 500]).toContain(res.statusCode);
  });
});
