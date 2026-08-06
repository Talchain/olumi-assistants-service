/**
 * V5 TURN FENCE — FIRST-WRITE EXEMPTION (ROADMAP 2.709, the fresh-journey P0).
 *
 * THE DEFECT (diagnosed at the wire and in Render logs — see
 * PHASE0-EVIDENCE-2026-07-28/fresh-journey-p0-diagnosis-2026-08-08.md §1.2):
 * a FIRST draft's graph commit was refused `superseded` because a mid-draft
 * QUESTION (a turn that writes no graph) claimed a higher generation. The
 * atomic rollback discarded graph AND turn row, the UI kept the GRAPH_READY
 * preview, and the scenario was left a PHANTOM — canvas shows a model,
 * `scenarios.graph` is NULL, zero committed turns.
 *
 * THE RULE THIS SUITE PINS (invariant 2 of the diagnosis §4): a graph write
 * whose fence verdict is `superseded` is ALLOWED iff the scenario holds NO
 * committed graph at commit time (`scenarios.graph IS NULL`) — that single
 * condition is simultaneously "this is the scenario's first graph write" and
 * "no later graph write has landed", so the supersede protection is preserved
 * exactly where it protects something (a real, newer model) and withdrawn
 * exactly where it destroys the only model the scenario has ever had.
 *
 * WHAT MUST SURVIVE UNCHANGED (the Stop-fence P0 protections):
 *   · `stopped` (OLTF1) refuses regardless of graph presence — an explicit
 *     user Stop is never exempted;
 *   · `superseded` with a committed graph present refuses exactly as before
 *     (the original clobber defect);
 *   · `unclaimed` / `unavailable` fail closed exactly as before.
 *
 * THE THREE LAYERS UNDER TEST HERE (app-side; the SQL mirror is pinned by
 * turn-fence-first-write-exemption-migration-static-guards.test.ts):
 *   1. CHECKED path (v4 missing → pre-v4 evaluate-then-append): exemption
 *      decided app-side after the evaluate.
 *   2. ATOMIC path, PRE-migration DB (v4 raises OLTF2 unconditionally, the
 *      staging semantics at 4c835ced): OLTF2 → recovery — re-read scenario
 *      graph presence, re-evaluate the fence (fresh stopped check), then
 *      dispatch the pre-v4 append. This is what makes the fix live on DEPLOY,
 *      before the Paul-gated migration executes.
 *   3. ATOMIC path, POST-migration DB (v4 itself exempts): the fake models
 *      the new SQL and the append simply succeeds.
 *
 * Invariant 6 rider (persistence failure is never dark): every graph-bearing
 * fence REFUSAL leaves a trace on the turn's own fence row
 * (`graph_write_failed_at` + reason), keyed by the SLOT identity (the claim's
 * key) — never by the commit metadata's write identity, which turn-executor
 * commits populate with the server request_id (the 2.301 outage lesson).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import type { SessionTurnWrite } from '../store.js';
import {
  runWithTurnFence,
  TurnFenceRejectedError,
  type TurnFenceHandle,
} from '../turn-fence.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO = 'f1000000-0000-4000-8000-000000000001';
const TURN_A = 'f1000000-0000-4000-8000-00000000000a'; // the draft turn
const TURN_B = 'f1000000-0000-4000-8000-00000000000b'; // the mid-draft interrupt

const GRAPH_A = {
  nodes: [{ id: 'n_first', kind: 'factor', label: 'First Draft Probe' }],
  edges: [],
};
const GRAPH_RIVAL = {
  nodes: [{ id: 'n_rival', kind: 'factor', label: 'Rival Model' }],
  edges: [],
};

// ── Fence + scenario-state fake ─────────────────────────────────────────────
// Models: claim/evaluate/stop RPCs (same shape as the sibling fence fakes),
// append_turn_atomic_v2/v4 with a SEMANTICS TOGGLE for v4 (pre-exemption =
// the SQL executed on staging at 4c835ced, raises OLTF2 whenever
// generation < max; exempt = migration 20260806120000, raises OLTF2 only
// when the scenario holds a graph), and a filter-aware `.from()` so the
// store's scenario-graph-presence read and the fence-row failure mark are
// exercised against recorded state rather than a chain of no-ops.

interface FenceRow {
  generation: number;
  scenarioId: string;
  turnId: string;
  stoppedAt: string | null;
  graphWriteFailedAt: string | null;
  graphWriteFailureReason: string | null;
}

interface Filter {
  op: 'eq' | 'neq' | 'is' | 'not';
  col: string;
  val: unknown;
}

interface ExemptionBackend {
  client: SupabaseClient;
  storedGraph: () => unknown;
  setStoredGraph: (g: unknown) => void;
  rows: FenceRow[];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  updateCalls: Array<{ table: string; values: Record<string, unknown>; filters: Filter[] }>;
  /** v4 gate semantics — 'pre_exemption' models the DB deployed at 4c835ced. */
  v4Semantics: 'pre_exemption' | 'exempt';
  v4Missing: boolean;
  /** When set, the fence-mark UPDATE answers 42703 (column not migrated). */
  markColumnMissing: boolean;
  /** Runs at the top of the NEXT v5_evaluate_turn_fence call (recovery window). */
  onBeforeEvaluate: (() => void) | null;
  stop: (turnId: string) => void;
  claim: (turnId: string) => number;
}

function makeBackend(): ExemptionBackend {
  const rows: FenceRow[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const updateCalls: Array<{ table: string; values: Record<string, unknown>; filters: Filter[] }> =
    [];
  const committedTurnIds = new Set<string>();
  let sequence = 0;
  let graph: unknown = null;

  const find = (scenarioId: string, turnId: string): FenceRow | undefined =>
    rows.find((r) => r.scenarioId === scenarioId && r.turnId === turnId);

  const backend: ExemptionBackend = {
    client: null as never,
    storedGraph: () => graph,
    setStoredGraph: (g: unknown) => {
      graph = g;
    },
    rows,
    rpcCalls,
    updateCalls,
    v4Semantics: 'pre_exemption',
    v4Missing: false,
    markColumnMissing: false,
    onBeforeEvaluate: null,
    stop: (turnId: string) => {
      const existing = find(SCENARIO, turnId);
      if (existing) {
        existing.stoppedAt = existing.stoppedAt ?? new Date().toISOString();
      } else {
        sequence += 1;
        rows.push({
          generation: sequence,
          scenarioId: SCENARIO,
          turnId,
          stoppedAt: new Date().toISOString(),
          graphWriteFailedAt: null,
          graphWriteFailureReason: null,
        });
      }
    },
    claim: (turnId: string) => {
      const existing = find(SCENARIO, turnId);
      if (existing) return existing.generation;
      sequence += 1;
      rows.push({
        generation: sequence,
        scenarioId: SCENARIO,
        turnId,
        stoppedAt: null,
        graphWriteFailedAt: null,
        graphWriteFailureReason: null,
      });
      return sequence;
    },
  };

  const maxGeneration = (scenarioId: string): number | null => {
    const scenarioRows = rows.filter((r) => r.scenarioId === scenarioId);
    return scenarioRows.length === 0 ? null : Math.max(...scenarioRows.map((r) => r.generation));
  };

  // Filter-aware query builder. Thenable so any chain shape can be awaited;
  // `limit()` also resolves, matching the store's read shapes.
  function makeBuilder(table: string): Record<string, unknown> {
    const filters: Filter[] = [];
    let updateValues: Record<string, unknown> | null = null;

    const matchesFence = (r: FenceRow): boolean =>
      filters.every((f) => {
        const value =
          f.col === 'scenario_id'
            ? r.scenarioId
            : f.col === 'turn_id'
              ? r.turnId
              : f.col === 'stopped_at'
                ? r.stoppedAt
                : f.col === 'generation'
                  ? r.generation
                  : f.col === 'graph_write_failed_at'
                    ? r.graphWriteFailedAt
                    : undefined;
        if (f.op === 'eq') return value === f.val;
        if (f.op === 'neq') return value !== f.val;
        if (f.op === 'is') return f.val === null ? value === null : value === f.val;
        if (f.op === 'not') return !(f.val === null ? value === null : value === f.val);
        return false;
      });

    const execute = (): { data: unknown; error: { code?: string; message: string } | null } => {
      if (table === 'scenarios') {
        // The graph-presence read: eq id + not(graph, is, null).
        const idFilter = filters.find((f) => f.op === 'eq' && f.col === 'id');
        const graphNotNull = filters.some((f) => f.op === 'not' && f.col === 'graph');
        if (idFilter?.val !== SCENARIO) return { data: [], error: null };
        if (graphNotNull) return { data: graph !== null ? [{ id: SCENARIO }] : [], error: null };
        return { data: [{ id: SCENARIO }], error: null };
      }
      if (table === 'v5_conversation_turns') {
        // The replay-passthrough read: eq scenario_id + eq turn_id.
        const turnIdFilter = filters.find((f) => f.op === 'eq' && f.col === 'turn_id');
        const committed =
          typeof turnIdFilter?.val === 'string' && committedTurnIds.has(turnIdFilter.val);
        return { data: committed ? [{ id: `row-${String(turnIdFilter!.val)}` }] : [], error: null };
      }
      if (table === 'v5_turn_fence') {
        if (updateValues !== null) {
          if (backend.markColumnMissing) {
            return {
              data: null,
              error: { code: '42703', message: 'column "graph_write_failed_at" does not exist' },
            };
          }
          updateCalls.push({ table, values: updateValues, filters: [...filters] });
          for (const r of rows) {
            if (matchesFence(r)) {
              r.graphWriteFailedAt = String(updateValues.graph_write_failed_at ?? null);
              r.graphWriteFailureReason = String(updateValues.graph_write_failure_reason ?? null);
            }
          }
          return { data: null, error: null };
        }
        return { data: rows.filter(matchesFence).map((r) => ({ generation: r.generation })), error: null };
      }
      return { data: [], error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (vals: Record<string, unknown>) => {
        updateValues = vals;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push({ op: 'eq', col, val });
        return builder;
      },
      neq: (col: string, val: unknown) => {
        filters.push({ op: 'neq', col, val });
        return builder;
      },
      is: (col: string, val: unknown) => {
        filters.push({ op: 'is', col, val });
        return builder;
      },
      not: (col: string, _op: string, val: unknown) => {
        filters.push({ op: 'not', col, val });
        return builder;
      },
      order: () => builder,
      limit: () => Promise.resolve(execute()),
      maybeSingle: () => {
        const { data, error } = execute();
        const rowsOut = Array.isArray(data) ? data : [];
        return Promise.resolve({ data: rowsOut[0] ?? null, error });
      },
      then: (
        resolve: (v: { data: unknown; error: unknown }) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(execute()).then(resolve, reject),
    };
    return builder;
  }

  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const scenarioId = String(args.p_scenario_id ?? '');
      const turnId = String(args.p_turn_id ?? '');

      if (fn === 'v5_claim_turn_fence') {
        return { data: backend.claim(turnId), error: null };
      }
      if (fn === 'v5_evaluate_turn_fence') {
        if (backend.onBeforeEvaluate !== null) {
          const hook = backend.onBeforeEvaluate;
          backend.onBeforeEvaluate = null;
          hook();
        }
        const mine = find(scenarioId, turnId);
        return {
          data: {
            claimed: mine !== undefined,
            stopped: mine?.stoppedAt != null,
            generation: mine?.generation ?? null,
            max_generation: maxGeneration(scenarioId),
          },
          error: null,
        };
      }
      if (fn === 'v5_mark_turn_stopped') {
        backend.stop(turnId);
        return { data: { stopped: true, claimed: true, already_committed: false }, error: null };
      }

      if (fn.startsWith('append_turn_atomic')) {
        if (fn === 'append_turn_atomic_v4') {
          if (backend.v4Missing) {
            return {
              data: null,
              error: { code: 'PGRST202', message: 'append_turn_atomic_v4 not in schema cache' },
            };
          }
          const fenceGeneration = args.p_fence_generation as number | null;
          if (fenceGeneration != null && args.p_graph != null) {
            const mine = rows.find(
              (r) => r.scenarioId === scenarioId && r.generation === fenceGeneration,
            );
            if (mine === undefined) {
              return {
                data: null,
                error: { code: 'OLTF3', message: 'v4: no fence row', details: '{}' },
              };
            }
            if (mine.stoppedAt !== null) {
              return {
                data: null,
                error: {
                  code: 'OLTF1',
                  message: 'v4: turn stopped',
                  details: JSON.stringify({
                    generation: mine.generation,
                    max_generation: maxGeneration(scenarioId),
                  }),
                },
              };
            }
            const max = maxGeneration(scenarioId) ?? mine.generation;
            const superseded = fenceGeneration < max;
            // The semantics toggle — 'exempt' mirrors migration 20260806120000:
            // OLTF2 raises ONLY when the scenario already holds a graph.
            const raiseSuperseded =
              backend.v4Semantics === 'pre_exemption' ? superseded : superseded && graph !== null;
            if (raiseSuperseded) {
              return {
                data: null,
                error: {
                  code: 'OLTF2',
                  message: 'v4: superseded',
                  details: JSON.stringify({ generation: fenceGeneration, max_generation: max }),
                },
              };
            }
          }
        }
        if (args.p_graph != null) {
          graph = args.p_graph;
        }
        committedTurnIds.add(turnId);
        return { data: `row-${turnId}`, error: null };
      }

      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    }),
    from: vi.fn((table: string) => makeBuilder(table) as never),
  } as unknown as SupabaseClient;

  backend.client = client;
  return backend;
}

function makeStore(client: SupabaseClient): SupabaseSessionStore {
  return new SupabaseSessionStore(
    client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
    { defaultReadLimit: 20 },
  );
}

function write(turnId: string, graph?: unknown): SessionTurnWrite {
  return {
    scenario_id: SCENARIO,
    turn_id: turnId,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: 'sha256:fixture',
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 50_000,
    handler_facts: [],
    ...(graph !== undefined ? { graph } : {}),
  };
}

function handleFor(generation: number, turnId: string): TurnFenceHandle {
  return { scenarioId: SCENARIO, turnId, generation };
}

/** The diagnosis's induced repro, as state: draft admitted, interrupt claims. */
function phantomSetup(backend: ExemptionBackend): { draftGen: number } {
  const draftGen = backend.claim(TURN_A); // the draft turn's admission (gen 1)
  backend.claim(TURN_B); // the mid-draft interrupt claims gen 2
  return { draftGen };
}

let events: Array<{ event: string; payload: Record<string, unknown> }> = [];

beforeEach(() => {
  events = [];
  setTestSink((event, payload) => events.push({ event, payload }));
});
afterEach(() => {
  setTestSink(null);
});

// ═══ 1. CHECKED path (v4 missing — pre-v4 evaluate-then-append) ═══════════

describe('first-write exemption — CHECKED path (v4 not migrated)', () => {
  it('REPRO→FIX: a superseded FIRST draft commit on a graph-less scenario COMMITS (was: refused, the phantom state)', async () => {
    const backend = makeBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);

    const result = await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
      store.append(write(TURN_A, GRAPH_A)),
    );

    expect(result.id).toBe(`row-${TURN_A}`);
    expect(backend.storedGraph()).toEqual(GRAPH_A);
    // The exemption is telemetered, and the refusal event must NOT fire.
    expect(events.some((e) => e.event === 'v5.turn_fence.first_write_exemption')).toBe(true);
    expect(events.some((e) => e.event === 'v5.turn_fence.graph_write_refused')).toBe(false);
  });

  it('CONTROL (protection unchanged): superseded with a COMMITTED graph present still refuses', async () => {
    const backend = makeBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    backend.setStoredGraph(GRAPH_RIVAL); // the newer turn's graph has landed

    await expect(
      runWithTurnFence(handleFor(draftGen, TURN_A), () => store.append(write(TURN_A, GRAPH_A))),
    ).rejects.toThrow(TurnFenceRejectedError);
    expect(backend.storedGraph()).toEqual(GRAPH_RIVAL); // nothing clobbered
    expect(events.some((e) => e.event === 'v5.turn_fence.first_write_exemption')).toBe(false);
  });

  it('CONTROL (OLTF1 unchanged): an explicitly STOPPED first draft still refuses on a graph-less scenario', async () => {
    const backend = makeBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    backend.stop(TURN_A);

    let thrown: unknown = null;
    try {
      await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
        store.append(write(TURN_A, GRAPH_A)),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TurnFenceRejectedError);
    expect((thrown as TurnFenceRejectedError).verdict).toBe('stopped');
    expect(backend.storedGraph()).toBeNull();
  });

  it('fail-closed: a failing scenario-graph read refuses the superseded write (cannot prove first-write)', async () => {
    const backend = makeBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    // Break the scenarios read only.
    const realFrom = (backend.client.from as ReturnType<typeof vi.fn>).getMockImplementation()! as (
      table: string,
    ) => unknown;
    (backend.client.from as ReturnType<typeof vi.fn>).mockImplementation(((table: string) => {
      if (table === 'scenarios') {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                limit: () =>
                  Promise.resolve({ data: null, error: { message: 'read blew up' } }),
              }),
            }),
          }),
        } as never;
      }
      return realFrom(table);
    }) as never);

    await expect(
      runWithTurnFence(handleFor(draftGen, TURN_A), () => store.append(write(TURN_A, GRAPH_A))),
    ).rejects.toThrow(TurnFenceRejectedError);
    expect(backend.storedGraph()).toBeNull();
  });
});

// ═══ 2. ATOMIC path against the PRE-migration DB (the deploy-first window) ═

describe('first-write exemption — ATOMIC path, pre-migration v4 (OLTF2 recovery)', () => {
  it('REPRO→FIX: OLTF2 on a graph-less scenario recovers via the pre-v4 append and COMMITS', async () => {
    const backend = makeBackend();
    backend.v4Semantics = 'pre_exemption';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);

    const result = await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
      store.append(write(TURN_A, GRAPH_A)),
    );

    expect(result.id).toBe(`row-${TURN_A}`);
    expect(backend.storedGraph()).toEqual(GRAPH_A);
    // The recovery re-evaluated the fence (fresh stopped check) before committing.
    expect(backend.rpcCalls.some((c) => c.fn === 'v5_evaluate_turn_fence')).toBe(true);
    expect(events.some((e) => e.event === 'v5.turn_fence.first_write_exemption')).toBe(true);
  });

  it('CONTROL: OLTF2 with a committed graph present refuses — no recovery attempt commits', async () => {
    const backend = makeBackend();
    backend.v4Semantics = 'pre_exemption';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    backend.setStoredGraph(GRAPH_RIVAL);

    let thrown: unknown = null;
    try {
      await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
        store.append(write(TURN_A, GRAPH_A)),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TurnFenceRejectedError);
    expect((thrown as TurnFenceRejectedError).verdict).toBe('superseded');
    expect(backend.storedGraph()).toEqual(GRAPH_RIVAL);
  });

  it('arrival-8 replay: retrying an exempt-committed turn returns the SAME row id, never a 500 (found by the migration rehearsal)', async () => {
    const backend = makeBackend();
    backend.v4Semantics = 'pre_exemption';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);

    const first = await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
      store.append(write(TURN_A, GRAPH_A)),
    );
    // The retry arrives with the scenario now holding the turn's OWN graph:
    // OLTF2 fires again (pre-migration v4), the exemption no longer applies
    // (graph present), and the recovery must answer with the committed row
    // id instead of manufacturing a false 500 about a persisted turn.
    const replay = await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
      store.append(write(TURN_A, GRAPH_A)),
    );
    expect(replay.id).toBe(first.id);
    expect(backend.storedGraph()).toEqual(GRAPH_A);
  });

  it('a Stop landing inside the recovery window refuses with verdict STOPPED, not a commit', async () => {
    const backend = makeBackend();
    backend.v4Semantics = 'pre_exemption';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    // The rival Stop lands between the OLTF2 rollback and the recovery's
    // fence re-evaluation — the strongest ordering, deterministic.
    backend.onBeforeEvaluate = () => backend.stop(TURN_A);

    let thrown: unknown = null;
    try {
      await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
        store.append(write(TURN_A, GRAPH_A)),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TurnFenceRejectedError);
    expect((thrown as TurnFenceRejectedError).verdict).toBe('stopped');
    expect(backend.storedGraph()).toBeNull();
  });
});

// ═══ 3. ATOMIC path against the POST-migration DB (SQL exempts in-transaction) ═

describe('first-write exemption — ATOMIC path, post-migration v4', () => {
  it('the migrated v4 commits a superseded first write itself (no recovery round trips)', async () => {
    const backend = makeBackend();
    backend.v4Semantics = 'exempt';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);

    const result = await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
      store.append(write(TURN_A, GRAPH_A)),
    );
    expect(result.id).toBe(`row-${TURN_A}`);
    expect(backend.storedGraph()).toEqual(GRAPH_A);
    // Single append RPC — no OLTF2, no evaluate, no second append.
    expect(backend.rpcCalls.filter((c) => c.fn.startsWith('append_turn_atomic')).length).toBe(1);
  });

  it('CONTROL: the migrated v4 still refuses a superseded write over a committed graph', async () => {
    const backend = makeBackend();
    backend.v4Semantics = 'exempt';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    backend.setStoredGraph(GRAPH_RIVAL);

    await expect(
      runWithTurnFence(handleFor(draftGen, TURN_A), () => store.append(write(TURN_A, GRAPH_A))),
    ).rejects.toThrow(TurnFenceRejectedError);
    expect(backend.storedGraph()).toEqual(GRAPH_RIVAL);
  });
});

// ═══ 4. Invariant 6 — the failure trace ═══════════════════════════════════

describe('graph-write failure trace (invariant 6)', () => {
  it('a fence refusal marks the turn fence row (graph_write_failed_at + reason)', async () => {
    const backend = makeBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    backend.setStoredGraph(GRAPH_RIVAL); // makes the supersede a genuine refusal

    await expect(
      runWithTurnFence(handleFor(draftGen, TURN_A), () => store.append(write(TURN_A, GRAPH_A))),
    ).rejects.toThrow(TurnFenceRejectedError);

    const row = backend.rows.find((r) => r.turnId === TURN_A);
    expect(row?.graphWriteFailedAt).toBeTruthy();
    expect(row?.graphWriteFailureReason).toBe('superseded');
  });

  it('the mark binds to the SLOT identity, never the commit metadata write identity (2.301 lesson)', async () => {
    const backend = makeBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    backend.setStoredGraph(GRAPH_RIVAL);

    // Turn-executor shape: the WRITE carries the server request id, while the
    // fence row was claimed under the ingress turn id (TURN_A).
    const executorWrite = { ...write('req-777-server-id', GRAPH_A) };

    await expect(
      runWithTurnFence(handleFor(draftGen, TURN_A), () => store.append(executorWrite)),
    ).rejects.toThrow(TurnFenceRejectedError);

    // Discriminating pair: the SLOT row is marked…
    const slotRow = backend.rows.find((r) => r.turnId === TURN_A);
    expect(slotRow?.graphWriteFailedAt).toBeTruthy();
    // …and no mark was attempted against the write identity.
    const writeIdFilters = backend.updateCalls.flatMap((c) => c.filters);
    expect(writeIdFilters.some((f) => f.val === 'req-777-server-id')).toBe(false);
  });

  it('an EXEMPTED commit leaves no failure mark, and neither does a clean commit', async () => {
    const backend = makeBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);

    await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
      store.append(write(TURN_A, GRAPH_A)),
    );
    expect(backend.rows.find((r) => r.turnId === TURN_A)?.graphWriteFailedAt).toBeNull();
    expect(backend.updateCalls.length).toBe(0);
  });

  it('a missing mark column (pre-migration DB) degrades loudly but never changes the refusal', async () => {
    const backend = makeBackend();
    backend.v4Missing = true;
    backend.markColumnMissing = true;
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    backend.setStoredGraph(GRAPH_RIVAL);

    let thrown: unknown = null;
    try {
      await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
        store.append(write(TURN_A, GRAPH_A)),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TurnFenceRejectedError);
    expect((thrown as TurnFenceRejectedError).verdict).toBe('superseded');
  });
});

// ═══ 5. Invariant 3 — the fence-table continuation read ═══════════════════

describe('hasOtherAdmittedLiveTurn (invariant 3 read)', () => {
  it('sees an ADMITTED in-flight turn by another turn id, excluding self and failure-marked rows', async () => {
    const backend = makeBackend();
    const store = makeStore(backend.client);
    backend.claim(TURN_A); // the in-flight draft

    // From the interrupt's perspective (TURN_B excluded = itself):
    backend.claim(TURN_B);
    await expect(store.hasOtherAdmittedLiveTurn(SCENARIO, TURN_B)).resolves.toBe(true);

    // A scenario whose ONLY other row is failure-marked reads false — the
    // post-loss state must classify fresh so a re-sent brief can redraft.
    const row = backend.rows.find((r) => r.turnId === TURN_A)!;
    row.graphWriteFailedAt = new Date().toISOString();
    await expect(store.hasOtherAdmittedLiveTurn(SCENARIO, TURN_B)).resolves.toBe(false);
  });

  it('a self-only scenario reads false (the asking turn’s own claim never counts)', async () => {
    const backend = makeBackend();
    const store = makeStore(backend.client);
    backend.claim(TURN_A);
    await expect(store.hasOtherAdmittedLiveTurn(SCENARIO, TURN_A)).resolves.toBe(false);
  });
});
