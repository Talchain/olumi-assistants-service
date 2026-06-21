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

const configHolder = {
  cee: { timingDebugEnabled: false, turnDebugEnabled: false, contextSummaryEnabled: false },
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
  });

  it('flag OFF → response does NOT carry `_context_summary`', async () => {
    configHolder.cee.contextSummaryEnabled = false;
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666601');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_context_summary');
    expect(body.response_version).toBe(2);
  });

  it('flag ON → redacted `_context_summary` present, statuses/predicates/counts only', async () => {
    configHolder.cee.contextSummaryEnabled = true;
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666602');
    expect(status).toBe(200);
    expect(body).toHaveProperty('_context_summary');
    const cs = body._context_summary as Record<string, any>;
    expect(cs.version).toBe('1.0.0');
    expect(cs.analysis_state.freshness).toBe('fresh');
    expect(cs.analysis_state.usable_for_chips).toBe(true);
    expect(cs.analysis_state.requires_rerun).toBe(false);
    expect(cs.graph_counts).toEqual({ nodes: 4, edges: 1, options: 2, goals: 1 });
    // Honest nullability — not threaded at the route seam yet.
    expect(cs.recent_turn_count).toBeNull();
    expect(cs.capabilities_present).toBeNull();
  });

  it('flag ON → `_context_summary` leaks no user text or graph content', async () => {
    configHolder.cee.contextSummaryEnabled = true;
    const { body } = await postTurn(app, '66666666-6666-4666-8666-666666666603');
    const json = JSON.stringify(body._context_summary);
    expect(json).not.toContain(LONG_BRIEF);
    expect(json).not.toContain(LEAK_CANARY);
    expect(json).not.toContain('Option A');
  });

  it('flag ON but no freshness on the result → no `_context_summary` (never fabricated)', async () => {
    configHolder.cee.contextSummaryEnabled = true;
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftResult({ withFreshness: false }));
    const { status, body } = await postTurn(app, '66666666-6666-4666-8666-666666666604');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_context_summary');
  });
});
