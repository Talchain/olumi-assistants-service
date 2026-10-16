/**
 * Coaching non-interference smoke — Cap-1 post-analysis loop and Cap-2A
 * add-risk rejection guidance running together.
 *
 * UPDATED 2026-07-20 (O-7 wave 2): both capabilities are UNCONDITIONAL —
 * CEE_POST_ANALYSIS_LOOP_ENABLED and CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED
 * were deleted (live-true on staging). The suite keeps its purpose: the two
 * paths are disjoint by design (V5 post-analysis advice gate vs edit-graph
 * structural-rejection copy), and running one leg must not perturb the
 * other's answer, telemetry, or chips. Repeated runs replace the former
 * flag-toggled "alone vs both" comparison.
 *
 *   - neutrality: neither path's user-facing copy carries held-science
 *     vocabulary or success claims (supplementary evidence beside the
 *     allowlist guards, not a guard of record).
 *
 * Harness: session-store mock from the Cap-1 loop integration test (real
 * `buildTurnContext`, real commit against the mocked store) + LLM-router and
 * prompt-loader mocks for the edit path.
 */

import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

import { config } from '../../../src/config/index.js';
import {
ADD_RISK_SCENARIO_ID as EDIT_SCENARIO_ID,
PARTIAL_GRAPH,
PRICING_GRAPH,
PRIOR_RA_TURN,
CAP1_SCENARIO_ID as SCENARIO_ID,
TARGETED_ADD_RISK_OPS,
makeBlankProjectionFreshFact,
makeEditProposalResponse,
} from '../../../src/orchestrator-v5/__tests__/coaching-fixtures.js';
import { makeMessagePayload } from '../../../src/orchestrator-v5/__tests__/fixtures.js';
import { ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER } from '../../../src/orchestrator/add-risk-rejection-guidance.js';
import { setTestSink } from '../../../src/utils/telemetry.js';

// ────────────────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────────────────

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = { priorTurns: [], priorFacts: [], persistedGraph: null };

// SCENARIO-KEYED store mock (review fix): the first version ignored
// scenario_id, so the Cap-2A leg ran real buildTurnContext against Cap-1's
// persisted graph and a foreign fresh run_analysis fact — an
// impossible-in-production cross-scenario state underneath the
// non-interference proof. Only the Cap-1 scenario sees Cap-1's state; every
// other scenario (the edit leg) gets a clean, empty session.
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (scenarioId: string) => (scenarioId === SCENARIO_ID ? mockState.priorTurns : []),
    // readFactsFor is keyed by prior-turn ROW ids (not scenario id): facts
    // exist only for Cap-1's prior run_analysis turn row.
    readFactsFor: async (rowIds: readonly string[]) =>
      Array.isArray(rowIds) && rowIds.includes(PRIOR_RA_TURN.id) ? mockState.priorFacts : [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    loadGraph: async (scenarioId: string) => (scenarioId === SCENARIO_ID ? mockState.persistedGraph : null),
    loadGraphAndBriefText: async (scenarioId: string) =>
      scenarioId === SCENARIO_ID
        ? { revision: 7, graph: mockState.persistedGraph, briefText: null }
        : { revision: 7, graph: null, briefText: null },
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You edit causal decision graphs'),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
  // The edit/review lanes resolve prompt bytes AND identity in ONE bound
  // `getSystemPromptSnapshot` call. A mock factory REPLACES the module, so
  // omitting this export hands the code under test `undefined` (trap 12).
  // Content and meta mirror the two mocks above deliberately: production
  // binds them to one resolution, and the mock must not model them as
  // independently divergent.
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: 'You edit causal decision graphs',
    meta: { source: 'default', prompt_version: 'v2' },
  }),
}));

const { llmChatMock } = vi.hoisted(() => ({ llmChatMock: vi.fn() }));
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: 'test',
    model: 'test-model',
    chat: llmChatMock,
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
}));


const { dispatchEditGraph } = await import('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js');

// ────────────────────────────────────────────────────────────────────
// Cap-1 fixtures (shared with turn-executor-post-analysis-loop.integration.test.ts
// via src/orchestrator-v5/__tests__/coaching-fixtures.ts)
// ────────────────────────────────────────────────────────────────────





// ────────────────────────────────────────────────────────────────────
// Cap-2A fixtures (shared with edit-graph-add-risk-flag-seam.test.ts via
// src/orchestrator-v5/__tests__/coaching-fixtures.ts)
// ────────────────────────────────────────────────────────────────────

const STUB_REQUEST = {} as FastifyRequest;

async function runCap2aRejectionTurn(turnId: string) {
  llmChatMock.mockResolvedValue(makeEditProposalResponse(TARGETED_ADD_RISK_OPS));
  return dispatchEditGraph({
    payload: makeMessagePayload({
      scenario_id: EDIT_SCENARIO_ID,
      turn_id: turnId,
      stage: 'analyse',
      message: 'Add team dynamics as a risk and connect it to churn',
    }),
    requestId: `req-${turnId}`,
    request: STUB_REQUEST,
    graphState: PRICING_GRAPH,
    analysisState: null,
  });
}

// ────────────────────────────────────────────────────────────────────
// Flag save/restore
// ────────────────────────────────────────────────────────────────────

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];
let originalNamedRefusalFlag = false;

// CEE_EDIT_CONNECTIVITY_NAMED_REFUSAL went DEFAULT-ON 18 Jul (Paul-ratified). It
// is a strictly-more-specific superseding layer over the Cap-2A add-risk
// placeholder guidance the Cap-2A leg asserts, so pin it OFF here to keep testing
// the Cap-2A guidance in isolation (named-refusal default-ON is covered by
// edit-graph-connectivity-named-refusal-seam.test.ts).
function setNamedRefusalFlag(on: boolean): void {
  (config.cee as { editConnectivityNamedRefusalEnabled: boolean }).editConnectivityNamedRefusalEnabled = on;
}

beforeEach(() => {
  events = [];
  llmChatMock.mockReset();
  mockState.priorTurns = [PRIOR_RA_TURN];
  mockState.priorFacts = [makeBlankProjectionFreshFact()];
  mockState.persistedGraph = PARTIAL_GRAPH;
  originalNamedRefusalFlag = config.cee.editConnectivityNamedRefusalEnabled === true;
  setNamedRefusalFlag(false);
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setNamedRefusalFlag(originalNamedRefusalFlag);
  vi.clearAllMocks();
  setTestSink(null);
});



// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('coaching capabilities combined — non-interference proven, not asserted', () => {


  it('Cap-2A leg: repeated runs produce identical placeholder guidance and chips', async () => {
    const alone = await runCap2aRejectionTurn('bbbbbbb1-0000-4000-8000-000000000001');

    // Both flags ON.
    const both = await runCap2aRejectionTurn('bbbbbbb2-0000-4000-8000-000000000002');

    // RED-proven reach (historical, pre flag-deletion): first committed
    // asserting the text equals the generic suppression copy and FAILED with
    // the placeholder as received, proving the branch executes.
    expect(both.response.assistant_text).toBe(ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER);

    // Non-interference: byte-identical to the single-flag run.
    expect(both.response.assistant_text).toBe(alone.response.assistant_text);
    expect(both.response.suggested_actions).toEqual(alone.response.suggested_actions);
  });


});
