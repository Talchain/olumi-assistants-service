/**
 * M3 — flag-gated `_context_summary` on /orchestrate/v2/turn.
 *
 * Contract:
 *   - `config.cee.contextSummaryEnabled === false` ⇒ no `_context_summary`
 *     on the wire (default; additive no-op).
 *   - `=== true` ⇒ a redacted `_context_summary` is attached, built from the
 *     dispatch result's `freshness` + `analysisReady` + `graph`, carrying
 *     statuses / predicates / counts / hashes only — never raw user text or
 *     graph content.
 *   - With the flag on but no canonical source on the result (no freshness)
 *     ⇒ still no `_context_summary` (we never fabricate one).
 *
 * Rides the same strip → validate → re-attach machinery the `_timings` /
 * `_diagnostic_trace` surfaces use; mirrors route-v2-debug-fields.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Assert the version against the shared constant, not a hard-coded literal, so
// an additive `_context_summary` version bump never leaves this advisory
// integration test stale (Track 2 bumped it 1.0.0 → 1.1.0).
import { V5_CONTEXT_SUMMARY_VERSION } from '../../../src/orchestrator-v5/context/build-context-summary.js';

const configHolder = {
  cee: {
    timingDebugEnabled: false,
    turnDebugEnabled: false,
    contextSummaryEnabled: false,
    coachingStatePackEnabled: false,
  },
  features: { optionShortcutRepair: true, diagnosticTraceEnabled: false },
};
vi.mock('../../../src/config/index.js', () => ({
  config: configHolder,
  isProduction: () => false,
}));

const dispatchDraftGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
const LONG_BRIEF = 'Should we expand the product into the German market next quarter or hold?';
const LEAK_CANARY = 'LEAKCANARY_NODE_LABEL';

function freshDerivation() {
  return {
    freshness: 'fresh' as const,
    reason: 'graph_hash_match' as const,
    selected_fact_index: 0,
    graph_hash_at_run: 'HASH_A',
    current_graph_hash: 'HASH_A',
    computed_at: '2026-05-01T00:00:00.000Z',
  };
}

function readyAnalysis() {
  return {
    status: 'ready',
    goal_node_id: 'goal',
    options: [
      { option_id: 'a', label: 'Option A', status: 'ready', interventions: {} },
      { option_id: 'b', label: 'Option B', status: 'ready', interventions: {} },
    ],
  };
}

function canaryGraph() {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: LEAK_CANARY },
      { id: 'a', kind: 'option', label: 'Option A' },
      { id: 'b', kind: 'option', label: 'Option B' },
      { id: 'f', kind: 'factor', label: 'Factor' },
    ],
    edges: [{ from: 'f', to: 'goal' }],
  };
}

function makeDraftResult(opts: { withFreshness: boolean }) {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision graph.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'frame' as const,
    },
    commitPerformed: true,
    analysisReady: readyAnalysis(),
    graph: canaryGraph(),
    ...(opts.withFreshness ? { freshness: freshDerivation() } : {}),
  };
}

async function postTurn(app: FastifyInstance, turnId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: turnId,
      scenario_id: SCENARIO_ID,
      stage: 'frame',
      message: LONG_BRIEF,
      turn_class: 'frame',
      source: 'composer',
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

describe('route-v2 — flag-gated `_context_summary`', () => {
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
    dispatchDraftGraphMock.mockResolvedValue(makeDraftResult({ withFreshness: true }));
    appendMock.mockClear();
    configHolder.cee.contextSummaryEnabled = false;
    configHolder.cee.coachingStatePackEnabled = false;
  });

  it('flag OFF → no `_context_summary`, and prose carries no hash/diagnostic field', async () => {
    configHolder.cee.contextSummaryEnabled = false;
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666601');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_context_summary');
    expect(body.response_version).toBe(2);
    // Behaviour 10: the graph hash + freshness_reason codes must not appear
    // in user-facing PROSE. (analysis_ready.graph_hash_at_run is a separate,
    // documented structured wire field — the state-trust contract — that the
    // UI reads to verify freshness; it is NOT prose and NOT in scope here.)
    expect(String(body.assistant_text)).not.toContain('HASH_A');
    expect(String(body.assistant_text)).not.toContain('graph_hash_match');
  });

  it('flag ON → redacted `_context_summary` present, statuses/predicates/counts only', async () => {
    configHolder.cee.contextSummaryEnabled = true;
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666602');
    expect(status).toBe(200);
    expect(body).toHaveProperty('_context_summary');
    const cs = body._context_summary as Record<string, any>;
    expect(cs.version).toBe(V5_CONTEXT_SUMMARY_VERSION);
    expect(cs.analysis_state.freshness).toBe('fresh');
    expect(cs.analysis_state.usable_for_chips).toBe(true);
    expect(cs.analysis_state.requires_rerun).toBe(false);
    expect(cs.graph_counts).toEqual({ nodes: 4, edges: 1, options: 2, goals: 1 });
    // Honest nullability — not threaded at the route seam yet.
    expect(cs.recent_turn_count).toBeNull();
    expect(cs.capabilities_present).toBeNull();
  });

  it('flag ON → summary is redaction-clean and user-facing prose carries no hash/diagnostic/brief', async () => {
    configHolder.cee.contextSummaryEnabled = true;
    const { body } = await postTurn(app, '66666666-6666-4666-8666-666666666603');
    // The summary itself is redaction-clean (no user text / graph content).
    const summaryJson = JSON.stringify(body._context_summary);
    expect(summaryJson).not.toContain(LONG_BRIEF);
    expect(summaryJson).not.toContain(LEAK_CANARY);
    expect(summaryJson).not.toContain('Option A');
    // Behaviour 10: user-facing PROSE must not leak the graph hash digest,
    // the freshness_reason code, or the brief. (The hash legitimately lives
    // inside _context_summary and the structured analysis_ready field; the
    // contract is specifically that PROSE stays clean.)
    const prose = String(body.assistant_text);
    expect(prose).not.toContain('HASH_A');
    expect(prose).not.toContain('graph_hash_match');
    expect(prose).not.toContain(LONG_BRIEF);
  });

  it('flag ON but no freshness on the result → no `_context_summary` (never fabricated)', async () => {
    configHolder.cee.contextSummaryEnabled = true;
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftResult({ withFreshness: false }));
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666604');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_context_summary');
  });

  it('flag ON + egress validation fails → typed-fallback 200 carries NO `_context_summary`', async () => {
    // The re-attach is gated on `egress.ok`; the strip removes any
    // body-attached copy. Prove the fallback envelope stays debug-free even
    // when the flag is on AND an upstream body pre-attached a summary.
    configHolder.cee.contextSummaryEnabled = true;
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: {
        // Malformed product envelope: response_version must be the literal 2,
        // so OlumiResponseSchema.safeParse fails → typed fallback path.
        response_version: 'NOT_TWO' as unknown as 2,
        assistant_text: 'Drafted a decision graph.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'frame' as const,
        // Upstream body pre-attach that the strip MUST drop.
        _context_summary: { version: '1.0.0', stale: 'leak' } as unknown,
      },
      commitPerformed: true,
      analysisReady: readyAnalysis(),
      graph: canaryGraph(),
      freshness: freshDerivation(),
    });
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666605');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_context_summary');
    // Fallback envelope still satisfies the schema (response_version: 2).
    expect(body.response_version).toBe(2);
  });

  // ── Double-gate matrix: coaching_state_pack appears ONLY when BOTH
  //    contextSummaryEnabled AND coachingStatePackEnabled are on. The draft
  //    dispatch threads freshness but NO canonicalState, so the route composes
  //    the partial fallback ⇒ canonical_state_source === 'route_fallback'.

  it('both flags OFF → no `_context_summary` (so no coaching_state_pack)', async () => {
    configHolder.cee.contextSummaryEnabled = false;
    configHolder.cee.coachingStatePackEnabled = false;
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666606');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_context_summary');
  });

  it('contextSummary OFF + pack ON → outer gate dominates: still no `_context_summary`', async () => {
    // The pack flag must NOT leak the diagnostic envelope past the first gate.
    configHolder.cee.contextSummaryEnabled = false;
    configHolder.cee.coachingStatePackEnabled = true;
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666607');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_context_summary');
  });

  it('contextSummary ON + pack OFF → `_context_summary` present, NO coaching_state_pack', async () => {
    configHolder.cee.contextSummaryEnabled = true;
    configHolder.cee.coachingStatePackEnabled = false;
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666608');
    expect(status).toBe(200);
    expect(body).toHaveProperty('_context_summary');
    const cs = body._context_summary as Record<string, unknown>;
    expect('coaching_state_pack' in cs).toBe(false);
    // Provenance recorded even without the pack: draft path == partial fallback.
    expect(cs.canonical_state_source).toBe('route_fallback');
  });

  it('BOTH flags ON → `_context_summary` carries a redacted coaching_state_pack', async () => {
    configHolder.cee.contextSummaryEnabled = true;
    configHolder.cee.coachingStatePackEnabled = true;
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666609');
    expect(status).toBe(200);
    const cs = body._context_summary as Record<string, any>;
    expect(cs.coaching_state_pack).toBeDefined();
    expect(cs.coaching_state_pack.freshness).toBe('fresh');
    expect(cs.coaching_state_pack.analysis_present).toBe(true);
    expect(cs.canonical_state_source).toBe('route_fallback');
    // Redaction: the hash-free pack must not carry the graph hash digest.
    expect(JSON.stringify(cs.coaching_state_pack)).not.toContain('HASH_A');
    // And no graph content / brief leaks via the pack.
    expect(JSON.stringify(cs.coaching_state_pack)).not.toContain(LEAK_CANARY);
  });
});
