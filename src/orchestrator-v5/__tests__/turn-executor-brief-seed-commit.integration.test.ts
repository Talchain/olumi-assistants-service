/**
 * Lane 28 — brief pipeline seam 1: `scenarios.brief_text` seeding through the
 * REAL turn-executor commit path.
 *
 * Production evidence (Lane 21 doc §coaching-co-blockers): staging scenarios
 * carry no persisted `brief_text`. The only seeding writer was
 * draft-graph-dispatch, whose route-v2 trigger (`isDraftGraphShape`) is
 * suppressed for continuation scenarios and never fires for turns routed to
 * the TurnExecutor — whose 20 commit sites re-passed only the
 * ALREADY-persisted brief (`context.scenarioBriefText ?? undefined`), a
 * circular no-op when the brief was never written in the first place.
 *
 * These tests pin the fix: the `commitTurn` wrapper (the same central
 * chokepoint that injects `userMessage` and `coaching_state` on every commit
 * site) seeds `briefText` from the turn payload when — and only when — no
 * brief is persisted yet and the message passes the conservative
 * decision-brief shape gate (`deriveBriefTextSeed`). The RPC's
 * first-write-wins predicate stays the last line of defence.
 *
 * Mirrors the deterministic mocked-store pattern of
 * turn-executor-brief-in-prompt.integration.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload, StageType } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';

const mockState: {
  persistedGraph: unknown | null;
  briefText: string | null;
  appends: Array<Record<string, unknown>>;
} = { persistedGraph: null, briefText: null, appends: [] };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      mockState.appends.push(write);
      return { id: `row-${randomUUID()}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: mockState.persistedGraph,
      briefText: mockState.briefText,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
const BRIEF =
  'Should we hire two senior engineers locally or engage an offshore partner? Budget is £250k and we must decide by Q3.';

const GRAPH = {
  schema_version: 'v3',
  nodes: [
    { id: 'goal_hiring', kind: 'goal', label: 'Sustainable team growth' },
    { id: 'fac_budget', kind: 'factor', label: 'Budget headroom' },
    { id: 'opt_local', kind: 'option', label: 'Hire locally' },
    { id: 'opt_offshore', kind: 'option', label: 'Offshore partner' },
  ],
  edges: [{ from: 'fac_budget', to: 'goal_hiring', strength: 0.6 }],
};

function mkPayload(message: string, stage: StageType = 'frame'): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage,
  };
}

function mockAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

function committedBriefText(): unknown {
  expect(mockState.appends.length).toBeGreaterThan(0);
  return mockState.appends[mockState.appends.length - 1]!.briefText;
}

describe('Lane 28 — brief_text seeding at the turn-executor commit chokepoint', () => {
  beforeEach(() => {
    mockState.persistedGraph = GRAPH;
    mockState.briefText = null;
    mockState.appends = [];
    setTestSink(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  it('seeds briefText from a frame-stage decision-brief message when none is persisted', async () => {
    await runTurnExecutor(mkPayload(BRIEF, 'frame'), 'req-brief-seed-1', {
      routingAdapter: mockAdapter('Understood — here is a way to think about it.'),
      graphState: GRAPH as never,
    });
    expect(committedBriefText()).toBe(BRIEF);
  });

  it('re-passes the already-persisted brief untouched (no reseeding, RPC no-op either way)', async () => {
    mockState.briefText = 'The original persisted brief: should we expand into Europe?';
    await runTurnExecutor(mkPayload(BRIEF, 'frame'), 'req-brief-seed-2', {
      routingAdapter: mockAdapter('Noted.'),
      graphState: GRAPH as never,
    });
    expect(committedBriefText()).toBe(
      'The original persisted brief: should we expand into Europe?',
    );
  });

  it('does not seed from non-frame stages', async () => {
    await runTurnExecutor(mkPayload(BRIEF, 'analyse'), 'req-brief-seed-3', {
      routingAdapter: mockAdapter('Noted.'),
      graphState: GRAPH as never,
    });
    expect(committedBriefText()).toBeUndefined();
  });

  it('does not seed from frame chatter that fails the decision-brief shape gate', async () => {
    await runTurnExecutor(
      mkPayload('I enjoy long walks near the coast with my dog most mornings', 'frame'),
      'req-brief-seed-4',
      {
        routingAdapter: mockAdapter('Nice.'),
        graphState: GRAPH as never,
      },
    );
    expect(committedBriefText()).toBeUndefined();
  });
});
