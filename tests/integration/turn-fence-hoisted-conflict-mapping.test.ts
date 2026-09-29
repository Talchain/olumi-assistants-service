/**
 * ROADMAP 2.301 secondary defect — fence refusals must be typed 409s on
 * EVERY commit path, not just the main STEP-7 catch.
 *
 * The diagnosis (PHASE0-EVIDENCE-2026-07-28/diagnosis-commit-path-2026-08-03.md
 * §4) measured it live: turn-executor.ts has 23 commit catch sites and exactly
 * ONE of them (Amendment A2, the STEP-7 catch) mapped `TurnFenceRejectedError`
 * → GRAPH_WRITE_CONFLICT → HTTP 409. Every other site flattened the same
 * refusal to STATE_COMMIT_FAILED → INTERNAL_ERROR → HTTP 500 — the walk's
 * "500 arm" (multi-op hold-confirms) and the exact flattening A2's own comment
 * forbids, fixed at one site of 23.
 *
 * THE HOIST UNDER TEST: `commitTurn` (the single closure every executor commit
 * funnels through) captures a thrown `TurnFenceRejectedError` /
 * `GraphStaleWriteError`, and `finalizeRun` (the single funnel every path
 * returns through) remaps a STATE_COMMIT_FAILED outcome whose most recent
 * commit attempt was a typed conflict onto the SAME 409 envelope A2 builds.
 * No per-site edits — sites that already map (A2) are untouched (the remap
 * only fires on the STATE_COMMIT_FAILED flattening).
 *
 * RED-FIRST: at the pristine pre-hoist executor, the fence cases below FAIL
 * with `expected 500 to be 409` — the live 500-arm symptom in a test. The
 * non-conflict control (plain commit outage → 500) pins that the hoist does
 * NOT convert genuine infrastructure failures.
 *
 * PATH CHOICE: the deterministic short-confirm expired-offer recovery — the
 * user says "yes", every offer has lapsed, the executor commits deterministic
 * recovery copy through the catch at `short_confirm_recovery_expired` (a
 * NON-A2 site). Chosen because it is reachable without LLM routing (pure
 * pre-route), so the suite drives the REAL route + executor + commit ladder
 * via app.inject with only the store and LLM adapter mocked — same rig as
 * orchestrate-v2-fail-closed.test.ts, which pins the A2/main-path mapping.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink } from '../../src/utils/telemetry.js';
import { BoundaryErrorSchema } from '@talchain/schemas/boundary';
import { GraphStaleWriteError } from '../../src/orchestrator-v5/session/store.js';
import { TurnFenceRejectedError } from '../../src/orchestrator-v5/session/turn-fence.js';
import type { PendingAction } from '../../src/orchestrator-v5/session/pending-action.js';

const SCENARIO = 'c0000000-0000-4000-8000-000000000001';

// The LLM must NEVER be reached on this deterministic pre-route; a non-zero
// count fails the reachability pin below.
let llmCallCount = 0;

const hoistTestAdapter = {
  name: 'hoist-mock',
  chat: async () => ({
    content: '',
    usage: { input_tokens: 0, output_tokens: 0 },
    model: 'hoist-mock',
    latencyMs: 0,
  }),
  chatWithTools: async () => {
    llmCallCount++;
    return {
      content: [{ type: 'text', text: 'should not be reached' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'hoist-mock',
      latencyMs: 0,
    };
  },
};

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => hoistTestAdapter,
  getAdapterWithResolution: (task?: string) => ({
    adapter: hoistTestAdapter,
    resolution: {
      task,
      resolved_model: 'hoist-mock',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// An EXPIRED resumable offer: "yes" then matches, every candidate is lapsed,
// and the executor takes the `recovery_expired` deterministic commit — the
// currently-500 catch site under test.
const EXPIRED_PENDING: PendingAction = {
  id: 'pending-expired-1',
  scenario_id: SCENARIO,
  chip_id: 'chip-expired-1',
  action: { kind: 'run_analysis' },
  preconditions: {},
  expires_at_turn_count: 3,
  expires_at_iso: '2020-01-01T00:00:00.000Z', // wall-expired long ago
  emitted_at_iso: '2020-01-01T00:00:00.000Z',
};

type CommitFailureMode =
  | { mode: 'none' }
  | { mode: 'fence'; verdict: 'unclaimed' | 'stopped' | 'superseded' }
  | { mode: 'cas' }
  | { mode: 'outage' };
let commitFailureMode: CommitFailureMode = { mode: 'none' };

vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        readMostRecentPendingActions: async () => [EXPIRED_PENDING],
        append: async () => {
          if (commitFailureMode.mode === 'fence') {
            const verdict = commitFailureMode.verdict;
            throw new TurnFenceRejectedError(
              `V5 turn fence refused a graph write (${verdict})`,
              {
                verdict,
                generation: verdict === 'unclaimed' ? null : 3,
                maxGeneration: verdict === 'unclaimed' ? null : 4,
              },
            );
          }
          if (commitFailureMode.mode === 'cas') {
            throw new GraphStaleWriteError(
              'append_turn_atomic_v4 rejected a stale graph write (SQLSTATE OLGC1) — refresh and reconfirm.',
              {
                conflict_category: 'rpc_cas_conflict',
                expected_base_graph_hash: 'deadbeefcafe0002',
              },
            );
          }
          if (commitFailureMode.mode === 'outage') {
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

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function buildRequest(turnId: string) {
  return {
    kind: 'message' as const,
    turn_id: turnId,
    scenario_id: SCENARIO,
    // A bare confirmation: matches SHORT_CONFIRM_PATTERN, carries no edit
    // verb / quantity, and with only an expired pending on file dispatches
    // `recovery_expired` deterministically (no LLM).
    message: 'yes',
    turn_class: 'frame' as const,
    stage: 'analyse' as const,
    source: 'composer' as const,
  };
}

async function postTurn(app: FastifyInstance, turnId: string) {
  return app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: buildRequest(turnId),
  });
}

describe('hoisted fence/CAS conflict mapping — a NON-A2 commit path (expired-offer recovery)', () => {
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
    commitFailureMode = { mode: 'none' };
  });

  it('reachability control: the expired-recovery path commits and answers 200 with NO LLM call', async () => {
    const res = await postTurn(app, 'c1111111-1111-4111-8111-111111111111');
    expect(res.statusCode).toBe(200);
    expect(llmCallCount).toBe(0);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('lapsed');
    const completed = events.filter((e) => e.event === 'turn_executor.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.commit_performed).toBe(true);
  });

  // ── THE RED: pre-hoist this arrives as the walk's 500 arm ──
  it('fence refusal (unclaimed — the 2.301 staging verdict): HTTP 409 + GRAPH_DIVERGED + typed fence details, NOT 500', async () => {
    commitFailureMode = { mode: 'fence', verdict: 'unclaimed' };
    const res = await postTurn(app, 'c2222222-2222-4222-8222-222222222222');
    expect(res.statusCode).toBe(409);
    const parsed = BoundaryErrorSchema.parse(JSON.parse(res.body));
    expect(parsed.error).toBe('GRAPH_DIVERGED');
    expect(parsed.details).toMatchObject({
      reason: 'graph_write_conflict',
      failure_type: 'GRAPH_DIVERGED',
      fence_verdict: 'unclaimed',
      conflict_category: 'turn_fence_unclaimed',
      recovery_action: 'retry_later',
    });
    expect(llmCallCount).toBe(0);
    const completed = events.filter((e) => e.event === 'turn_executor.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.commit_performed).toBe(false);
    expect(completed[0]!.data.failure_type).toBe('GRAPH_DIVERGED');
  });

  it('fence refusal (stopped): 409 + start_new_draft through the same non-A2 path', async () => {
    commitFailureMode = { mode: 'fence', verdict: 'stopped' };
    const res = await postTurn(app, 'c3333333-3333-4333-8333-333333333333');
    expect(res.statusCode).toBe(409);
    const parsed = BoundaryErrorSchema.parse(JSON.parse(res.body));
    expect(parsed.details).toMatchObject({
      fence_verdict: 'stopped',
      conflict_category: 'turn_fence_stopped',
      recovery_action: 'start_new_draft',
    });
  });

  it('fence refusal (superseded): 409 + refresh_and_reconfirm through the same non-A2 path', async () => {
    commitFailureMode = { mode: 'fence', verdict: 'superseded' };
    const res = await postTurn(app, 'c4444444-4444-4444-8444-444444444444');
    expect(res.statusCode).toBe(409);
    const parsed = BoundaryErrorSchema.parse(JSON.parse(res.body));
    expect(parsed.details).toMatchObject({
      fence_verdict: 'superseded',
      conflict_category: 'turn_fence_superseded',
      recovery_action: 'refresh_and_reconfirm',
    });
  });

  it('graph CAS conflict: 409 + refresh_and_reconfirm + expected base hash through the same non-A2 path', async () => {
    commitFailureMode = { mode: 'cas' };
    const res = await postTurn(app, 'c5555555-5555-4555-8555-555555555555');
    expect(res.statusCode).toBe(409);
    const parsed = BoundaryErrorSchema.parse(JSON.parse(res.body));
    expect(parsed.error).toBe('GRAPH_DIVERGED');
    expect(parsed.details).toMatchObject({
      recovery_action: 'refresh_and_reconfirm',
      conflict_category: 'rpc_cas_conflict',
      expected_base_graph_hash: 'deadbeefcafe0002',
    });
  });

  // ── CONTROL: the hoist must not convert genuine infrastructure failures ──
  it('a NON-conflict commit outage on the same path STAYS a 500 INTERNAL_ERROR', async () => {
    commitFailureMode = { mode: 'outage' };
    const res = await postTurn(app, 'c6666666-6666-4666-8666-666666666666');
    expect(res.statusCode).toBe(500);
    const parsed = BoundaryErrorSchema.parse(JSON.parse(res.body));
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.details).toMatchObject({
      reason: 'state_commit_failed_or_turn_runtime_failure',
      failure_type: 'INTERNAL_ERROR',
    });
    const completed = events.filter((e) => e.event === 'turn_executor.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.failure_type).toBe('INTERNAL_ERROR');
  });
});
