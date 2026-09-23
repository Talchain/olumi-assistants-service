/**
 * #1740 (N3, mutant R5) — the producer's `extractionType` stays withdrawn in
 * the graph HANDED TO `store.append`, after the edit path's persistence merge.
 *
 * ── Why the applied-graph assertions cannot see this ────────────────────
 * `handleEditGraph` produces the applied graph, but it is not what is stored.
 * `dispatchEditGraph` merges it onto the STRICT persisted base
 * (`mergeAppliedGraphForPersistence`), projects it
 * (`projectGraphForPersistence`) and commits it (`commitDirectAnswer` →
 * `appendCheckedGraphWrite` → `store.append`). The persisted base still
 * carries `observed_state.extractionType: 'inferred'` on the edited factor —
 * that is the state the user is correcting. A merge that re-adds node or
 * observed_state fields from that base would put the marker back into the
 * stored bytes while every applied-graph assertion stayed green.
 *
 * So this runs the REAL dispatcher, the REAL `handleEditGraph`, the REAL merge
 * and projection, and the REAL commit, mocking only the LLM transport, the
 * prompt loader and the session store, and asserts on the argument the store
 * receives.
 *
 * Rule: a user-authored value withdraws the producer's extraction marker
 * (23 Sep witness; #1740).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest } from 'fastify';

// ── the store: the persisted base the merge reads, and the write it receives ──

const { appendMock, persistedRef } = vi.hoisted(() => ({
  appendMock: vi.fn(),
  persistedRef: { current: null as unknown },
}));

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    loadGraph: async () => JSON.parse(JSON.stringify(persistedRef.current)),
    loadGraphAndBriefText: async () => ({
      graph: JSON.parse(JSON.stringify(persistedRef.current)),
      briefText: null,
    }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// ── the LLM transport: returns the edit operations for this turn ──────────────

const { llmChatMock } = vi.hoisted(() => ({ llmChatMock: vi.fn() }));
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({ name: 'test', model: 'test-model', chat: llmChatMock }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You edit causal decision graphs'),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: 'You edit causal decision graphs',
    meta: { source: 'default', prompt_version: 'v2' },
  }),
}));

// ── imports after mocks ───────────────────────────────────────────────────────

import { dispatchEditGraph } from '../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';
import type { GraphStateIngress } from '../../../src/orchestrator-v5/boundary/request-extensions.js';
import { makeMessagePayload } from '../../../src/orchestrator-v5/__tests__/fixtures.js';

const SCENARIO_ID = '17401740-1740-4740-8740-174017401740';
const TARGET = 'fac_monthly_cashflow';
const SIBLING = 'fac_churn';

/** The persisted `scenarios.graph` — the producer's marker on both factors. */
function buildPersistedGraph() {
  return {
    goal_node_id: 'out_net_profit',
    nodes: [
      { id: 'dec_asset', kind: 'decision', label: 'Buy or lease the asset' },
      { id: 'opt_buy', kind: 'option', label: 'Buy Asset' },
      {
        id: TARGET,
        kind: 'factor',
        label: 'Monthly Cash Flow Burden',
        category: 'controllable',
        observed_state: {
          value: 0.5,
          source: 'cee_inference',
          factor_type: 'cost',
          extractionType: 'inferred',
        },
      },
      {
        id: SIBLING,
        kind: 'factor',
        label: 'Customer churn',
        category: 'external',
        observed_state: { value: 0.2, source: 'cee_inference', extractionType: 'inferred' },
      },
      { id: 'out_net_profit', kind: 'goal', label: 'Net Profit Over Three Years' },
    ],
    edges: [
      { from: 'dec_asset', to: 'opt_buy', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_buy', to: TARGET, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: TARGET, to: 'out_net_profit', strength: { mean: -0.35, std: 0.1 }, exists_probability: 0.88, effect_direction: 'negative' },
      { from: SIBLING, to: 'out_net_profit', strength: { mean: -0.2, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
    ],
  };
}

function editResponse(operations: unknown[]) {
  return {
    content: JSON.stringify({
      operations,
      removed_edges: [],
      warnings: [],
      coaching: { summary: 'Updated Monthly Cash Flow Burden.', rerun_recommended: true },
    }),
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    model: 'test-model',
    latencyMs: 1,
    stopReason: 'end_turn',
  };
}

function storedGraph(): Record<string, unknown> {
  expect(appendMock, 'the edit must reach store.append exactly once').toHaveBeenCalledTimes(1);
  const write = appendMock.mock.calls[0]![0] as { graph?: Record<string, unknown> };
  expect(write.graph, 'the append must carry the graph').toBeDefined();
  return write.graph!;
}

function nodeOf(graph: unknown, id: string): Record<string, unknown> {
  const node = (graph as { nodes: Array<Record<string, unknown>> }).nodes.find((n) => n.id === id);
  if (!node) throw new Error(`node ${id} missing from the stored graph`);
  return node;
}

beforeEach(() => {
  appendMock.mockReset();
  appendMock.mockResolvedValue({ id: 'row-1740', persisted: true });
  llmChatMock.mockReset();
  persistedRef.current = buildPersistedGraph();
});

describe('#1740 R5 — the graph handed to store.append, after the edit-path persistence merge', () => {
  it.each([
    ['single value leaf', [{ op: 'update_node', path: `/nodes/${TARGET}/data/value`, value: 0.42 }]],
    [
      'value → unit → std',
      [
        { op: 'update_node', path: `/nodes/${TARGET}/data/value`, value: 0.42 },
        { op: 'update_node', path: `/nodes/${TARGET}/data/unit`, value: 'USD' },
        { op: 'update_node', path: `/nodes/${TARGET}/data/std`, value: 0.2 },
      ],
    ],
  ])('%s: the stored factor carries the user value and NO extractionType; the sibling keeps its marker', async (_label, operations) => {
    llmChatMock.mockResolvedValue(editResponse(operations));

    await dispatchEditGraph({
      payload: makeMessagePayload({
        scenario_id: SCENARIO_ID,
        turn_id: '17401740-aaaa-4aaa-8aaa-000000000001',
        stage: 'analyse',
        message: 'Change the monthly cashflow factor to 0.42',
      }),
      requestId: 'req-1740-persist',
      request: {} as FastifyRequest,
      // The client echo: same graph, so the ingress fallback cannot be what
      // decides — the merge base is the STRICT persisted read above.
      graphState: buildPersistedGraph() as unknown as GraphStateIngress,
      analysisState: null,
    });

    expect(llmChatMock).toHaveBeenCalled();
    const stored = storedGraph();

    const observed = nodeOf(stored, TARGET).observed_state as Record<string, unknown>;
    // PREMISE — this is the user's write, stored.
    expect(observed.value).toBe(0.42);
    expect(observed.source).toBe('user_override');
    // THE RULE, on the stored bytes — a user-authored value withdraws the
    // producer's extraction marker (23 Sep witness; #1740). The persisted base
    // still has it, so a merge that re-adds base fields would put it back here.
    expect('extractionType' in observed).toBe(false);
    // A sibling the op never mentioned is still preserved through the merge.
    expect(observed.factor_type).toBe('cost');

    // CONTROL — the untouched sibling keeps the producer's marker in the same
    // stored graph, so the assertion above cannot pass by a sweep.
    const sibling = nodeOf(stored, SIBLING).observed_state as Record<string, unknown>;
    expect(sibling.extractionType).toBe('inferred');
    expect(sibling.source).toBe('cee_inference');
  });
});
