/**
 * Unit tests for `runPreFlight` — the shared pre-flight helper used by
 * route-v2.ts. Locks the exact BoundaryError envelope shape emitted on
 * each of the three 422 paths via inline snapshots:
 *
 *   1. Extension parse failure — `V5RequestExtensions` validator
 *   2. B1 ingress failure — `OrchestratorTurnPayload` validator
 *   3. Scenario pre-flight cross-tenant mismatch — `scenario_preflight`
 *      validator
 *
 * The success path is covered by the existing route-level integration
 * tests (route-v2-*.test.ts, orchestrate-v2*.test.ts). These unit tests
 * exist specifically to pin the failure-envelope byte-for-byte so that a
 * future schema change produces a visible snapshot diff rather than a
 * silent wire-contract drift.
 */
import { describe, it, expect, vi } from 'vitest';

// Stub the session store BEFORE importing the helper — runPreFlight calls
// preflightEnsureScenario which resolves the store via getSessionStore.
// The cross-tenant snapshot test wants the store to report a different
// owner than the caller; the other two tests never reach the store.
const ensureScenarioExistsSpy = vi.fn();
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    ensureScenarioExists: ensureScenarioExistsSpy,
    append: async () => ({ id: 'unused' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({
      scope,
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { runPreFlight } = await import('../../../src/orchestrator/route-v2-preflight.js');

const FIXED_REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
const CALLER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeReq(body: unknown): { body: unknown; headers: Record<string, string> } {
  // `getOrGenerateRequestId` reads `x-request-id` (case-insensitive) and
  // validates it against SAFE_REQUEST_ID_PATTERN. Providing it here makes
  // the request_id in emitted BoundaryErrors deterministic for snapshots.
  // runPreFlight only reads `req.body` and `req.headers`; it does not
  // touch the reply.
  return { body, headers: { 'x-request-id': FIXED_REQUEST_ID } };
}

describe('runPreFlight — 422 envelope shapes', () => {
  it('extension-parse failure: structurally invalid graph_state produces a V5RequestExtensions BoundaryError', async () => {
    // `nodes` missing required `label` on the one and only node.
    const req = makeReq({
      kind: 'message',
      turn_id: '11111111-1111-4111-8111-111111111111',
      scenario_id: SCENARIO_ID,
      message: 'test',
      turn_class: 'frame',
      stage: 'frame',
      source: 'composer',
      graph_state: {
        nodes: [{ id: 'n1', kind: 'option' }],
        edges: [],
      },
    });

     
    const result = await runPreFlight(req as any);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(422);
    expect(result.error).toMatchInlineSnapshot(`
      {
        "boundary": "B1",
        "details": {
          "field": "graph_state",
          "issues": [
            {
              "code": "invalid_type",
              "message": "Required",
              "path": "nodes.0.label",
            },
          ],
        },
        "direction": "ingress",
        "error": "INGRESS_CONTRACT_VIOLATION",
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "retryable": false,
        "validator": "V5RequestExtensions",
      }
    `);
  });

  it('B1 ingress failure: missing required scenario_id produces an OrchestratorTurnPayload BoundaryError', async () => {
    const req = makeReq({
      kind: 'message',
      turn_id: '11111111-1111-4111-8111-111111111111',
      // scenario_id deliberately omitted
      message: 'test',
      turn_class: 'frame',
      stage: 'frame',
      source: 'composer',
    });

     
    const result = await runPreFlight(req as any);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(422);
    // Shape assertions rather than a full inline snapshot for this one:
    // the upstream OrchestratorTurnPayload schema lives in @talchain/schemas
    // and its issue list may evolve. The stable surface — error code,
    // validator, boundary, direction, retryable — is what the wire contract
    // locks.
    expect(result.error.error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(result.error.boundary).toBe('B1');
    expect(result.error.direction).toBe('ingress');
    expect(result.error.validator).toBe('OrchestratorTurnPayload');
    expect(result.error.retryable).toBe(false);
    expect(result.error.request_id).toBe(FIXED_REQUEST_ID);
    const details = result.error.details as { issues?: Array<{ path: string }> };
    expect(Array.isArray(details.issues)).toBe(true);
    expect(details.issues!.some((i) => i.path.includes('scenario_id'))).toBe(true);
  });

  it('guest mode (no user_id): pre-flight calls store with null, skips ownership check, returns ok', async () => {
    ensureScenarioExistsSpy.mockReset();
    ensureScenarioExistsSpy.mockResolvedValueOnce({ user_id: null });

    const req = makeReq({
      kind: 'message',
      turn_id: '22222222-2222-4222-8222-222222222222',
      scenario_id: SCENARIO_ID,
      message: 'test',
      turn_class: 'frame',
      stage: 'frame',
      source: 'composer',
      // no user_id — guest session
    });

     
    const result = await runPreFlight(req as any);

    expect(result.ok).toBe(true);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledTimes(1);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, null);
  });

  it('IDOR fail-closed: no user_id + owned scenario → scenario_preflight 422 (scenario_requires_authenticated_owner)', async () => {
    // The store reports a non-null owner while the body carries NO user_id
    // (JWT flag off → effective identity is the caller-supplied value, i.e.
    // null). Before the fix this passed pre-flight (either-null skip), so any
    // anonymous request could act on any owned scenario. Now it must 422.
    ensureScenarioExistsSpy.mockReset();
    ensureScenarioExistsSpy.mockResolvedValueOnce({ user_id: OWNER_USER_ID });

    const req = makeReq({
      kind: 'message',
      turn_id: '33333333-3333-4333-8333-333333333333',
      scenario_id: SCENARIO_ID,
      message: 'test',
      turn_class: 'frame',
      stage: 'frame',
      source: 'composer',
      // no user_id — anonymous caller
    });

    const result = await runPreFlight(req as any);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(422);
    expect(result.error).toMatchInlineSnapshot(`
      {
        "boundary": "B1",
        "details": {
          "reason": "scenario_requires_authenticated_owner",
          "scenario_id": "55555555-5555-4555-8555-555555555555",
        },
        "direction": "ingress",
        "error": "INGRESS_CONTRACT_VIOLATION",
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "retryable": false,
        "validator": "scenario_preflight",
      }
    `);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledTimes(1);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, null);
  });

  it('scenario-preflight failure: cross-tenant ownership mismatch produces a scenario_preflight BoundaryError', async () => {
    // Store returns a different owner than the caller — cross-tenant.
    ensureScenarioExistsSpy.mockReset();
    ensureScenarioExistsSpy.mockResolvedValueOnce({ user_id: OWNER_USER_ID });

    const req = makeReq({
      kind: 'message',
      turn_id: '11111111-1111-4111-8111-111111111111',
      scenario_id: SCENARIO_ID,
      message: 'test',
      turn_class: 'frame',
      stage: 'frame',
      source: 'composer',
      user_id: CALLER_USER_ID,
    });

     
    const result = await runPreFlight(req as any);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(422);
    expect(result.error).toMatchInlineSnapshot(`
      {
        "boundary": "B1",
        "details": {
          "reason": "scenario_owned_by_other_user",
          "scenario_id": "55555555-5555-4555-8555-555555555555",
        },
        "direction": "ingress",
        "error": "INGRESS_CONTRACT_VIOLATION",
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "retryable": false,
        "validator": "scenario_preflight",
      }
    `);
    // The spy was called exactly once with the caller's user_id and scenario_id.
    expect(ensureScenarioExistsSpy).toHaveBeenCalledTimes(1);
    expect(ensureScenarioExistsSpy).toHaveBeenCalledWith(SCENARIO_ID, CALLER_USER_ID);
  });
});
