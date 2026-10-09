/**
 * V5-D1-SHAPE-01 — D1 mutation turns persist the merged
 * persisted-base shape, not the stripped ingress echo.
 *
 * Defect under test (scorecard J5c: options[] → 0 after
 * set_factor_value): D1 handlers mutate the ingress echo
 * (`applyAndValidateMutation` merges structural fields back onto the
 * INGRESS top-level shape), and the DGAI wire echo carries only
 * `{nodes, edges}` — never `goal_node_id`, never `options[]` — so the
 * STEP 7 commit replaced the rich draft-persisted `scenarios.graph`
 * with a stripped shape — canonical state loss: goal_node_id gone,
 * options[] → 0, top-level metadata stripped, future turns inherit
 * the lossy merge base, and freshness/hash behaviour can spuriously
 * diverge. (run_analysis may still succeed — readiness re-derives
 * goal/options from node kinds — so this is corruption, not a
 * guaranteed analysis outage.)
 *
 * Fix under test: STEP 7 strict-reads the persisted graph
 * (`loadPersistedGraphStrict`) and commits
 * `mergeMutatedGraphForPersistence(mutated, persistedBase)` — the
 * mutation wins for nodes/edges (+ goal_constraints when written);
 * the persisted base wins for `goal_node_id`, `options[]` and every
 * other top-level field. A degraded strict read FAILS CLOSED
 * (STATE_COMMIT_FAILED, nothing persisted): the handler facts assert
 * the mutation was applied, so committing them without the graph (or
 * with a lossy graph) would corrupt canonical state. Mirror of the
 * edit_graph fix (PR #265, V5-PERSIST-FIX-01).
 *
 * Golden fixtures are the CAPTURED EXP-01 graphs (same as
 * turn-executor-non-mutating-commit-graph.test.ts):
 * `rich-persisted-graph.json` (draft-persisted shape, hashes to the
 * live run_analysis anchor) and `echo-graph-state.json` (the
 * DGAI-shaped request echo).
 */

import { readFileSync } from 'node:fs';

import { __setUseAppendV6ForTest } from '../append-v6-flag.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

// ---------------------------------------------------------------------------
// Stateful session-store mock — mirrors the RPC's p_graph semantics
// (same pattern as turn-executor-non-mutating-commit-graph.test.ts),
// extended with a strict-read seam: `loadGraph` records the id it was
// called with (Gate 1 identifier proof) and can be armed to throw
// (degraded-read fail-closed proof).
// ---------------------------------------------------------------------------

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  turn_class?: unknown;
  handler_facts?: unknown;
  expectedRevision?: number;
}

const appendCalls: AppendWrite[] = [];
let currentPersistedGraph: unknown = null;
let priorTurns: unknown[] = [];
let priorFacts: unknown[] = [];
const loadGraphCalls: unknown[] = [];
let loadGraphError: Error | null = null;
let combinedReadError: Error | null = null;
const combinedReadCalls: unknown[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) {
        currentPersistedGraph = write.graph;
      }
      return { id: 'mock-row-id' };
    },
    readRecent: async () => priorTurns,
    readFactsFor: async () => priorFacts,
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async (scenarioId: unknown) => {
      loadGraphCalls.push(scenarioId);
      if (loadGraphError) throw loadGraphError;
      return currentPersistedGraph;
    },
    loadGraphAndBriefText: async (scenarioId: unknown) => {
      combinedReadCalls.push(scenarioId);
      if (combinedReadError) throw combinedReadError;
      return { revision: 7, graph: currentPersistedGraph, briefText: null };
    },
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Golden fixtures (captured EXP-01 graphs)
// ---------------------------------------------------------------------------

const RICH_PERSISTED_GRAPH = JSON.parse(
  readFileSync(
    new URL('./fixtures/exp01/rich-persisted-graph.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const ECHO_GRAPH_STATE = JSON.parse(
  readFileSync(
    new URL('./fixtures/exp01/echo-graph-state.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

/** EXP-01 run_analysis anchor — hash of the rich persisted graph. */


const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------
// Payload / adapter helpers. Gate 1 (identifier proof): scenario_id,
// turn_id and request_id are all DISTINCT values, so a
// scenario/turn/request id confusion in the strict-read call site
// cannot pass accidentally.
// ---------------------------------------------------------------------------

const SCENARIO_ID = '49769b89-37c7-4c98-a278-4e389fa1cfc1';

function payload(message: string, turnId: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<
        (
          args: ChatWithToolsArgs,
          opts: { requestId: string },
        ) => Promise<ChatWithToolsResult>
      >()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on this path');
      }),
  };
}

/** Drive the deterministic value-update pre-route (EXP-01 J5c shape). */
async function runSetFactorValueTurn(requestId: string, turnId: string) {
  return runTurnExecutor(
    payload('Set the Local Senior Hire Indicator factor to 1.0.', turnId),
    requestId,
    {
      routingAdapter: throwingRoutingAdapter(),
      graphState: clone(ECHO_GRAPH_STATE) as never,
    },
  );
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  __setUseAppendV6ForTest(true);
  combinedReadError = null;
  combinedReadCalls.length = 0;
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  appendCalls.length = 0;
  loadGraphCalls.length = 0;
  loadGraphError = null;
  currentPersistedGraph = null;
  priorTurns = [];
  priorFacts = [];
});

afterEach(() => {
  __setUseAppendV6ForTest(true);
  setTestSink(null);
});

describe('CAS ON D1 combined-snapshot commit admission', () => {
  it('Gate 1 identifier proof: the combined persisted read is keyed by the SCENARIO id — the same value the commit targets — not the turn or request id', async () => {
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);
    const turnId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13';
    const requestId = 'req-d1shape-idproof';

    await runSetFactorValueTurn(requestId, turnId);

    expect(appendCalls.at(-1)!.graph).toBeDefined();
    expect(appendCalls.at(-1)!.expectedRevision).toBe(7);
    expect(loadGraphCalls).toHaveLength(0);
    expect(combinedReadCalls.length).toBeGreaterThan(0);
    const strictReadId = combinedReadCalls.at(-1);
    expect(strictReadId).toBe(SCENARIO_ID);
    expect(strictReadId).not.toBe(turnId);
    expect(strictReadId).not.toBe(requestId);
  });

  it('fail closed: a degraded combined read aborts the commit — STATE_COMMIT_FAILED error envelope, zero rows appended, scenarios.graph untouched', async () => {
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);
    const pristine = JSON.stringify(currentPersistedGraph);
    combinedReadError = new Error('session store unreachable');

    const { response } = await runSetFactorValueTurn(
      'req-d1shape-degraded',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14',
    );

    // Nothing persisted: no turn row, no facts, no graph. The handler
    // facts assert the mutation was applied, so committing them without
    // the graph would corrupt canonical state.
    expect(appendCalls).toHaveLength(0);
    expect(JSON.stringify(currentPersistedGraph)).toBe(pristine);
    // Pin the commit-failure envelope directly (Codex follow-up):
    // STATE_COMMIT_FAILED maps to wire error_code 'INTERNAL_ERROR'
    // (INTERNAL_TO_WIRE), is the retryable transient class
    // (details.retryable), and STEP 7's catch stamps phase:'commit' —
    // together these identify the commit-abort path, not a generic
    // internal error.
    const errorBlock = (
      response.blocks as Array<{
        type: string;
        error_code?: string;
        details?: Record<string, unknown>;
      }>
    ).find((b) => b.type === 'error');
    expect(errorBlock).toBeDefined();
    expect(errorBlock!.error_code).toBe('INTERNAL_ERROR');
    expect(errorBlock!.details).toMatchObject({ retryable: true, phase: 'commit' });
    const completed = events.find((e) => e.event === 'turn_executor.completed');
    expect(completed?.data.failure_type).toBe('INTERNAL_ERROR');
    expect(completed?.data.commit_performed).toBe(false);
  });

});
