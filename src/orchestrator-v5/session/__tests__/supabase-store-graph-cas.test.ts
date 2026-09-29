/**
 * A3 graph CAS observe-mode — SupabaseSessionStore.append() hook tests.
 *
 * Mirrors the hand-rolled mock-client pattern of `supabase-store.test.ts`,
 * extended so the pre-write `scenarios` SELECT is configurable and
 * assertable independently of the RPC.
 *
 * Pins the observe-mode safety invariants:
 *  - flag-off → ZERO scenarios SELECTs and byte-identical RPC args vs today;
 *  - observe → the commit ALWAYS proceeds (conflicts, SELECT failures and
 *    hook faults included) — telemetry only;
 *  - enforce → ONLY analysis_affecting_conflict blocks (pre-RPC,
 *    GraphStaleWriteError extends StateCommitFailedError); self_noop,
 *    cosmetic, unavailable etc. always proceed;
 *  - telemetry payload carries hash prefixes + closed enums only, no prose.
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

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ── graph fixtures (same projection semantics as graph-cas-conflict.test) ──

/** Server base at turn start — the expected-hash source. */
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

/** Concurrent ANALYSIS-AFFECTING edit landed in the DB (value moved). */
const DIVERGED_GRAPH = {
  ...BASE_GRAPH,
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.9 } },
  ],
};

/** Concurrent COSMETIC edit landed in the DB (label-only change). */
const RELABELLED_GRAPH = {
  ...BASE_GRAPH,
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue (net)' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.5 } },
  ],
};

/** The graph this turn writes (built on BASE). */
const INCOMING_GRAPH = {
  ...BASE_GRAPH,
  nodes: [
    ...BASE_GRAPH.nodes,
    { id: 'fac_churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.2 } },
  ],
};

const EXPECTED_BASE = computeExpectedGraphCasHashes(BASE_GRAPH);

function idHash16(raw: unknown): string {
  const parsedGraph = GraphStateIngressSchema.safeParse(raw);
  if (!parsedGraph.success) throw new Error('fixture must parse');
  const h = computeGraphIdentityHash(parsedGraph.data);
  if (h === null) throw new Error('fixture must hash');
  return h.value.slice(0, 16);
}

// ── mock client: independent RPC + scenarios-SELECT control ────────

interface MockConfig {
  rpcResult?: { data?: unknown; error?: { message: string; code?: string } | null };
  /** Result of the pre-write scenarios SELECT (maybeSingle). */
  scenariosGraph?: unknown;
  scenariosSelectError?: { message: string; code?: string };
  /** Make the scenarios SELECT chain throw (hook-fault simulation). */
  scenariosSelectThrows?: boolean;
}

function makeClient(cfg: MockConfig = {}): {
  client: SupabaseClient;
  rpcCalls: Array<{ fn: string; args: unknown }>;
  scenarioSelects: Array<{ cols: string; filters: Record<string, unknown> }>;
} {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const scenarioSelects: Array<{ cols: string; filters: Record<string, unknown> }> = [];

  const client = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return cfg.rpcResult ?? { data: 'row-id-123', error: null };
    }),
    from: vi.fn((table: string) => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: (cols: string) => {
          if (table === 'scenarios') scenarioSelects.push({ cols, filters });
          return chain;
        },
        eq: (col: string, val: unknown) => {
          filters[`eq:${col}`] = val;
          return chain;
        },
        maybeSingle: () => {
          if (table !== 'scenarios') return Promise.resolve({ data: null, error: null });
          if (cfg.scenariosSelectThrows) throw new Error('simulated hook fault');
          if (cfg.scenariosSelectError) {
            return Promise.resolve({ data: null, error: cfg.scenariosSelectError });
          }
          return Promise.resolve({
            data: cfg.scenariosGraph === undefined ? null : { graph: cfg.scenariosGraph },
            error: null,
          });
        },
        order: () => chain,
        limit: () => Promise.resolve({ data: [], error: null }),
        not: () => chain,
        in: () => chain,
      };
      return chain as never;
    }),
  } as unknown as SupabaseClient;

  return { client, rpcCalls, scenarioSelects };
}

function makeStore(
  client: SupabaseClient,
  graphCasMode?: GraphCasMode,
): SupabaseSessionStore {
  return new SupabaseSessionStore(
    client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
    { defaultReadLimit: 20, ...(graphCasMode !== undefined ? { graphCasMode } : {}) },
  );
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

/** Instrumented graph-bearing write with the trusted expected base attached. */
const GRAPH_WRITE: SessionTurnWrite = {
  ...BASE_WRITE,
  graph: INCOMING_GRAPH,
  expectedGraphIdentityHash: EXPECTED_BASE.expectedGraphIdentityHash,
  expectedGraphAnalysisHash: EXPECTED_BASE.expectedGraphAnalysisHash,
};

type SunkEvent = { event: string; data: Record<string, unknown> };

function captureEvents(): SunkEvent[] {
  const events: SunkEvent[] = [];
  setTestSink((event, data) => events.push({ event, data }));
  return events;
}

afterEach(() => {
  setTestSink(null);
});

// ── clean write ─────────────────────────────────────────────────────

describe('A3 graph CAS — clean write (match)', () => {
  it('observe: current == expected base → match event, commit proceeds, RPC args unchanged', async () => {
    const events = captureEvents();
    const { client, rpcCalls, scenarioSelects } = makeClient({ scenariosGraph: BASE_GRAPH });
    const store = makeStore(client, 'observe');

    const result = await store.append(GRAPH_WRITE);
    expect(result.id).toBe('row-id-123');

    // Exactly one pre-write SELECT of scenarios.graph by PK.
    expect(scenarioSelects).toHaveLength(1);
    expect(scenarioSelects[0]!.cols).toBe('graph');
    expect(scenarioSelects[0]!.filters['eq:id']).toBe(SCENARIO);

    // RPC unchanged: same function, same 15 named args, no CAS params leak.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v2');
    const args = rpcCalls[0]!.args as Record<string, unknown>;
    expect(Object.keys(args)).toHaveLength(15);
    expect(args).not.toHaveProperty('p_expected_graph_identity_hash');

    const cas = events.filter((e) => e.event === 'v5.graph_cas.evaluated');
    expect(cas).toHaveLength(1);
    expect(cas[0]!.data.category).toBe('match');
    expect(cas[0]!.data.reason).toBe('expected_equals_current');
    expect(events.some((e) => e.event === 'v5.graph_cas.write_blocked')).toBe(false);
  });
});

// ── stale write ─────────────────────────────────────────────────────

describe('A3 graph CAS — stale write (analysis_affecting_conflict)', () => {
  it('observe: concurrent analysis-affecting edit → conflict event, commit STILL proceeds', async () => {
    const events = captureEvents();
    const { client, rpcCalls } = makeClient({ scenariosGraph: DIVERGED_GRAPH });
    const store = makeStore(client, 'observe');

    const result = await store.append(GRAPH_WRITE);
    expect(result.id).toBe('row-id-123');
    expect(rpcCalls).toHaveLength(1); // proceeded — observe never blocks

    const cas = events.filter((e) => e.event === 'v5.graph_cas.evaluated');
    expect(cas).toHaveLength(1);
    expect(cas[0]!.data.category).toBe('analysis_affecting_conflict');
    expect(cas[0]!.data.reason).toBe('analysis_projection_diverged');
    expect(cas[0]!.data.mode).toBe('observe');
    expect(events.some((e) => e.event === 'v5.graph_cas.write_blocked')).toBe(false);
  });

  it('enforce: conflict → GraphStaleWriteError pre-RPC, rpc NOT called, write_blocked emitted, instanceof StateCommitFailedError pinned', async () => {
    const events = captureEvents();
    const { client, rpcCalls } = makeClient({ scenariosGraph: DIVERGED_GRAPH });
    const store = makeStore(client, 'enforce');

    let thrown: unknown;
    try {
      await store.append(GRAPH_WRITE);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GraphStaleWriteError);
    // Load-bearing: rides the EXISTING typed failure envelope — every
    // TurnExecutor catch keys on `instanceof StateCommitFailedError`.
    expect(thrown).toBeInstanceOf(StateCommitFailedError);
    expect((thrown as GraphStaleWriteError).conflict_category).toBe(
      'analysis_affecting_conflict',
    );
    expect((thrown as Error).name).toBe('GraphStaleWriteError');

    // Blocked PRE-RPC: append_turn_atomic_v2 never invoked.
    expect(rpcCalls).toHaveLength(0);

    expect(events.filter((e) => e.event === 'v5.graph_cas.evaluated')).toHaveLength(1);
    const blocked = events.filter((e) => e.event === 'v5.graph_cas.write_blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.data.category).toBe('analysis_affecting_conflict');
    expect(blocked[0]!.data.mode).toBe('enforce');
  });

  it('telemetry payload shape: closed enums + 16-hex/null hashes + timing only — no prose, no raw graph', async () => {
    const events = captureEvents();
    const { client } = makeClient({ scenariosGraph: DIVERGED_GRAPH });
    const store = makeStore(client, 'observe');
    await store.append(GRAPH_WRITE);

    const data = events.find((e) => e.event === 'v5.graph_cas.evaluated')!.data;
    // Exact key set — nothing else may ride along (privacy contract).
    expect(Object.keys(data).sort()).toEqual([
      'category',
      'current_analysis_hash',
      'current_identity_hash',
      'expected_analysis_hash',
      'expected_identity_hash',
      'incoming_identity_hash',
      'mode',
      'reason',
      'scenario_id',
      'select_failed',
      'select_ms',
      'turn_id',
    ]);
    // Identity hashes are 16-hex PREFIXES of the 64-hex values.
    expect(data.expected_identity_hash).toBe(
      EXPECTED_BASE.expectedGraphIdentityHash!.slice(0, 16),
    );
    expect(data.current_identity_hash).toBe(idHash16(DIVERGED_GRAPH));
    expect(data.incoming_identity_hash).toBe(idHash16(INCOMING_GRAPH));
    for (const key of [
      'expected_identity_hash',
      'current_identity_hash',
      'incoming_identity_hash',
      'expected_analysis_hash',
      'current_analysis_hash',
    ] as const) {
      expect(data[key]).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(typeof data.select_ms).toBe('number');
    expect(data.select_failed).toBe(false);
    // No graph content: serialised payload never contains a node label.
    expect(JSON.stringify(data)).not.toContain('Revenue');
    expect(JSON.stringify(data)).not.toContain('Churn');
  });
});

// ── cosmetic concurrent edit ────────────────────────────────────────

describe('A3 graph CAS — cosmetic concurrent edit', () => {
  it.each(['observe', 'enforce'] as const)(
    '%s: label-only concurrent edit → cosmetic_concurrent_edit, commit proceeds',
    async (mode) => {
      const events = captureEvents();
      const { client, rpcCalls } = makeClient({ scenariosGraph: RELABELLED_GRAPH });
      const store = makeStore(client, mode);

      const result = await store.append(GRAPH_WRITE);
      expect(result.id).toBe('row-id-123');
      expect(rpcCalls).toHaveLength(1); // never blocked — cosmetic is observed only

      const cas = events.find((e) => e.event === 'v5.graph_cas.evaluated')!;
      expect(cas.data.category).toBe('cosmetic_concurrent_edit');
      expect(events.some((e) => e.event === 'v5.graph_cas.write_blocked')).toBe(false);
    },
  );
});

// ── self_noop acceptance case ───────────────────────────────────────

describe('A3 graph CAS — self_noop (idempotent replay safety)', () => {
  it.each(['observe', 'enforce'] as const)(
    '%s: incoming == current while the expected base is stale → self_noop, NEVER blocked',
    async (mode) => {
      // The DB has moved to DIVERGED (stale enough that a naive classifier
      // would call this an analysis-affecting conflict against the BASE
      // expected hashes) — but the incoming write carries exactly the
      // current DB content: a duplicate submission / idempotent replay.
      const events = captureEvents();
      const { client, rpcCalls } = makeClient({ scenariosGraph: DIVERGED_GRAPH });
      const store = makeStore(client, mode);

      const result = await store.append({
        ...GRAPH_WRITE,
        graph: DIVERGED_GRAPH, // incoming == current
      });
      expect(result.id).toBe('row-id-123');
      expect(rpcCalls).toHaveLength(1); // enforce does NOT block self_noop

      const cas = events.find((e) => e.event === 'v5.graph_cas.evaluated')!;
      expect(cas.data.category).toBe('self_noop');
      expect(cas.data.category).not.toBe('cosmetic_concurrent_edit');
      expect(cas.data.category).not.toBe('analysis_affecting_conflict');
      expect(cas.data.reason).toBe('incoming_equals_current');
      expect(events.some((e) => e.event === 'v5.graph_cas.write_blocked')).toBe(false);
    },
  );
});

// ── SELECT failure / hook fault — never blocks ──────────────────────

describe('A3 graph CAS — unavailable paths always proceed', () => {
  it.each(['observe', 'enforce'] as const)(
    '%s: scenarios SELECT error → unavailable/select_failed, commit proceeds',
    async (mode) => {
      const events = captureEvents();
      const { client, rpcCalls } = makeClient({
        scenariosSelectError: { message: 'connection reset', code: 'ECONNRESET' },
      });
      const store = makeStore(client, mode);

      const result = await store.append(GRAPH_WRITE);
      expect(result.id).toBe('row-id-123');
      expect(rpcCalls).toHaveLength(1);

      const cas = events.find((e) => e.event === 'v5.graph_cas.evaluated')!;
      expect(cas.data.category).toBe('unavailable');
      expect(cas.data.reason).toBe('select_failed');
      expect(cas.data.select_failed).toBe(true);
      expect(events.some((e) => e.event === 'v5.graph_cas.write_blocked')).toBe(false);
    },
  );

  it('observe: hook fault (SELECT chain throws) → unavailable/observe_hook_failed, commit proceeds', async () => {
    const events = captureEvents();
    const { client, rpcCalls } = makeClient({ scenariosSelectThrows: true });
    const store = makeStore(client, 'observe');

    const result = await store.append(GRAPH_WRITE);
    expect(result.id).toBe('row-id-123');
    expect(rpcCalls).toHaveLength(1);

    const cas = events.find((e) => e.event === 'v5.graph_cas.evaluated')!;
    expect(cas.data.category).toBe('unavailable');
    expect(cas.data.reason).toBe('observe_hook_failed');
    expect(cas.data.select_ms).toBeNull();
  });

  it('observe: a throwing telemetry sink still cannot fail the commit', async () => {
    setTestSink(() => {
      throw new Error('sink boom');
    });
    const { client, rpcCalls } = makeClient({ scenariosGraph: DIVERGED_GRAPH });
    const store = makeStore(client, 'observe');
    const result = await store.append(GRAPH_WRITE);
    expect(result.id).toBe('row-id-123');
    expect(rpcCalls).toHaveLength(1);
  });
});

// ── flag-off: byte-identical write path ─────────────────────────────

describe('A3 graph CAS — flag off (default)', () => {
  it('mode off / absent → ZERO scenarios SELECTs and byte-identical RPC args vs today', async () => {
    const events = captureEvents();

    // Store with the option absent entirely (today's construction shape).
    const legacy = makeClient({ scenariosGraph: DIVERGED_GRAPH });
    const legacyStore = makeStore(legacy.client);
    await legacyStore.append(GRAPH_WRITE);

    // Store with mode explicitly 'off'.
    const off = makeClient({ scenariosGraph: DIVERGED_GRAPH });
    const offStore = makeStore(off.client, 'off');
    await offStore.append(GRAPH_WRITE);

    // Zero pre-write SELECTs on both.
    expect(legacy.scenarioSelects).toHaveLength(0);
    expect(off.scenarioSelects).toHaveLength(0);

    // Byte-identical RPC invocation between absent-option and off — and the
    // canonical 15-name arg shape (no CAS additions).
    expect(off.rpcCalls[0]!.fn).toBe(legacy.rpcCalls[0]!.fn);
    expect(JSON.stringify(off.rpcCalls[0]!.args)).toBe(
      JSON.stringify(legacy.rpcCalls[0]!.args),
    );
    expect(Object.keys(off.rpcCalls[0]!.args as Record<string, unknown>).sort()).toEqual([
      'p_assistant_message',
      'p_brief_text',
      'p_coaching_state',
      'p_duration_ms',
      'p_graph',
      'p_handler_facts',
      'p_handler_id',
      'p_llm_calls_used',
      'p_pending_actions',
      'p_request_hash',
      'p_response_emitted',
      'p_scenario_id',
      'p_turn_class',
      'p_turn_id',
      'p_user_message',
    ]);

    // No CAS telemetry at all.
    expect(events.filter((e) => e.event.startsWith('v5.graph_cas'))).toHaveLength(0);
  });

  it('graph-absent writes never trigger the hook even when observing (chip-click / system-event shape)', async () => {
    const events = captureEvents();
    const { client, rpcCalls, scenarioSelects } = makeClient();
    const store = makeStore(client, 'observe');
    await store.append(BASE_WRITE); // no graph on the write
    expect(scenarioSelects).toHaveLength(0);
    expect(rpcCalls).toHaveLength(1);
    expect(events.filter((e) => e.event.startsWith('v5.graph_cas'))).toHaveLength(0);
  });
});

// ── uninstrumented / first-write shapes through the live hook ───────

describe('A3 graph CAS — no_expected / first_write through the hook', () => {
  it('uninstrumented write (no expected hashes) on an existing graph → no_expected, proceeds under enforce', async () => {
    const events = captureEvents();
    const { client, rpcCalls } = makeClient({ scenariosGraph: DIVERGED_GRAPH });
    const store = makeStore(client, 'enforce');
    await store.append({ ...BASE_WRITE, graph: INCOMING_GRAPH }); // expected* undefined
    expect(rpcCalls).toHaveLength(1);
    const cas = events.find((e) => e.event === 'v5.graph_cas.evaluated')!;
    expect(cas.data.category).toBe('no_expected');
    expect(cas.data.reason).toBe('not_instrumented');
    expect(cas.data.expected_identity_hash).toBeNull();
  });

  it('fresh scenario (no current graph, no expected base) → first_write, proceeds under enforce', async () => {
    const events = captureEvents();
    const { client, rpcCalls } = makeClient({ scenariosGraph: null });
    const store = makeStore(client, 'enforce');
    await store.append({
      ...BASE_WRITE,
      graph: INCOMING_GRAPH,
      expectedGraphIdentityHash: null,
      expectedGraphAnalysisHash: null,
    });
    expect(rpcCalls).toHaveLength(1);
    const cas = events.find((e) => e.event === 'v5.graph_cas.evaluated')!;
    expect(cas.data.category).toBe('first_write');
  });
});
