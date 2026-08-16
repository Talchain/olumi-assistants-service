/**
 * V5 product-state continuity (foamy-bee tranche) — REAL two-turn
 * persistence-chain proof.
 *
 * Companion to `state-query-after-mutation.test.ts`. That test isolates
 * the state-query guard from mutation-handler stability by injecting
 * priorFacts directly. THIS test exercises the full persistence chain:
 *
 *   Turn 1: real `add_constraint` handler runs, appends a fact via the
 *           SessionStore.
 *   Turn 2: same SessionStore returns turn 1's row + fact via
 *           `readRecent` / `readFactsFor`. The state-query guard
 *           reads `recent_changes` projected from those facts and
 *           dispatches the deterministic answer.
 *
 * **What this test proves vs does NOT prove.**
 *
 *   PROVES — the persistence chain end to end:
 *     - real `add_constraint` handler executes
 *     - fact serialises to the SessionStore
 *     - turn 2's `buildTurnContext` reads the fact back via row-id
 *       FK lookup
 *     - projection produces `recent_changes` with the literal £50,000
 *     - state-query guard composes the deterministic answer grounded
 *       in the recent_changes
 *     - no LLM call on turn 2
 *
 *   DOES NOT PROVE — that "Yes, we don't want to spend more than £50k
 *     on this." wording (used as turn 1's user message verbatim from
 *     the staging failure log) selects `add_constraint` via Sonnet's
 *     routing. Sonnet is mocked. The wording is documentation/replay
 *     accuracy. Routing-prompt coverage is the responsibility of the
 *     prompt evaluation suite (out of scope for this unit).
 *
 * If anything breaks in the persistence round trip — fact persistence,
 * fact read, row id linkage, projection, or guard dispatch — this test
 * fails. The guard-isolation test alone cannot catch a regression in
 * the chain.
 *
 * Stateful mock SessionStore: turn 1's `append` captures the row and
 * its handler_facts; turn 2 reads them back through readRecent /
 * readFactsFor exactly as production does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { ToolResponseBlock } from '../../adapters/llm/types.js';
import { buildD1Fixture } from '../tools/handlers/d1-shared/__tests__/fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';

const TEST_SCENARIO_ID = '33333333-3333-4333-8333-333333333333';

interface CapturedTurn {
  readonly id: string;
  readonly turn_class: string;
  readonly handler_id: string | null;
  readonly created_at: string;
  readonly handler_facts: readonly Record<string, unknown>[];
}

const persistence: {
  turns: CapturedTurn[];
} = { turns: [] };

function asPriorTurns(): readonly Record<string, unknown>[] {
  // SessionTurn shape — only the fields buildTurnContext + freshness
  // derivation actually read. Newest-first ordering matches
  // SessionStore.readRecent's contract.
  return [...persistence.turns]
    .reverse()
    .map((t) => ({
      id: t.id,
      scenario_id: TEST_SCENARIO_ID,
      user_id: null,
      turn_id: `turn-${t.id}`,
      turn_class: t.turn_class,
      handler_id: t.handler_id,
      request_hash: 'sha256:test',
      response_emitted: true,
      llm_calls_used: 0,
      duration_ms: 5,
      created_at: t.created_at,
    }));
}

function asPriorFacts(forRowIds: readonly string[]): readonly Record<string, unknown>[] {
  // Match SessionStore.readFactsFor: filter facts whose owning turn row
  // appears in forRowIds, return newest-first.
  return [...persistence.turns]
    .filter((t) => forRowIds.includes(t.id))
    .reverse()
    .flatMap((t) => t.handler_facts);
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: {
      graph?: unknown;
      turn_class?: string;
      handler_id?: string | null;
      handler_facts?: readonly Record<string, unknown>[];
    }) => {
      const id = `row-${persistence.turns.length + 1}`;
      persistence.turns.push({
        id,
        turn_class: write.turn_class ?? 'handler',
        handler_id: write.handler_id ?? null,
        created_at: new Date().toISOString(),
        handler_facts: write.handler_facts ?? [],
      });
      return {
        id,
        ...(write.graph != null
          ? { graph_write_disposition: 'accepted_insert' as const }
          : {}),
      };
    },
    readRecent: async () => asPriorTurns(),
    readFactsFor: async (rowIds: readonly string[]) => asPriorFacts(rowIds),
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: TEST_SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

/**
 * Routing adapter that returns the canonical `add_constraint` tool call
 * for a £50,000 cost cap on Marketing budget. Used for turn 1 only —
 * turn 2 uses a throwing adapter to prove no LLM call.
 */
function addConstraintToolCallAdapter() {
  const toolCall = {
    intent_class: 'execute',
    action: {
      handler_id: 'add_constraint',
      entity: {
        id: 'f-budget',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
        { name: 'value', value: 50000, source: 'user_explicit' },
        { name: 'unit', value: '£', source: 'user_explicit' },
      ],
      cited_context_fields: ['graph.nodes'],
    },
  };
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: toolCall as Record<string, unknown>,
    },
  ];
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content,
        stop_reason: 'tool_use' as const,
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'mock',
        latencyMs: 5,
      })),
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error(
          'Routing adapter must NOT be called on the state-query follow-up turn',
        );
      }),
  };
}

describe('V5 state-query guard — REAL two-turn integration', () => {
  beforeEach(() => {
    persistence.turns = [];
    setTestSink(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  it('runs the actual add_constraint handler on turn 1, then answers the state-query on turn 2 with no LLM call', async () => {
    const graph = buildD1Fixture();

    // -----------------------------------------------------------------
    // Turn 1 — real add_constraint dispatch via Sonnet tool call.
    // -----------------------------------------------------------------
    const turn1Adapter = addConstraintToolCallAdapter();
    // Use the EXACT user wording from the staging failure log so the
    // test mirrors the observed scenario verbatim. Sonnet's tool-call
    // shape is mocked, so this is a documentation/replay accuracy
    // win — the chosen wording exercises the same code path as any
    // other input that produces an `add_constraint` tool call.
    const turn1Result = await runTurnExecutor(
      payload("Yes, we don't want to spend more than £50k on this."),
      'req-real-turn-1',
      {
        routingAdapter: turn1Adapter,
        graphState: graph as unknown as NonNullable<Parameters<typeof runTurnExecutor>[2]>['graphState'],
      },
    );

    // The handler ran and the turn committed. assistant_text is the
    // deterministic format-confirmation copy — proves the £50,000 value
    // round-trips through the real handler.
    expect(turn1Result.telemetry.failure_type).toBeNull();
    expect(turn1Result.telemetry.turn_class).toBe('handler');
    // handler_id isn't on the telemetry surface — assert via the
    // persisted append (next block) so the chain proof remains intact.
    expect(turn1Result.response.assistant_text).toContain('£50,000');
    expect(turn1Result.response.assistant_text).toContain('at most');

    // Persistence layer captured the turn + fact. This is the chain
    // turn 2 will read back through.
    expect(persistence.turns).toHaveLength(1);
    const turn1Persisted = persistence.turns[0]!;
    expect(turn1Persisted.handler_id).toBe('add_constraint');
    expect(turn1Persisted.handler_facts).toHaveLength(1);
    const persistedFact = turn1Persisted.handler_facts[0] as Record<string, unknown>;
    expect(persistedFact.fact_type).toBe('add_constraint');
    expect(persistedFact.noop).toBe(false);

    // -----------------------------------------------------------------
    // Turn 2 — state-query follow-up. The routing adapter throws if
    // called; assertion proves the deterministic guard owns the turn.
    // -----------------------------------------------------------------
    const turn2Adapter = throwingRoutingAdapter();
    const turn2Result = await runTurnExecutor(
      payload('What update did you make?'),
      'req-real-turn-2',
      { routingAdapter: turn2Adapter },
    );

    expect(turn2Adapter.chatWithTools).not.toHaveBeenCalled();

    // The deterministic answer references the constraint persisted on
    // turn 1 — full round trip proven.
    const text = turn2Result.response.assistant_text;
    expect(text).toMatch(/£50,?000|£50k/i);
    expect(text).toContain('Marketing budget');
    expect(text).toContain('at most');

    // No legacy denial copy.
    expect(text).not.toMatch(/no changes were needed/i);
    expect(text).not.toMatch(/no update has been made/i);

    // Dispatch shape: direct_answer / converse / no LLM calls.
    expect(turn2Result.telemetry.turn_class).toBe('direct_answer');
    expect(turn2Result.telemetry.intent_class).toBe('converse');
    expect(turn2Result.telemetry.llm_calls_used).toBe(0);

    // Persistence captured turn 2 as a direct_answer turn.
    expect(persistence.turns).toHaveLength(2);
    expect(persistence.turns[1]!.turn_class).toBe('direct_answer');
  });

  it('emits accurate routing-log mutation count after the real persistence round trip', async () => {
    const graph = buildD1Fixture();

    // Turn 1 commits a real add_constraint fact. Same staging-replay
    // wording as the first test in this file.
    await runTurnExecutor(
      payload("Yes, we don't want to spend more than £50k on this."),
      'req-rl-turn-1',
      {
        routingAdapter: addConstraintToolCallAdapter(),
        graphState: graph as unknown as NonNullable<Parameters<typeof runTurnExecutor>[2]>['graphState'],
      },
    );

    // Turn 2 reads it back. Capture telemetry to assert the routing
    // log carries `prior_mutation_fact_count: 1` — proves the
    // foamy-bee fix that moved the count out of the guard block
    // works on the persistence chain.
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));

    await runTurnExecutor(payload('What update did you make?'), 'req-rl-turn-2', {
      routingAdapter: throwingRoutingAdapter(),
    });

    const guardEvent = events.find((e) => e.event === 'v5.state_query_guard');
    expect(guardEvent).toBeDefined();
    expect(guardEvent!.data.matched).toBe(true);
    expect(guardEvent!.data.recent_change_count).toBe(1);
    expect(guardEvent!.data.prior_mutation_fact_count).toBe(1);
  });
});
