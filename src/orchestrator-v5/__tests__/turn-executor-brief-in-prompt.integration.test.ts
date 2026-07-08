/**
 * Lane 28 — brief pipeline: end-to-end threading proof.
 *
 * Proves the persisted decision brief (`scenarios.brief_text`) reaches the
 * routing LLM's serialised prompt through the REAL turn-executor path:
 *
 *   SessionStore.loadGraphAndBriefText → buildTurnContext
 *   (EnrichedTurnContext.scenarioBriefText) → turn-executor →
 *   assembleContextPackWithSummary({ brief }) → buildUserMessage → adapter.
 *
 * Before this lane the chain terminated at the enricher-only consumers: the
 * ContextPack had no brief field, so the routing/coaching LLM never saw the
 * decision brief after the draft turn (dossier gap G2). Mirrors the
 * deterministic mocked-store pattern of
 * turn-executor-context-reliability-lifecycle.integration.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';

const mockState: {
  persistedGraph: unknown | null;
  briefText: string | null;
} = { persistedGraph: null, briefText: null };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
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

const SCENARIO_ID = '44444444-4444-4444-8444-444444444444';
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

function mkPayload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

function capturingAdapter(text: string) {
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

function routedUserMessage(adapter: ReturnType<typeof capturingAdapter>): string {
  expect(adapter.chatWithTools).toHaveBeenCalled();
  const args = adapter.chatWithTools.mock.calls[0]![0];
  return String(args.messages[0]!.content);
}

describe('Lane 28 — persisted brief reaches the routing prompt end-to-end', () => {
  beforeEach(() => {
    mockState.persistedGraph = GRAPH;
    mockState.briefText = null;
    setTestSink(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  it('threads scenarios.brief_text into the serialised ContextPack the LLM receives', async () => {
    mockState.briefText = BRIEF;
    const adapter = capturingAdapter('Here is some guidance.');
    await runTurnExecutor(mkPayload('what is the most important factor here?'), 'req-brief-e2e-1', {
      routingAdapter: adapter,
      graphState: GRAPH as never,
    });
    const msg = routedUserMessage(adapter);
    expect(msg).toContain('"brief"');
    expect(msg).toContain('Budget is £250k');
    // Disclosed-truncation shape rides along (untruncated here).
    expect(msg).toContain('"truncated": false');
  });

  it('serialises brief: null when no brief was ever persisted (no fabrication)', async () => {
    mockState.briefText = null;
    const adapter = capturingAdapter('Here is some guidance.');
    await runTurnExecutor(mkPayload('what is the most important factor here?'), 'req-brief-e2e-2', {
      routingAdapter: adapter,
      graphState: GRAPH as never,
    });
    const msg = routedUserMessage(adapter);
    expect(msg).toContain('"brief": null');
    expect(msg).not.toContain('Budget is £250k');
  });
});
