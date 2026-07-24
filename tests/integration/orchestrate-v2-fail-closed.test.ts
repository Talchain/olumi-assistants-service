/**
 * V5 Group 3 Task B — fail-closed on commit failure.
 *
 * Invariant: `commit_performed: false` must NEVER appear inside an HTTP 200
 * response. A state-commit failure means the LLM produced a valid response
 * but persistence failed; the client must see a 500 with a typed retryable
 * error envelope, not a 200 that implies success.
 *
 * Covers:
 *   - commit failure → HTTP 500 + INTERNAL_ERROR + retryable:true
 *   - commit success → HTTP 200 (regression)
 *   - commit failure does not re-invoke the LLM (no silent retry loop)
 *   - parametric invariant guard: any completed turn with commit_performed:false
 *     returns non-200
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink } from '../../src/utils/telemetry.js';
import { BoundaryErrorSchema } from '@talchain/schemas/boundary';
// F4 — the REAL error class (session/store.js is NOT mocked here, so the
// executor's `instanceof GraphStaleWriteError` check matches this one).
import { GraphStaleWriteError } from '../../src/orchestrator-v5/session/store.js';

const SCENARIO = 'b0000000-0000-4000-8000-000000000001';

// Count LLM invocations so we can prove commit failure doesn't retry the LLM.
let llmCallCount = 0;

const failClosedAdapter = {
  name: 'fail-closed-mock',
  chat: async () => ({ content: '', usage: { input_tokens: 0, output_tokens: 0 }, model: 'fail-closed-mock', latencyMs: 0 }),
  chatWithTools: async () => {
    llmCallCount++;
    return {
      content: [{ type: 'text', text: 'commit-test narrate output' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'fail-closed-mock',
      latencyMs: 0,
    };
  },
};

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => failClosedAdapter,
  getAdapterWithResolution: (task?: string) => ({
    adapter: failClosedAdapter,
    resolution: {
      task,
      resolved_model: 'fail-closed-mock',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// Mutable: lets tests flip between "commit succeeds" and "commit fails".
let commitShouldFail = false;
// F4 — flip to make the commit raise a graph CAS conflict (OLGC1-class).
let commitShouldConflict = false;

// ROADMAP 1.148 — importOriginal-spread + complete shared store mock
// (derive, don't mirror): real module exports stay real; the store double
// implements the FULL SessionStore interface so interface growth can't
// silently break this suite again. Only `append` is suite-specific.
vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: async () => {
          if (commitShouldConflict) {
            // OLGC1-class: the base graph diverged; whole txn rolled back.
            throw new GraphStaleWriteError(
              'append_turn_atomic_v3 rejected a stale graph write (SQLSTATE OLGC1) — refresh and reconfirm.',
              {
                conflict_category: 'rpc_cas_conflict',
                expected_base_graph_hash: 'deadbeefcafe0001',
              },
            );
          }
          if (commitShouldFail) {
            const err = new Error('append_turn_atomic RPC failed: simulated persistence outage');
            err.name = 'StateCommitFailedError';
            throw err;
          }
          return { id: 'mock-row-id' };
        },
      }),
    resetSessionStoreForTests: () => {},
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

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function buildRequest(turnId: string) {
  return {
    kind: 'message' as const,
    turn_id: turnId,
    scenario_id: SCENARIO,
    message: 'fail-closed test message',
    turn_class: 'frame' as const,
    // ROADMAP 1.148 C4: stage 'analyse', NOT 'frame'. The frame-stage
    // no-brief guard (PR #203/#484) answers brief-less frame turns
    // deterministically BEFORE TurnExecutor, so a 'frame' fixture never
    // reaches the commit path this suite exists to prove fail-closed.
    // At 'analyse' the turn reaches ORIENT → narrate → commit for real.
    stage: 'analyse' as const,
    source: 'composer' as const,
  };
}

describe('POST /orchestrate/v2/turn — Group 3 Task B fail-closed on commit failure', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
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
    llmCallCount = 0;
    commitShouldFail = false;
    commitShouldConflict = false;
  });

  it('commit success path: HTTP 200, retryable is NOT relevant (no error envelope)', async () => {
    commitShouldFail = false;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('b1111111-1111-4111-8111-111111111111'),
    });
    expect(res.statusCode).toBe(200);
    const completed = events.filter((e) => e.event === 'turn_executor.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.commit_performed).toBe(true);
  });

  it('commit failure: HTTP 500 + typed BoundaryError with retryable:true (wire-shape compatible with UI parser)', async () => {
    commitShouldFail = true;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('b2222222-2222-4222-8222-222222222222'),
    });
    // Core Task B assertion: non-200 status on commit failure.
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    // P0 follow-up: body MUST parse as BoundaryError, not OlumiResponse.
    // The UI parser (DecisionGuideAI/src/v5/responseParser.ts:35) treats
    // every non-ok status as BoundaryError — sending an OlumiResponse on
    // 500 would collapse to a generic INTERNAL_ERROR and lose `retryable`.
    const parsed = BoundaryErrorSchema.parse(body);
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.retryable).toBe(true);
    expect(parsed.details).toMatchObject({
      retryable: true,
      reason: 'state_commit_failed_or_turn_runtime_failure',
      failure_type: 'INTERNAL_ERROR',
    });
    const completed = events.filter((e) => e.event === 'turn_executor.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.commit_performed).toBe(false);
    expect(completed[0]!.data.failure_type).toBe('INTERNAL_ERROR');
  });

  // F4 (Codex deep-review) — a graph CAS conflict must surface as HTTP 409 +
  // GRAPH_DIVERGED with refresh-reconfirm recovery metadata, NOT a flattened
  // 500/INTERNAL_ERROR. RED-first: pre-fix GraphStaleWriteError (extends
  // StateCommitFailedError) hits the generic catch → STATE_COMMIT_FAILED →
  // INTERNAL_ERROR → 500.
  it('graph CAS conflict (OLGC1): HTTP 409 + GRAPH_DIVERGED + refresh-reconfirm recovery metadata', async () => {
    commitShouldConflict = true;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('b5555555-5555-4555-8555-555555555555'),
    });
    // 409, not the uniform 500.
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    const parsed = BoundaryErrorSchema.parse(body);
    expect(parsed.error).toBe('GRAPH_DIVERGED');
    expect(parsed.details).toMatchObject({
      reason: 'graph_write_conflict',
      failure_type: 'GRAPH_DIVERGED',
      recovery_action: 'refresh_and_reconfirm',
      conflict_category: 'rpc_cas_conflict',
      expected_base_graph_hash: 'deadbeefcafe0001',
    });
    const completed = events.filter((e) => e.event === 'turn_executor.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.commit_performed).toBe(false);
    expect(completed[0]!.data.failure_type).toBe('GRAPH_DIVERGED');
  });

  it('graph CAS conflict does NOT re-invoke the LLM (no silent retry loop)', async () => {
    commitShouldConflict = true;
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('b6666666-6666-4666-8666-666666666666'),
    });
    expect(llmCallCount).toBe(1);
  });

  it('commit failure does NOT re-invoke the LLM (no silent retry loop)', async () => {
    commitShouldFail = true;
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('b3333333-3333-4333-8333-333333333333'),
    });
    // Exactly one ORIENT call regardless of commit outcome.
    expect(llmCallCount).toBe(1);
  });

  it('invariant: commit_performed:false never appears inside an HTTP 200', async () => {
    const cases: Array<{ turnId: string; fail: boolean }> = [
      { turnId: 'b4444444-aaaa-4444-8444-444444444444', fail: false },
      { turnId: 'b4444444-bbbb-4444-8444-444444444444', fail: true },
    ];
    for (const { turnId, fail } of cases) {
      events = [];
      commitShouldFail = fail;
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: buildRequest(turnId),
      });
      const completed = events.filter((e) => e.event === 'turn_executor.completed');
      expect(completed).toHaveLength(1);
      const committed = completed[0]!.data.commit_performed as boolean;
      if (committed === false) {
        expect(res.statusCode).not.toBe(200);
      } else {
        expect(res.statusCode).toBe(200);
      }
    }
  });
});
