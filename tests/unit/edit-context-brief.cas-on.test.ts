import { __setUseAppendV6ForTest } from '../../src/orchestrator-v5/append-v6-flag.js';
/**
 * Context Architecture v2 — S2 "brief → edit/repair" (ROADMAP 1.199).
 *
 * Design of record: docs-designs/CONTEXT-ARCHITECTURE-V2-2026-07-13/ +
 * CONTEXT-POLICY-DESIGN-2026-07-23.
 *   - 02 §Seam 1 — edit_graph/repair got NOTHING of the brief; target = a
 *     1,000-char first-N slice of the same normalised brief text,
 *     DISCLOSED, threaded as `ConversationContext.brief` + a
 *     `## Decision Brief` section in the edit-context serialiser.
 *     Repair inherits automatically (it reuses the same contextSection).
 *   - S2 is now shipped ON: the CEE_CONTEXT_BRIEF_ALL_SITES flag is DELETED
 *     (no-dark-launches — flip = code, rollback = revert). dispatchEditGraph
 *     reads the brief UNCONDITIONALLY. Mutation-check: reverting the flip
 *     (re-adding the flag guard) makes the unconditional-read tests below RED.
 *
 * No-brief byte-identity: no `brief` on the context, no section in the prompt.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../src/orchestrator/tools/edit-graph.js';

// ── module-level mocks (mirrors edit-graph-dispatch.test.ts) ────────────────

vi.mock('../../src/orchestrator/tools/edit-graph.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orchestrator/tools/edit-graph.js')>();
  return {
    ...actual,
    handleEditGraph: vi.fn(),
  };
});

vi.mock('../../src/orchestrator-v5/commit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orchestrator-v5/commit.js')>();
  return {
    ...actual,
    commitDirectAnswer: vi.fn(),
    computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
  };
});

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/orchestrator-v5/build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orchestrator-v5/build-turn-context.js')>();
  return {
    ...actual,
    // B-FIX1: the combined read follows the existing graph double.
    loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../src/orchestrator-v5/build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
    loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
    loadScenarioBriefText: vi.fn().mockResolvedValue(null),
  };
});

// ── imports after mocks ──────────────────────────────────────────────────────

import { dispatchEditGraph } from '../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';
import { handleEditGraph } from '../../src/orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../src/orchestrator-v5/commit.js';
import { loadScenarioBriefText } from '../../src/orchestrator-v5/build-turn-context.js';
import { _resetConfigCache } from '../../src/config/index.js';
import type { GraphStateIngress } from '../../src/orchestrator-v5/boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Increase the strength of the launch → revenue edge',
    turn_class: 'frame' as const,
    source: 'composer' as const,
    ...overrides,
  };
}

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
  ],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

function makeAppliedEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Edge strength increased.',
    latencyMs: 1200,
    appliedGraph: null,
    wasRejected: true,
  } as unknown as EditGraphResult;
}

const STUB_REQUEST = {} as FastifyRequest;

beforeEach(() => {
  vi.clearAllMocks();
  _resetConfigCache();
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(makeAppliedEditResult());
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-edit-1',
    graphPersisted: false,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
});

afterEach(() => {
  _resetConfigCache();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// projectBriefForEdit — 1,000-char disclosed slice (02 §Seam 1 sizes table)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Serialiser — ## Decision Brief section
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Dispatch threading — UNCONDITIONAL store read (S2 shipped ON, flag deleted)
// ---------------------------------------------------------------------------

describe('dispatchEditGraph brief threading (S2 unconditional, no flag)', () => {

  it('CAS ON threads the brief from the combined graph/revision snapshot without a separate brief read', async () => {
    __setUseAppendV6ForTest(true);
    await dispatchEditGraph({ payload: makePayload(), requestId: 'req-combined-brief', request: STUB_REQUEST,
      graphState: INGRESS_GRAPH, analysisState: null,
      persistedEditBase: { graph: null, briefText: 'w'.repeat(4_000), revision: 7 } });
    expect(loadScenarioBriefText).not.toHaveBeenCalled();
    expect((handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]![0].brief)
      .toEqual({ text: 'w'.repeat(1_000), truncated: true, original_chars: 4_000 });
  });



});

afterEach(() => __setUseAppendV6ForTest(true));
