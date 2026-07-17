/**
 * TRUST-SPINE RED — T3 / board item #3: CAS on the commit RPC.
 *
 * Acceptance floor (Paul-approved plan agile-finding-harp.md §3 item 3):
 *   "UPDATE … WHERE graph_identity_hash = expected. Test: stale-base edit is
 *    rejected (409/refresh-reconfirm), never silently clobbers."
 *
 * DEFECT (plan §1 CONFIRMED DEFECT #2): the live graph write is an unconditional
 * last-write-wins `UPDATE scenarios SET graph = p_graph WHERE id = p_scenario_id`
 * (migration 20260422200000:76-84 and its successors) — NO WHERE-clause gate on any
 * base/expected hash. `baseGraphHash` (edit-graph.ts:1541) is audit-trail-only. The
 * only guard is an app-side, pre-RPC, TOCTOU-windowed hook in
 * SupabaseSessionStore.append() which is DISABLED in the deployed posture: config
 * default 'off'; prod is downgraded 'enforce'→'observe' (observe = telemetry only,
 * never blocks). So two edits from the same base silently clobber.
 *
 * This is the commit-layer WRITE CHOKEPOINT — `commit.ts` (commitDirectAnswer) is a
 * pass-through with no CAS of its own; the write and its (disabled) guard live in
 * `SupabaseSessionStore.append()`, driven here over a faked SupabaseClient (the
 * pattern of the sibling supabase-store-graph-cas.test.ts). vitest cannot execute
 * PL/pgSQL, so the atomic DB CAS itself is not exercisable in-process; the two
 * in-process-observable discriminators are (1) the write RPC carries NO expected-base
 * precondition today, and (2) a stale-base second write is not refused in the
 * deployed posture — it clobbers.
 *
 * it.fails semantics: each RED body asserts the HONEST-FUTURE behaviour, which
 * THROWS today — so `it.fails` reports GREEN while the defect stands. When board #3
 * lands, the body passes, `it.fails` fails loudly, and the fixer converts it to
 * `it()`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import {
  GraphStaleWriteError,
  StateCommitFailedError,
  type SessionTurnWrite,
} from '../store.js';
import {
  computeExpectedGraphCasHashes,
  type GraphCasMode,
} from '../../context/graph-cas-conflict.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** Server base at turn start — the expected-hash source shared by both edits. */
const BASE_GRAPH = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.5 } },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'goal_revenue',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
  goal_node_id: 'goal_revenue',
};

/** Concurrent ANALYSIS-AFFECTING edit already landed in the DB (a stale base). */
const DIVERGED_GRAPH = {
  ...BASE_GRAPH,
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.9 } },
  ],
};

/** Edit #1 built on BASE (adds churn). */
const EDIT_ONE_GRAPH = {
  ...BASE_GRAPH,
  nodes: [
    ...BASE_GRAPH.nodes,
    { id: 'fac_churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.2 } },
  ],
};

/** Edit #2, ALSO built on the same BASE (adds cost) — a stale-base concurrent edit. */
const EDIT_TWO_GRAPH = {
  ...BASE_GRAPH,
  nodes: [
    ...BASE_GRAPH.nodes,
    { id: 'fac_cost', kind: 'factor', label: 'Cost', observed_state: { value: 0.7 } },
  ],
};

const EXPECTED_BASE = computeExpectedGraphCasHashes(BASE_GRAPH);

function identityOf(raw: unknown): string {
  const parsed = GraphStateIngressSchema.safeParse(raw);
  if (!parsed.success) throw new Error('fixture must parse');
  const h = computeGraphIdentityHash(parsed.data);
  if (h === null) throw new Error('fixture must hash');
  return h.value;
}

const BASE_WRITE: SessionTurnWrite = {
  scenario_id: SCENARIO,
  turn_id: 'turn-cas',
  turn_class: 'direct_answer',
  handler_id: null,
  request_hash: 'sha256:abc',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 40,
  handler_facts: [],
};

/** Graph-bearing write from EDIT_ONE, carrying the trusted BASE as expected base. */
const GRAPH_WRITE: SessionTurnWrite = {
  ...BASE_WRITE,
  graph: EDIT_ONE_GRAPH,
  expectedGraphIdentityHash: EXPECTED_BASE.expectedGraphIdentityHash,
  expectedGraphAnalysisHash: EXPECTED_BASE.expectedGraphAnalysisHash,
};

function makeStore(client: SupabaseClient, graphCasMode?: GraphCasMode): SupabaseSessionStore {
  return new SupabaseSessionStore(
    client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
    { defaultReadLimit: 20, ...(graphCasMode !== undefined ? { graphCasMode } : {}) },
  );
}

/** Simple non-stateful client: pre-write SELECT returns a fixed graph. */
function makeClient(scenariosGraph: unknown): {
  client: SupabaseClient;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: 'row-id-123', error: null };
    }),
    from: vi.fn((table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: table === 'scenarios' ? { graph: scenariosGraph } : null,
            error: null,
          }),
        order: () => chain,
        limit: () => Promise.resolve({ data: [], error: null }),
        not: () => chain,
        in: () => chain,
      };
      return chain as never;
    }),
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

afterEach(() => {
  setTestSink(null);
});

describe('TRUST-SPINE T3 — CAS on the commit RPC (board #3)', () => {
  // POSITIVE CONTROL (regular it — GREEN today): a rejection IS observable through
  // this harness — the store CAN throw a typed stale-write error (in enforce mode).
  // Proves the RED assertions below are not vacuous.
  it('positive control: enforce mode DOES reject a stale-base write (rejection is observable)', async () => {
    const { client, rpcCalls } = makeClient(DIVERGED_GRAPH); // DB moved off BASE
    const store = makeStore(client, 'enforce');

    let thrown: unknown;
    try {
      await store.append(GRAPH_WRITE);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GraphStaleWriteError);
    expect(thrown).toBeInstanceOf(StateCommitFailedError);
    expect(rpcCalls).toHaveLength(0); // blocked pre-RPC
  });

  // TRUST-SPINE RED: flips to it() when board-item 3 lands.
  // Mechanical signature of "CAS on the commit RPC": the graph-write RPC must carry
  // an expected-base precondition so the DB gates the UPDATE. TODAY the RPC is
  // append_turn_atomic_v2 with 15 args and NO p_expected_graph_identity_hash — the
  // write is ungated. In the DEPLOYED posture (observe), assert the precondition arg
  // is present → throws today → RED.
  it.fails(
    'the deployed-posture graph-write RPC carries an expected-base CAS precondition',
    async () => {
      const { client, rpcCalls } = makeClient(BASE_GRAPH);
      const store = makeStore(client, 'observe'); // prod-downgraded posture
      await store.append(GRAPH_WRITE);

      const write = rpcCalls.find((c) => c.fn === 'append_turn_atomic_v2');
      expect(write).toBeDefined();
      // Honest future: the write is gated by a compare-and-swap precondition.
      expect(write!.args).toHaveProperty('p_expected_graph_identity_hash');
    },
  );

  // TRUST-SPINE RED: flips to it() when board-item 3 lands.
  // Behavioural: two edits from the SAME base — the second is a stale-base write and
  // must NOT silently clobber the first. Stateful fake DB models the real
  // unconditional `UPDATE scenarios SET graph` (last-write-wins) but HONOURS an
  // expected-base precondition when the write carries one (the honest-future CAS).
  // TODAY the store sends no precondition, so the second write clobbers the first →
  // the committed graph ends as EDIT_TWO, not EDIT_ONE → assertion throws → RED.
  it.fails(
    'a stale-base second commit does not silently clobber the first',
    async () => {
      let committed: unknown = BASE_GRAPH; // scenarios.graph at turn start
      const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

      const client = {
        rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
          rpcCalls.push({ fn, args });
          if (fn === 'append_turn_atomic_v2' && args.p_graph != null) {
            const precondition = args.p_expected_graph_identity_hash;
            if (precondition != null && precondition !== identityOf(committed)) {
              // Honest-future CAS: expected base no longer matches the committed
              // row → refuse the write, preserve what is committed.
              return { data: null, error: { message: 'graph stale base', code: 'P0001' } };
            }
            committed = args.p_graph; // unconditional UPDATE (today's behaviour)
          }
          return { data: `row-${rpcCalls.length}`, error: null };
        }),
        from: vi.fn((table: string) => {
          const chain = {
            select: () => chain,
            eq: () => chain,
            maybeSingle: () =>
              Promise.resolve({
                data: table === 'scenarios' ? { graph: committed } : null,
                error: null,
              }),
            order: () => chain,
            limit: () => Promise.resolve({ data: [], error: null }),
            not: () => chain,
            in: () => chain,
          };
          return chain as never;
        }),
      } as unknown as SupabaseClient;

      const store = makeStore(client, 'observe'); // deployed posture

      // Edit #1 from BASE → commits.
      await store.append({ ...GRAPH_WRITE, turn_id: 'turn-edit-1', graph: EDIT_ONE_GRAPH });
      const afterFirst = JSON.parse(JSON.stringify(committed));

      // Edit #2 ALSO from BASE (stale base) → today clobbers; honest future refuses.
      try {
        await store.append({ ...GRAPH_WRITE, turn_id: 'turn-edit-2', graph: EDIT_TWO_GRAPH });
      } catch {
        // An honest CAS may reject the stale write; the committed state is the pin.
      }

      // Honest future: edit #1 survives (edit #2's stale-base write did not clobber).
      expect(committed).toEqual(afterFirst);
    },
  );
});
