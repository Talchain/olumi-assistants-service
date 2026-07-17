/**
 * V5 upsert-on-append pre-flight (replaces 2026-04-20 existence-only check).
 *
 * Verifies that `POST /orchestrate/v2/turn` now calls
 * `SessionStore.ensureScenarioExists` BEFORE invoking the TurnExecutor, with
 * the following semantics:
 *
 *   userId PRESENT on the request body
 *     ─ row absent → RPC inserts → pre-flight passes → 200
 *     ─ row present, caller is owner → RPC no-ops → pre-flight passes → 200
 *     ─ row present, DIFFERENT owner → pre-flight rejects → 422
 *       `INGRESS_CONTRACT_VIOLATION` / `reason=scenario_owned_by_other_user`
 *
 *   userId ABSENT (guest mode — VITE_AUTH_MODE=guest)
 *     ─ pre-flight runs with null userId → row created with user_id = NULL
 *     ─ ownership check skipped → TurnExecutor runs → 200
 *
 *   RPC throws (transient outage)
 *     ─ pre-flight skipped → 200 (same rationale)
 *
 * ⚠ PoC trust-the-caller posture. See
 * supabase/migrations/…_v5_ensure_scenario_exists.sql for the production
 * upgrade (JWT-scoped client + auth.uid()).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { BoundaryErrorSchema } from '@talchain/schemas/boundary';

import { setTestSink } from '../../src/utils/telemetry.js';

const SCENARIO_NEW = 'e0000000-0000-4000-8000-000000000001';
const SCENARIO_OWNED_BY_CALLER = 'e0000000-0000-4000-8000-000000000002';
const SCENARIO_OWNED_BY_OTHER = 'e0000000-0000-4000-8000-000000000003';
const USER_CALLER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// RPC state — the stub returns the scenario's authoritative user_id exactly
// the way the real `ensure_scenario_exists` RPC does: INSERT-if-missing
// (DO NOTHING on conflict), then SELECT the stored user_id.
// user_id is null for guest rows (VITE_AUTH_MODE=guest).
interface StoreState {
  rows: Map<string, string | null>; // scenario_id → owner user_id (null = guest)
  throwOnEnsure: Error | null;
  throwOnAppend: Error | null;
}
const storeState: StoreState = {
  rows: new Map([
    [SCENARIO_OWNED_BY_CALLER, USER_CALLER],
    [SCENARIO_OWNED_BY_OTHER, USER_OTHER],
  ]),
  throwOnEnsure: null,
  throwOnAppend: null,
};

// Locally-defined StateCommitFailedError that parrots the real one's shape.
// We can't import the real class because vi.mock replaces the whole module
// and importing from within the mock factory creates a hoist loop.
class MockStateCommitFailedError extends Error {
  readonly rpc_code: string | undefined;
  constructor(msg: string, opts?: { rpc_code?: string }) {
    super(msg);
    this.name = 'StateCommitFailedError';
    this.rpc_code = opts?.rpc_code;
  }
}

// ROADMAP 1.148 — importOriginal-spread + complete shared store mock
// (derive, don't mirror): real module exports (SessionReadError,
// StateCommitFailedError, constants) stay real; the store double
// implements the FULL SessionStore interface. Only the seams this suite
// controls (append / ensureScenarioExists) are overridden.
vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: async () => {
          if (storeState.throwOnAppend) throw storeState.throwOnAppend;
          return { id: 'mock-row-id' };
        },
        ensureScenarioExists: async (
          scenarioId: string,
          userId: string | null,
        ): Promise<{ user_id: string | null }> => {
          if (storeState.throwOnEnsure) throw storeState.throwOnEnsure;
          const existing = storeState.rows.get(scenarioId);
          if (existing !== undefined) return { user_id: existing };
          // Simulate the RPC's INSERT ... ON CONFLICT DO NOTHING.
          // userId is null for guest sessions.
          storeState.rows.set(scenarioId, userId);
          return { user_id: userId };
        },
      }),
    resetSessionStoreForTests: () => {},
  };
});

// LLM adapter mock: permissive so happy-path tests run all the way through.
const preflightMockAdapter = {
  name: 'preflight-test-mock',
  chat: async () => ({
    content: 'ok',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'preflight-test-mock',
    latencyMs: 0,
  }),
  chatWithTools: async () => ({
    content: [{ type: 'text', text: 'pre-flight happy-path narrate' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'preflight-test-mock',
    latencyMs: 0,
  }),
};

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => preflightMockAdapter,
  getAdapterWithResolution: (task?: string) => ({
    adapter: preflightMockAdapter,
    resolution: {
      task: task ?? 'orchestrator',
      resolved_model: 'preflight-test-mock',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
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

function buildRequest(scenarioId: string, userId?: string) {
  return {
    kind: 'message' as const,
    turn_id: 'a1111111-1111-4111-8111-111111111111',
    scenario_id: scenarioId,
    message: 'pre-flight test message',
    turn_class: 'frame' as const,
    // ROADMAP 1.148 C4: stage 'analyse', NOT 'frame'. The frame-stage
    // no-brief guard (PR #203/#484) answers brief-less frame turns
    // deterministically BEFORE TurnExecutor; the pre-flight→TurnExecutor
    // sequencing this suite proves needs the turn to actually reach
    // TurnExecutor (turn_executor.started assertions).
    stage: 'analyse' as const,
    source: 'composer' as const,
    ...(userId !== undefined ? { user_id: userId } : {}),
  };
}

describe('POST /orchestrate/v2/turn — upsert-on-append pre-flight', () => {
  let app: FastifyInstance;

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
    storeState.throwOnEnsure = null;
    storeState.throwOnAppend = null;
    // Reset rows to the baseline between tests so the "creates on-demand"
    // test below doesn't accumulate state across runs.
    storeState.rows = new Map([
      [SCENARIO_OWNED_BY_CALLER, USER_CALLER],
      [SCENARIO_OWNED_BY_OTHER, USER_OTHER],
    ]);
  });

  it('creates a missing scenario on-demand when user_id is supplied (200)', async () => {
    expect(storeState.rows.has(SCENARIO_NEW)).toBe(false);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_NEW, USER_CALLER),
    });
    expect(res.statusCode).toBe(200);
    // RPC stub inserted the row.
    expect(storeState.rows.get(SCENARIO_NEW)).toBe(USER_CALLER);
    expect(events.filter((e) => e.event === 'turn_executor.started')).toHaveLength(1);
  });

  it('passes pre-flight for an existing scenario owned by the caller (200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_OWNED_BY_CALLER, USER_CALLER),
    });
    expect(res.statusCode).toBe(200);
    expect(events.filter((e) => e.event === 'turn_executor.started')).toHaveLength(1);
  });

  it('rejects a cross-tenant attempt (existing scenario, different owner) with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_OWNED_BY_OTHER, USER_CALLER),
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    const parsed = BoundaryErrorSchema.parse(body);
    expect(parsed.error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(parsed.boundary).toBe('B1');
    expect(parsed.direction).toBe('ingress');
    expect(parsed.validator).toBe('scenario_preflight');
    expect(parsed.retryable).toBe(false);
    expect(parsed.details).toMatchObject({
      reason: 'scenario_owned_by_other_user',
      scenario_id: SCENARIO_OWNED_BY_OTHER,
    });
    // Pre-flight ran BEFORE TurnExecutor — no turn_executor events.
    expect(events.filter((e) => e.event === 'turn_executor.started')).toHaveLength(0);
  });

  it('leak-guard: cross-tenant 422 details contain ONLY reason + scenario_id (no owner info)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_OWNED_BY_OTHER, USER_CALLER),
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    BoundaryErrorSchema.parse(body);
    expect(Object.keys(body.details).sort()).toEqual(['reason', 'scenario_id']);
    expect(body.details.scenario_id).toBe(SCENARIO_OWNED_BY_OTHER);
    // Critically: no `owner_user_id` or similar field on the wire.
    expect(body.details).not.toHaveProperty('owner_user_id');
    expect(body.details).not.toHaveProperty('user_id');
    // Belt-and-braces: scan the raw wire bytes for the owner's UUID.
    // The caller's own user_id (USER_CALLER) must NOT appear either —
    // the caller already knows it, but including it would make the
    // response shape-dependent on caller state and complicate log review.
    expect(res.body).not.toContain(USER_OTHER);
    expect(res.body).not.toContain(USER_CALLER);
  });

  it('guest mode (no user_id): pre-flight runs, creates row with null user_id, TurnExecutor runs', async () => {
    // Guest requests (VITE_AUTH_MODE=guest) send no user_id. The RPC is
    // still called and inserts the row with user_id = NULL. Ownership check
    // is skipped. TurnExecutor proceeds normally.
    const SCENARIO_GUEST = 'e0000000-0000-4000-8000-000000000099';
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_GUEST),
    });
    expect(res.statusCode).toBe(200);
    expect(events.filter((e) => e.event === 'turn_executor.started')).toHaveLength(1);
    // The stub should have recorded the guest scenario with null user_id.
    expect(storeState.rows.get(SCENARIO_GUEST)).toBeNull();
  });

  it('rejects a malformed user_id (non-UUID) at the ingress boundary with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_NEW, 'not-a-uuid'),
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    const parsed = BoundaryErrorSchema.parse(body);
    expect(parsed.error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(parsed.validator).toBe('V5RequestExtensions');
    expect(parsed.details).toMatchObject({ field: 'user_id' });
  });

  it('on an RPC error, pre-flight silently skips and TurnExecutor is the last line of defence', async () => {
    storeState.throwOnEnsure = new Error('transient supabase outage');
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_OWNED_BY_CALLER, USER_CALLER),
    });
    expect(res.statusCode).toBe(200);
    expect(events.filter((e) => e.event === 'turn_executor.started')).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Edge-case verification (pre-merge review)
  // ─────────────────────────────────────────────────────────────────────

  it('edge case 2 — preflight RPC fails AND commit RPC fails: 500 BoundaryError, NOT silent 200', async () => {
    // Simulates realistic "Supabase outage": ensure_scenario_exists errors,
    // then append_turn_atomic also errors. Without the fail-closed invariant
    // (route-v2.ts commit-check), a TurnExecutor whose commit failed would
    // otherwise emit 200 + well-formed OlumiResponse, silently corrupting
    // the session. The commit-check guarantees 500 + typed BoundaryError.
    storeState.throwOnEnsure = new Error('ensure_scenario_exists: transient outage');
    storeState.throwOnAppend = new MockStateCommitFailedError(
      'append_turn_atomic RPC failed: transient outage',
      { rpc_code: '57P03' },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_OWNED_BY_CALLER, USER_CALLER),
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    const parsed = BoundaryErrorSchema.parse(body);
    // The internal class STATE_COMMIT_FAILED maps to wire code
    // INTERNAL_ERROR (see INTERNAL_TO_WIRE in orchestrator-v5/types.ts).
    // The original class is preserved in details.failure_type so clients
    // that want the granular signal can read it there.
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.boundary).toBe('B1');
    expect(parsed.direction).toBe('egress');
    expect(parsed.validator).toBe('turn_commit');
    // STATE_COMMIT_FAILED is a retryable class — the wire flag must say so.
    expect(parsed.retryable).toBe(true);
    expect(parsed.details).toMatchObject({
      reason: 'state_commit_failed_or_turn_runtime_failure',
      failure_type: 'INTERNAL_ERROR',
    });
    // Belt-and-braces: the response must NEVER be a 200 with an
    // OlumiResponse body under these conditions.
    expect(body).not.toHaveProperty('turn_id');
    expect(body).not.toHaveProperty('blocks');
  });

  it('edge case 3 — no user_id + RPC insert succeeds but append_turn_atomic fails: 500 STATE_COMMIT_FAILED (typed, not silent)', async () => {
    // Guest request: preflight calls the RPC (upsert), which succeeds. But
    // if append_turn_atomic then fails (e.g. the stub simulates an outage),
    // the typed BoundaryError must surface — not a silent 200.
    //
    //   HTTP 500
    //   Body: BoundaryError {
    //     error: 'INTERNAL_ERROR',   // wire code; internal class
    //                                // STATE_COMMIT_FAILED is stamped
    //                                // in details.failure_type.
    //     retryable: true,
    //     validator: 'turn_commit',
    //     details: {
    //       reason: 'state_commit_failed_or_turn_runtime_failure',
    //       failure_type: 'INTERNAL_ERROR',
    //     }
    //   }
    //
    // Critically NOT: 200 + empty body, 200 + OlumiResponse with empty
    // blocks, silent drop, or a generic 500 without a typed envelope.
    storeState.throwOnAppend = new MockStateCommitFailedError(
      'append_turn_atomic RPC failed: scenario 00000000-0000-0000-0000-000000000000 not found',
    );
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('00000000-0000-4000-8000-000000000000'),
      // ^ deliberately no user_id
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    const parsed = BoundaryErrorSchema.parse(body);
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.validator).toBe('turn_commit');
    expect(parsed.retryable).toBe(true);
    expect(parsed.details).toMatchObject({
      reason: 'state_commit_failed_or_turn_runtime_failure',
      failure_type: 'INTERNAL_ERROR',
    });
    // The response is a typed envelope, not an empty body.
    expect(Object.keys(body).length).toBeGreaterThan(0);
    expect(body).toHaveProperty('request_id');
    expect(body).toHaveProperty('error');
    // TurnExecutor DID start (preflight was skipped for want of user_id).
    expect(events.filter((e) => e.event === 'turn_executor.started')).toHaveLength(1);
  });
});
