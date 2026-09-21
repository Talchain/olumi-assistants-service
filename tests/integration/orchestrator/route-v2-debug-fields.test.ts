/**
 * V5 boundary-hardening — two-gate `_timings` opt-in on /orchestrate/v2/turn.
 *
 * Pre-fix (PR #181 and earlier): the env flag `V5_TIMING_DEBUG=true`
 * (`config.cee.timingDebugEnabled`) alone caused `_timings` to be
 * attached to every authenticated turn response. This tripped DGAI's
 * strict `OlumiResponseSchema` parser for normal browser traffic and
 * showed up as `parse_error` in the captured failure.
 *
 * Post-fix contract: both gates must pass:
 *   (a) `config.cee.timingDebugEnabled === true`  — server permission
 *   (b) `X-Olumi-Debug: timings` header           — per-request opt-in
 *
 * This suite locks in the four-case matrix on a live Fastify route
 * registration. Helper-level header semantics are covered by
 * `src/orchestrator/__tests__/debug-fields.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mutable config holder lets each test toggle the env-level gate.
const configHolder = {
  cee: { timingDebugEnabled: false, turnDebugEnabled: false },
  features: { optionShortcutRepair: true },
};
vi.mock('../../../src/config/index.js', () => ({
  config: configHolder,
  isProduction: () => false,
}));

// dispatchDraftGraph returns a canned response that ALWAYS carries a
// `_timings` block — so the only thing the gate controls is whether the
// route re-attaches it to the wire body. If a test sees `_timings` on
// the wire, the gate let it through; if it doesn't, the gate stripped it.
const dispatchDraftGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

// Session-store and LLM stubs — copied from route-v2-draft-graph.test.ts
// to keep this suite self-contained. The route's pre-flight upserts a
// scenario row even on the draft_graph branch, so a noop store is fine.
const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const LONG_BRIEF =
  'Should we expand the product into the German market next quarter or hold?';

/**
 * Canned draft_graph dispatch result. The `_timings` field on the
 * `response` is what's stripped pre-validation and conditionally
 * re-attached by the route. The product fields are minimal but valid
 * against `OlumiResponseSchema` so the route's egress validator
 * succeeds and the success-path re-attach branch runs.
 */
function makeDraftGraphResultWithTimings() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision graph.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'frame' as const,
      _timings: {
        draft_graph: { total_ms: 123, stages: { parse: 12, prior: 7, validate: 5 } },
      },
    },
    commitPerformed: true,
  };
}

async function postTurn(
  app: FastifyInstance,
  options: { headers?: Record<string, string>; turnId: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    headers: options.headers,
    payload: {
      kind: 'message',
      turn_id: options.turnId,
      scenario_id: SCENARIO_ID,
      stage: 'frame',
      message: LONG_BRIEF,
      turn_class: 'frame',
      source: 'composer',
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('route-v2 — two-gate `_timings` opt-in', () => {
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
    dispatchDraftGraphMock.mockReset();
    dispatchDraftGraphMock.mockResolvedValue(makeDraftGraphResultWithTimings());
    appendMock.mockClear();
    // Reset both gates to off before each case.
    configHolder.cee.timingDebugEnabled = false;
  });

  // Case 1 — env OFF, header absent → no _timings.
  it('env OFF + no debug header → response does NOT carry `_timings`', async () => {
    configHolder.cee.timingDebugEnabled = false;
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444401',
    });
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_timings');
    // Product fields still emit normally.
    expect(body.response_version).toBe(2);
    expect(body.assistant_text).toBe('Drafted a decision graph.');
  });

  // Case 2 — env ON, header absent → no _timings (the captured failure).
  it('env ON + no debug header → response does NOT carry `_timings` (the captured browser-failure scenario)', async () => {
    configHolder.cee.timingDebugEnabled = true;
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444402',
    });
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_timings');
    expect(body.response_version).toBe(2);
  });

  // Case 3 — env ON, header `timings` → _timings emitted.
  it('env ON + `X-Olumi-Debug: timings` → response carries `_timings`', async () => {
    configHolder.cee.timingDebugEnabled = true;
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444403',
      headers: { 'x-olumi-debug': 'timings' },
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty('_timings');
    expect((body._timings as Record<string, unknown>).draft_graph).toBeDefined();
    expect((body._timings as { draft_graph: { total_ms: number } }).draft_graph.total_ms)
      .toBe(123);
  });

  // Case 4 — env OFF, header `timings` → no _timings (server permission gate).
  it('env OFF + `X-Olumi-Debug: timings` → response does NOT carry `_timings` (header alone is insufficient)', async () => {
    configHolder.cee.timingDebugEnabled = false;
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444404',
      headers: { 'x-olumi-debug': 'timings' },
    });
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_timings');
  });

  // Case 5 — env ON, header carries a different token (no `timings`).
  it('env ON + `X-Olumi-Debug: diagnostics` (token mismatch) → response does NOT carry `_timings`', async () => {
    configHolder.cee.timingDebugEnabled = true;
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444405',
      headers: { 'x-olumi-debug': 'diagnostics' },
    });
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_timings');
  });

  // Case 6 — env ON, comma-separated header includes `timings`.
  it('env ON + `X-Olumi-Debug: diagnostics,timings` (comma list) → response carries `_timings`', async () => {
    configHolder.cee.timingDebugEnabled = true;
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444406',
      headers: { 'x-olumi-debug': 'diagnostics,timings' },
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty('_timings');
  });

  // Runtime guard for malformed upstream `_timings` (PR #182 round-3).
  // The upstream writer types its emit as `TurnTimingsBlock`, but a future
  // regression could attach a string / number / array. The route's
  // `coerceTurnTimingsBlock` guard drops anything that isn't a plain
  // object, so garbage cannot ship on the wire even with both gates on.
  it('malformed upstream `_timings` (string) + env on + header on → no `_timings` on wire (runtime guard drops it)', async () => {
    configHolder.cee.timingDebugEnabled = true;
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: {
        response_version: 2 as const,
        assistant_text: 'Drafted a decision graph.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'frame' as const,
        // Intentionally malformed: a string where `TurnTimingsBlock`
        // is expected. The runtime guard MUST drop this.
        _timings: 'this should never reach the wire' as unknown as Record<
          string,
          unknown
        >,
      },
      commitPerformed: true,
    });
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444409',
      headers: { 'x-olumi-debug': 'timings' },
    });
    expect(status).toBe(200);
    // Product fields still emit.
    expect(body.response_version).toBe(2);
    expect(body.assistant_text).toBe('Drafted a decision graph.');
    // Malformed `_timings` was dropped by the runtime guard, not
    // re-attached, not silently wrapped.
    expect(body).not.toHaveProperty('_timings');
  });

  it('malformed upstream `_timings` (Date instance) + env on + header on → no `_timings` on wire (prototype check rejects non-plain-object)', async () => {
    // Date passes `typeof === 'object'` AND is not an array, so a
    // naive `typeof + !Array.isArray` guard would let it through.
    // The prototype check (`proto === Object.prototype || null`) is
    // what rejects it. Same logic applies to class instances, Map,
    // Set, Buffer, Promise, etc.
    configHolder.cee.timingDebugEnabled = true;
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: {
        response_version: 2 as const,
        assistant_text: 'Drafted a decision graph.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'frame' as const,
        _timings: new Date('2026-05-17T12:00:00Z') as unknown as Record<string, unknown>,
      },
      commitPerformed: true,
    });
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444411',
      headers: { 'x-olumi-debug': 'timings' },
    });
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_timings');
  });

  it('malformed upstream `_timings` (array) + env on + header on → no `_timings` on wire (runtime guard drops it)', async () => {
    configHolder.cee.timingDebugEnabled = true;
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: {
        response_version: 2 as const,
        assistant_text: 'Drafted a decision graph.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'frame' as const,
        // Arrays are also `typeof === 'object'` — the guard's
        // `Array.isArray` check is the one that rejects this.
        _timings: ['unexpected', 'array'] as unknown as Record<string, unknown>,
      },
      commitPerformed: true,
    });
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444410',
      headers: { 'x-olumi-debug': 'timings' },
    });
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_timings');
  });

  // Validation-fallback precedence — when the product envelope is malformed,
  // the route returns the typed fallback envelope AND does NOT re-attach
  // `_timings` even when both gates pass. The strip-then-validate-then-
  // re-attach sequence (route-v2.ts:236-298) explicitly only re-attaches
  // `_timings` on the success path; the fallback envelope is debug-free
  // by construction so a half-broken response can't leak the debug
  // surface with a misleading 200.
  it('malformed product envelope + env on + header on → typed fallback envelope, NO `_timings`', async () => {
    configHolder.cee.timingDebugEnabled = true;
    // Canned dispatch result with a `_timings` block AND a malformed
    // product envelope: `response_version` is a string instead of the
    // literal `2`, which makes `OlumiResponseSchema.safeParse` fail.
    // The route should fall back to the typed BoundaryError envelope.
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: {
        // Intentionally malformed: schema requires z.literal(2).
        response_version: 'NOT_TWO' as unknown as 2,
        assistant_text: 'Drafted a decision graph.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'frame' as const,
        _timings: {
          draft_graph: { total_ms: 123, stages: { parse: 12 } },
        },
      },
      commitPerformed: true,
    });
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444408',
      headers: { 'x-olumi-debug': 'timings' },
    });
    // Fallback envelope MUST NOT carry `_timings`, regardless of gate state.
    expect(body).not.toHaveProperty('_timings');
    // Route still serves an HTTP 200 — the fallback IS a successful
    // wire response, just with a typed-error shape rather than the
    // success-path product fields. The schema fallback path lives at
    // route-v2.ts (validateEgress → finaliseV5Response(fallback)).
    expect(status).toBe(200);
    // The fallback envelope is still finalised — `response_version: 2`
    // is the schema requirement, so the fallback must satisfy it even
    // when the upstream candidate didn't.
    expect(body.response_version).toBe(2);
  });

  // Server-side validation precedence — product envelope is validated
  // BEFORE the debug field is reattached. The strip-then-validate-then-
  // reattach sequence is the contract that lets us safely accept debug
  // fields that would otherwise fail the boundary's `.strict()` schema.
  it('product envelope is validated before `_timings` is re-attached (strip → validate → re-attach)', async () => {
    configHolder.cee.timingDebugEnabled = true;
    // The canned response above has `_timings` attached BEFORE the route
    // sees it. If the route validated the candidate WITH `_timings` still
    // present, the strict schema would reject it and the request would
    // fall back to the typed-error envelope. The fact that we get a
    // success-shaped response (with re-attached _timings) when both gates
    // pass proves the strip-then-validate sequence is intact.
    const { status, body } = await postTurn(app, {
      turnId: '44444444-4444-4444-8444-444444444407',
      headers: { 'x-olumi-debug': 'timings' },
    });
    expect(status).toBe(200);
    // Success-shaped product response.
    expect(body.response_version).toBe(2);
    expect(body.assistant_text).toBe('Drafted a decision graph.');
    expect(body.stage_indicator).toBe('frame');
    // AND the debug field re-attached post-validation.
    expect(body).toHaveProperty('_timings');
  });
});
