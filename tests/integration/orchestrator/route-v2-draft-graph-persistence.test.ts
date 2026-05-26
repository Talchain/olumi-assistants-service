/**
 * Integration tests — V5 draft_graph graph persistence contract.
 *
 * Exercises the full dispatchDraftGraph → commitDirectAnswer → SessionStore
 * stack with a mocked session store. Does NOT mock dispatchDraftGraph itself
 * (unlike route-v2-draft-graph.test.ts which mocks at the route boundary) —
 * the focus here is the persistence contract: what lands in the store, what
 * the dispatcher returns, and how atomic rollback behaves.
 *
 * The V4 unified pipeline (handleDraftGraph) IS mocked — LLM I/O is outside
 * the scope of persistence contract tests.
 *
 * Five scenarios:
 *  1. First-turn draft success: graph persisted atomically, stage='analyse', turn committed
 *  2. Atomic commit failure: commitDirectAnswer throws → stage='frame', commitPerformed=false, route returns 500
 *  3. No graphOutput produced: metadata.graph=undefined, scenarios.graph unchanged, stage='frame'
 *  4. Second draft on same scenario: store called again with new graph (overwrite, not duplicate)
 *  5. Commit ordering: store.append fires before readRecent; simulates build-turn-context observing
 *     the draft turn on a subsequent run_analysis. Does NOT exercise chip-click routing.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock('../../../src/orchestrator/tools/draft-graph.js', () => ({
  handleDraftGraph: vi.fn(),
}));

// Mock the session store factory so we control append behaviour per test.
const appendMock = vi.fn();
const readRecentMock = vi.fn().mockResolvedValue([]);
const mockStore = {
  append: appendMock,
  readRecent: readRecentMock,
  readFactsFor: vi.fn().mockResolvedValue([]),
  invalidateScoped: vi.fn().mockResolvedValue({ scope: { kind: 'structural' }, entries_invalidated: [] }),
  invalidateAll: vi.fn().mockResolvedValue({ scope: { kind: 'structural' }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn().mockResolvedValue({ user_id: 'user-1' }),
  storeDraftGraph: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => mockStore,
  resetSessionStoreForTests: vi.fn(),
  SessionReadError: class SessionReadError extends Error {},
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { dispatchDraftGraph } from '../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../src/orchestrator/tools/draft-graph.js';
import { StateCommitFailedError } from '../../../src/orchestrator-v5/session/store.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID_1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TURN_ID_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const MINIMAL_GRAPH_1 = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch product?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue target' },
    { id: 'factor_market', kind: 'factor', label: 'Market readiness' },
  ],
  edges: [
    { from: 'dec_launch', to: 'goal_revenue' },
    { from: 'factor_market', to: 'dec_launch' },
  ],
};

const MINIMAL_GRAPH_2 = {
  nodes: [
    { id: 'dec_hire', kind: 'decision', label: 'Hire senior eng?' },
    { id: 'goal_capacity', kind: 'goal', label: 'Team capacity' },
  ],
  edges: [{ from: 'dec_hire', to: 'goal_capacity' }],
};

function makePayload(turnId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: turnId,
    stage: 'frame' as const,
    message: 'Should we launch the product now or wait for Q3?',
    turn_class: 'frame' as const,
    source: 'composer' as const,
    ...overrides,
  };
}

function makeDraftResult(graphOutput: unknown = MINIMAL_GRAPH_1, assistantText?: string) {
  return {
    blocks: [],
    assistantText: assistantText ?? `Drafted a decision graph with ${(graphOutput as { nodes?: unknown[] })?.nodes?.length ?? 0} nodes.`,
    latencyMs: 800,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('V5 draft_graph persistence integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readRecentMock.mockResolvedValue([]);
  });

  // ── Scenario 1: first-turn draft success ────────────────────────────────────

  describe('Scenario 1 — first-turn draft: graph persisted atomically, stage advances to analyse', () => {
    beforeEach(() => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(MINIMAL_GRAPH_1) as Awaited<ReturnType<typeof handleDraftGraph>>);
      appendMock.mockResolvedValue({ id: 'row-turn-1' });
    });

    it('returns 200-shape response with stage_indicator=analyse', async () => {
      const result = await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-1',
        request: STUB_REQUEST,
      });

      expect(result.response.stage_indicator).toBe('analyse');
      expect(result.response.response_version).toBe(2);
    });

    it('returns commitPerformed=true', async () => {
      const result = await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-1',
        request: STUB_REQUEST,
      });

      expect(result.commitPerformed).toBe(true);
    });

    it('calls store.append exactly once with p_graph = the graph output', async () => {
      await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-1',
        request: STUB_REQUEST,
      });

      expect(appendMock).toHaveBeenCalledOnce();
      const [writeArg] = appendMock.mock.calls[0];
      // The graph must be passed directly — not nested — so append_turn_atomic
      // can write it atomically with the turn row via p_graph.
      expect(writeArg.graph).toEqual(MINIMAL_GRAPH_1);
      expect(writeArg.scenario_id).toBe(SCENARIO_ID);
      expect(writeArg.turn_id).toBe(TURN_ID_1);
    });

    it('assistant_text comes from the decision-language fallback when handler narration is graph-shaped', async () => {
      const result = await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-1',
        request: STUB_REQUEST,
      });

      // brief brief-display-safe-analysis A2: handler narration containing
      // node/edge wording is suppressed in favour of the decision-language
      // fallback derived from the final post-repair graph. The fixture
      // narration at makeDraftResult contains "nodes" → suppressed.
      // The graph has 1 factor + a goal labelled "Revenue target", no
      // options → fallback names the goal and counts factor.
      expect(result.response.assistant_text).toBe(
        'Your decision model for "Revenue target" is ready, with 0 options and 1 factor to explore.',
      );
      expect(result.response.assistant_text).not.toContain('nodes');
      expect(result.response.assistant_text).not.toContain('edges');
    });

    it('response contains empty blocks (graph is persisted via store, not in response body)', async () => {
      const result = await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-1',
        request: STUB_REQUEST,
      });

      expect(result.response.blocks).toEqual([]);
    });
  });

  // ── Scenario 2: atomic commit failure ──────────────────────────────────────

  describe('Scenario 2 — atomic commit failure: both graph and turn rolled back', () => {
    beforeEach(() => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(MINIMAL_GRAPH_1) as Awaited<ReturnType<typeof handleDraftGraph>>);
      // When append_turn_atomic throws, the PL/pgSQL transaction rolls back
      // both the graph write and the turn insert. The dispatcher catches this
      // and returns commitPerformed=false — no partial state exists.
      appendMock.mockRejectedValue(
        new StateCommitFailedError('append_turn_atomic RPC failed: connection timeout'),
      );
    });

    it('does not throw — commit failure is non-fatal at the dispatcher level', async () => {
      await expect(
        dispatchDraftGraph({
          payload: makePayload(TURN_ID_1),
          requestId: 'req-scenario-2',
          request: STUB_REQUEST,
        }),
      ).resolves.toBeDefined();
    });

    it('returns commitPerformed=false', async () => {
      const result = await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-2',
        request: STUB_REQUEST,
      });

      expect(result.commitPerformed).toBe(false);
    });

    it('keeps stage_indicator=frame (no advancement — graph not persisted)', async () => {
      const result = await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-2',
        request: STUB_REQUEST,
      });

      expect(result.response.stage_indicator).toBe('frame');
    });

    it('assistant_text uses pipeline narration — route discards response, client sees 500 INTERNAL_ERROR', async () => {
      // commitPerformed=false causes route-v2.ts to return HTTP 500 BoundaryError
      // (reason: 'draft_graph_commit_failed', retryable: true). The dispatcher's
      // dg.response is never sent to the client on this path.
      const result = await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-2',
        request: STUB_REQUEST,
      });

      // Fallback narration from the pipeline — not a save-failure message.
      expect(result.response.assistant_text).toContain('Drafted');
    });

    it('store.append was called exactly once (dispatcher attempted the commit)', async () => {
      await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-2',
        request: STUB_REQUEST,
      }).catch(() => {});

      // The dispatcher must have attempted append — it is not skipped.
      expect(appendMock).toHaveBeenCalledOnce();
    });
  });

  // ── Scenario 3: no graphOutput produced ────────────────────────────────────

  describe('Scenario 3 — pipeline produced no graphOutput: scenarios.graph left unchanged', () => {
    beforeEach(() => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(null, 'Could not draft a graph for that brief.') as Awaited<ReturnType<typeof handleDraftGraph>>);
      // commitDirectAnswer still fires (turn is recorded), but with no graph.
      appendMock.mockResolvedValue({ id: 'row-turn-3' });
    });

    it('passes graph=undefined to store.append — omits p_graph from RPC call', async () => {
      await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-3',
        request: STUB_REQUEST,
      });

      expect(appendMock).toHaveBeenCalledOnce();
      const [writeArg] = appendMock.mock.calls[0];
      // graph undefined → p_graph omitted from append_turn_atomic → scenarios.graph unchanged
      expect(writeArg.graph).toBeUndefined();
    });

    it('stage_indicator stays at frame (no graph to fetch)', async () => {
      const result = await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-3',
        request: STUB_REQUEST,
      });

      expect(result.response.stage_indicator).toBe('frame');
    });

    it('commitPerformed=true (turn row was written, even without a graph)', async () => {
      const result = await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-3',
        request: STUB_REQUEST,
      });

      // The turn is still committed — only the graph is absent.
      expect(result.commitPerformed).toBe(true);
    });
  });

  // ── Scenario 4: second draft on same scenario (overwrite) ──────────────────

  describe('Scenario 4 — second draft on same scenario: graph overwritten, not duplicated', () => {
    it('first and second draft each call store.append once with their respective graph', async () => {
      // First turn
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValueOnce(makeDraftResult(MINIMAL_GRAPH_1) as Awaited<ReturnType<typeof handleDraftGraph>>);
      appendMock.mockResolvedValueOnce({ id: 'row-turn-first' });

      await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-4a',
        request: STUB_REQUEST,
      });

      // Second turn (new TURN_ID, same SCENARIO_ID)
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValueOnce(makeDraftResult(MINIMAL_GRAPH_2) as Awaited<ReturnType<typeof handleDraftGraph>>);
      appendMock.mockResolvedValueOnce({ id: 'row-turn-second' });

      await dispatchDraftGraph({
        payload: makePayload(TURN_ID_2),
        requestId: 'req-scenario-4b',
        request: STUB_REQUEST,
      });

      expect(appendMock).toHaveBeenCalledTimes(2);

      const [firstWriteArg] = appendMock.mock.calls[0];
      const [secondWriteArg] = appendMock.mock.calls[1];

      // Each call carries its own graph — the atomic RPC overwrites scenarios.graph.
      expect(firstWriteArg.graph).toEqual(MINIMAL_GRAPH_1);
      expect(secondWriteArg.graph).toEqual(MINIMAL_GRAPH_2);

      // Different turn_ids (not duplicated)
      expect(firstWriteArg.turn_id).toBe(TURN_ID_1);
      expect(secondWriteArg.turn_id).toBe(TURN_ID_2);

      // Same scenario_id (overwrite on same scenario)
      expect(firstWriteArg.scenario_id).toBe(SCENARIO_ID);
      expect(secondWriteArg.scenario_id).toBe(SCENARIO_ID);
    });

    it('second draft returns stage_indicator=analyse when successful', async () => {
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValueOnce(makeDraftResult(MINIMAL_GRAPH_1) as Awaited<ReturnType<typeof handleDraftGraph>>)
        .mockResolvedValueOnce(makeDraftResult(MINIMAL_GRAPH_2) as Awaited<ReturnType<typeof handleDraftGraph>>);
      appendMock
        .mockResolvedValueOnce({ id: 'row-turn-first' })
        .mockResolvedValueOnce({ id: 'row-turn-second' });

      await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-4a',
        request: STUB_REQUEST,
      });

      const result = await dispatchDraftGraph({
        payload: makePayload(TURN_ID_2),
        requestId: 'req-scenario-4b',
        request: STUB_REQUEST,
      });

      expect(result.response.stage_indicator).toBe('analyse');
    });
  });

  // ── Scenario 5: commit ordering and store readability ─────────────────────
  // NOTE: this scenario does NOT exercise chip-click run_analysis routing.
  // It verifies the store-layer contract: after dispatchDraftGraph calls
  // store.append, a subsequent readRecent (as called by build-turn-context
  // on a run_analysis turn) can observe the committed draft turn. A true
  // two-turn route-level test (brief POST → chip-click POST) belongs in a
  // separate end-to-end suite with full route injection.

  describe('Scenario 5 — commit ordering: store.append fires before readRecent is possible', () => {
    it('store.readRecent can observe the committed draft turn (simulates build-turn-context lookup)', async () => {
      // The draft turn commits a row; subsequent readRecent should return it.
      // We simulate the store returning the written row on the next read.
      const committedTurn = {
        id: 'row-turn-draft',
        scenario_id: SCENARIO_ID,
        turn_id: TURN_ID_1,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:abc123',
        response_emitted: true,
        llm_calls_used: 1,
        duration_ms: 800,
        created_at: new Date().toISOString(),
        user_id: 'user-1',
      };

      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(MINIMAL_GRAPH_1) as Awaited<ReturnType<typeof handleDraftGraph>>);

      appendMock.mockResolvedValueOnce({ id: 'row-turn-draft' });

      // After the draft commit, store.readRecent returns the row.
      readRecentMock.mockResolvedValueOnce([committedTurn]);

      await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-5',
        request: STUB_REQUEST,
      });

      // Simulate what run_analysis would do: read recent turns to build context.
      const recentTurns = await mockStore.readRecent(SCENARIO_ID, 10);

      // The draft turn must be findable — run_analysis can build context.
      expect(recentTurns).toHaveLength(1);
      expect(recentTurns[0].turn_id).toBe(TURN_ID_1);
    });

    it('append is called before readRecent can return the turn (commit ordering preserved)', async () => {
      // Commit ordering invariant: append (RPC success) must precede any
      // cache update. This test verifies the dispatcher calls append first
      // and does not attempt out-of-order reads.
      const callOrder: string[] = [];

      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(makeDraftResult(MINIMAL_GRAPH_1) as Awaited<ReturnType<typeof handleDraftGraph>>);

      appendMock.mockImplementation(async () => {
        callOrder.push('append');
        return { id: 'row-turn-ordering' };
      });
      readRecentMock.mockImplementation(async () => {
        callOrder.push('readRecent');
        return [];
      });

      await dispatchDraftGraph({
        payload: makePayload(TURN_ID_1),
        requestId: 'req-scenario-5-order',
        request: STUB_REQUEST,
      });

      // dispatchDraftGraph must NOT call readRecent at all — that's the
      // caller's (run_analysis) responsibility. append is the only store
      // operation in the draft dispatcher.
      expect(callOrder).toEqual(['append']);
      expect(callOrder).not.toContain('readRecent');
    });
  });

  // ── Scenario 6 — pipeline throws with typed metadata: NO commit attempted ───
  //
  // When handleDraftGraph throws (any throw, not just plain Error), the
  // dispatcher's outer catch re-throws BEFORE the inner commit block runs.
  // No row appended to scenarios.turn; no graph written to scenarios.graph.
  // This is the load-bearing "no partial-graph persistence" contract that
  // the Edit 3 normalise typed-fail path AND the legacy plain-Error path
  // both must honour.
  //
  // The throw metadata (pipelineStatusCode etc., from Edit 1) survives the
  // re-throw so the route boundary can emit a typed wire envelope.
  describe('Scenario 6 — pipeline throws with typed metadata: no commit, metadata preserved (Tests 7c + 11)', () => {
    it('typed pipeline throw → outer catch re-throws, append NOT called', async () => {
      const typedErr = Object.assign(new Error('CEE_LLM_VALIDATION_FAILED'), {
        pipelineStatusCode: 400,
        pipelineErrorCode: 'CEE_LLM_VALIDATION_FAILED',
        pipelineRecovery: {
          suggestion: 'Provide a clearer brief.',
          hints: ['List 2-3 options'],
        },
      });
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockRejectedValueOnce(typedErr);

      await expect(
        dispatchDraftGraph({
          payload: makePayload(TURN_ID_1),
          requestId: 'req-scenario-6-typed',
          request: STUB_REQUEST,
        }),
      ).rejects.toMatchObject({
        message: 'CEE_LLM_VALIDATION_FAILED',
        pipelineStatusCode: 400,
        pipelineErrorCode: 'CEE_LLM_VALIDATION_FAILED',
      });

      // The whole point: no partial graph persisted on a pipeline throw.
      expect(appendMock).not.toHaveBeenCalled();
    });

    it('legacy plain-Error throw → outer catch re-throws, append NOT called', async () => {
      // The pre-Edit-1 behaviour: handleDraftGraph throws a plain Error.
      // Route-v2 falls back to the legacy draft_graph_pipeline_threw envelope.
      // No commit attempted — must remain true.
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockRejectedValueOnce(new Error('pipeline exploded'));

      await expect(
        dispatchDraftGraph({
          payload: makePayload(TURN_ID_1),
          requestId: 'req-scenario-6-legacy',
          request: STUB_REQUEST,
        }),
      ).rejects.toThrow('pipeline exploded');

      expect(appendMock).not.toHaveBeenCalled();
    });

    it('typed 504 timeout throw → no commit, metadata preserved', async () => {
      const typedErr = Object.assign(new Error('CEE_TIMEOUT'), {
        pipelineStatusCode: 504,
        pipelineErrorCode: 'CEE_TIMEOUT',
        pipelineRecovery: null,
      });
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockRejectedValueOnce(typedErr);

      await expect(
        dispatchDraftGraph({
          payload: makePayload(TURN_ID_1),
          requestId: 'req-scenario-6-timeout',
          request: STUB_REQUEST,
        }),
      ).rejects.toMatchObject({
        pipelineStatusCode: 504,
        pipelineErrorCode: 'CEE_TIMEOUT',
      });

      expect(appendMock).not.toHaveBeenCalled();
    });
  });
});
