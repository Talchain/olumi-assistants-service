/**
 * V5-FRESH-FIX-01 — non-mutating turns must NOT persist a graph (H2 fix).
 *
 * Confirmed defect (V5-PERSIST/FRESH-01 report, EXP-01 scenario
 * `49769b89`): every LLM-spine commit fell back to persisting the
 * client-echoed `options.graphState` when the handler emitted no
 * `mutated_graph`. The wire `draft_graph` block carries only
 * `{nodes, edges}` — no `options[]`, no `goal_node_id` — so the echo can
 * never be faithful to the rich draft-persisted graph, and the
 * analysis-freshness hash (`computeAnalysisAffectingGraphHash`) covers
 * exactly those fields. One non-mutating explain turn therefore
 * replaced the rich `scenarios.graph` with a lossy echo →
 * `graph_hash_diverged` with zero edits → false "Run analysis again
 * first?" deflections (EXP-01 J3).
 *
 * Fix under test: `turn-executor.ts` STEP 7 commits a graph ONLY when
 * `handlerOutcome.mutated_graph` is present; otherwise `p_graph` stays
 * null and the RPC leaves `scenarios.graph` untouched (the documented
 * `CommitMetadata.graph` contract).
 *
 * Golden fixtures are the CAPTURED EXP-01 graphs (not approximations):
 *   - `fixtures/exp01/rich-persisted-graph.json` — the draft-persisted
 *     shape `{nodes, edges, goal_node_id, options[]}`; hashes to
 *     `b3ebb23cfb03df1d`, the run_analysis anchor observed live
 *     (anchor == hash of the rich persisted graph at run time).
 *   - `fixtures/exp01/echo-graph-state.json` — the DGAI-shaped request
 *     echo the harness sent on every turn; hashes to
 *     `8fc73501f6fa5c79`, the diverged "current" hash observed live.
 */

import { readFileSync } from 'node:fs';

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

import { rebindRecordedAnalysisHash } from '../../../tests/helpers/legacy-analysis-hash-v2.js';
import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Stateful session-store mock — mirrors the RPC's p_graph semantics:
// `append` REPLACES the persisted graph only when the write carries a
// non-nullish `graph`; otherwise `scenarios.graph` is left untouched.
// This is what lets the suite assert content preservation (not just
// hash equality) across non-mutating turns.
// ---------------------------------------------------------------------------

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  turn_class?: unknown;
  handler_facts?: unknown;
}

const appendCalls: AppendWrite[] = [];
let currentPersistedGraph: unknown = null;
let priorTurns: unknown[] = [];
let priorFacts: unknown[] = [];
let pendingActions: PendingAction[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      // append_turn_atomic(p_graph): null leaves scenarios.graph unchanged.
      if (write.graph !== undefined && write.graph !== null) {
        currentPersistedGraph = write.graph;
      }
      return { id: 'mock-row-id' };
    },
    readRecent: async () => priorTurns,
    readFactsFor: async () => priorFacts,
    readMostRecentPendingActions: async () => pendingActions,
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    loadGraph: async () => currentPersistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: currentPersistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));



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

// Shared Data row 1 (projection v3): the live EXP-01 hashes were observed under the pre-0.62.0 projection. Each is
// proven to be that projection of its captured graph, then rebound to the current projection (tests/helpers).
/** EXP-01 run_analysis anchor — hash of the rich persisted graph (observed live as `b3ebb23cfb03df1d`). */
const RICH_HASH = rebindRecordedAnalysisHash(RICH_PERSISTED_GRAPH, 'b3ebb23cfb03df1d');
/** EXP-01 diverged "current" hash — hash of the client echo (observed live as `8fc73501f6fa5c79`). */
const ECHO_HASH = rebindRecordedAnalysisHash(ECHO_GRAPH_STATE, '8fc73501f6fa5c79');
/** EXP-01 J6 re-anchor — hash of the echo after the J5c set_factor_value, observed live under the pre-0.62.0
 * projection (no captured graph to rebind, so it is compared through that projection). */




// ---------------------------------------------------------------------------
// Payload / adapter helpers (same patterns as
// turn-executor-freshness-canonical-graph.test.ts)
// ---------------------------------------------------------------------------
















// ---------------------------------------------------------------------------
// Telemetry sink
// ---------------------------------------------------------------------------

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];



beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  appendCalls.length = 0;
  currentPersistedGraph = null;
  priorTurns = [];
  priorFacts = [];
  pendingActions = [];
});

afterEach(() => {
  setTestSink(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('golden pins — captured EXP-01 graph shapes', () => {
  it('rich persisted graph hashes to the live run_analysis anchor; echo hashes to the live diverged hash', () => {
    // Acceptance 1 (anchor derivation) + 3 (echo-defect shape): the
    // anchor observed live IS the hash of the rich persisted graph, and
    // the captured echo produces the diverged hash — purely because the
    // wire shape cannot carry options[] (goal_node_id was re-attached by
    // the harness; the options[] absence alone moved the hash).
    expect(
      computeAnalysisAffectingGraphHash(RICH_PERSISTED_GRAPH as never),
    ).toBe(RICH_HASH);
    expect(computeAnalysisAffectingGraphHash(ECHO_GRAPH_STATE as never)).toBe(
      ECHO_HASH,
    );
    expect(RICH_HASH).not.toBe(ECHO_HASH);
    // The fixture premise: the echo differs from the rich graph ONLY in
    // the server-only top-level fields.
    expect(RICH_PERSISTED_GRAPH.options).toBeDefined();
    expect(ECHO_GRAPH_STATE.options).toBeUndefined();
    expect(ECHO_GRAPH_STATE.goal_node_id).toBe(
      RICH_PERSISTED_GRAPH.goal_node_id,
    );
  });
});
