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
  /** ROADMAP 2.735 — a graph the USER had was lost (preview streamed, or a commit attempted). */
  graphLossDisclosableAt: string | null;
  /** ROADMAP 2.735 — a later commit ended the loss. */
  graphLossResolvedAt: string | null;
}

/** Every field a freshly-claimed fence row starts with. One place, so a new column cannot be forgotten in one of the two constructors. */
function blankMarks(): Pick<
  FenceRow,
  'graphWriteFailedAt' | 'graphWriteFailureReason' | 'graphLossDisclosableAt' | 'graphLossResolvedAt'
> {
  return {
    graphWriteFailedAt: null,
    graphWriteFailureReason: null,
    graphLossDisclosableAt: null,
    graphLossResolvedAt: null,
  };
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
  /**
   * ROADMAP 2.736 — runs at the top of the NEXT unfenced append
   * (`append_turn_atomic_v2/v3`), i.e. INSIDE the window between the
   * recovery's fence re-evaluation and the write it performs. This is the
   * window the existing `onBeforeEvaluate` hook could never reach, and it is
   * the one the audit named.
   */
  onBeforeCheckedAppend: (() => void) | null;
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
    onBeforeCheckedAppend: null,
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
          ...blankMarks(),
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
        ...blankMarks(),
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
                    : f.col === 'graph_loss_disclosable_at'
                      ? r.graphLossDisclosableAt
                      : f.col === 'graph_loss_resolved_at'
                        ? r.graphLossResolvedAt
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
              // Apply exactly the columns the caller sent — a PATCH, like
              // PostgREST. Assigning all four unconditionally would let the
              // resolution write (which sends only graph_loss_resolved_at)
              // silently clear the failure trace, and the fake would then
              // disagree with the database it stands in for.
              const vals = updateValues;
              if ('graph_write_failed_at' in vals) {
                r.graphWriteFailedAt = String(vals.graph_write_failed_at ?? null);
              }
              if ('graph_write_failure_reason' in vals) {
                r.graphWriteFailureReason = String(vals.graph_write_failure_reason ?? null);
              }
              if ('graph_loss_disclosable_at' in vals) {
                r.graphLossDisclosableAt = String(vals.graph_loss_disclosable_at ?? null);
              }
              if ('graph_loss_resolved_at' in vals) {
                r.graphLossResolvedAt = String(vals.graph_loss_resolved_at ?? null);
              }
            }
          }
          return { data: null, error: null };
        }
        // Pre-migration database: a SELECT that FILTERS on a column which does
        // not exist answers 42703 too, not just an UPDATE. Modelling only the
        // UPDATE would let a read-side fallback look exercised while never
        // being taken (trap 13 — an absence assertion needs to be able to see
        // a presence).
        if (backend.markColumnMissing) {
          const missing = filters.find(
            (f) =>
              f.col === 'graph_write_failed_at' ||
              f.col === 'graph_loss_disclosable_at' ||
              f.col === 'graph_loss_resolved_at',
          );
          if (missing !== undefined) {
            return {
              data: null,
              error: { code: '42703', message: `column "${missing.col}" does not exist` },
            };
          }
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
        if (fn !== 'append_turn_atomic_v4' && backend.onBeforeCheckedAppend !== null) {
          const hook = backend.onBeforeCheckedAppend;
          backend.onBeforeCheckedAppend = null;
          hook();
        }
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

describe('first-write exemption — ATOMIC path, pre-migration v4 (2.736: NO unfenced recovery)', () => {
  /**
   * ⚠ THIS BLOCK'S EXPECTATIONS WERE INVERTED BY ROADMAP 2.736, DELIBERATELY.
   *
   * It used to pin that an OLTF2 on a graph-less scenario RECOVERED and
   * committed, via `dispatchCheckedAppend` — `append_turn_atomic_v2/v3`, which
   * carry no fence check at all. An external audit (Codex, 2026-08-08) showed
   * the recovery re-read the fence and then wrote OUTSIDE any lock, so a Stop
   * or a rival commit landing in that window was invisible. The old suite
   * could not see it: every Stop test placed the Stop BEFORE the
   * re-evaluation, which is the only part of the window the code checks.
   *
   * The exemption now exists ONLY in migration 20260806120000's
   * in-transaction gate. Against a pre-migration database the refusal stands
   * — a disclosed, bounded reopening of the fresh-journey P0 for the window
   * between this deploy and that migration, chosen over an unfenced write.
   */
  it('2.736: OLTF2 on a graph-less scenario REFUSES — the exemption is not reproduced by an unfenced write', async () => {
    const backend = makeBackend();
    backend.v4Semantics = 'pre_exemption';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);

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
    expect(backend.storedGraph()).toBeNull();
  });

  it('2.736 STRUCTURAL: an OLTF2 refusal dispatches NO unfenced append (v2/v3) at all', async () => {
    // The invariant in its most directly falsifiable form, and the one a
    // mutant cannot satisfy by accident: the fenceless RPCs are never reached
    // from this path. Asserted by RPC identity, not by an outcome another
    // route could also produce (trap 19).
    const backend = makeBackend();
    backend.v4Semantics = 'pre_exemption';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);

    await expect(
      runWithTurnFence(handleFor(draftGen, TURN_A), () => store.append(write(TURN_A, GRAPH_A))),
    ).rejects.toThrow(TurnFenceRejectedError);

    const unfenced = backend.rpcCalls.filter(
      (c) => c.fn === 'append_turn_atomic_v2' || c.fn === 'append_turn_atomic_v3',
    );
    expect(unfenced).toEqual([]);
    // POSITIVE CONTROL (trap 13): the recorder CAN see those RPCs — the v4
    // attempt itself was recorded, so an empty list is a real absence rather
    // than a recorder that never fires.
    expect(backend.rpcCalls.some((c) => c.fn === 'append_turn_atomic_v4')).toBe(true);
  });

  it('2.736 INTERLEAVING: a Stop landing AFTER the fence re-evaluation cannot resurrect the draft', async () => {
    // THE AUDIT'S EXACT CASE, and the one the old suite structurally could
    // not reach. The Stop lands in the window between the recovery's
    // re-evaluation and the write it performs — invisible to a check made
    // before it and a write made without a lock.
    const backend = makeBackend();
    backend.v4Semantics = 'pre_exemption';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    backend.onBeforeCheckedAppend = () => backend.stop(TURN_A);

    await expect(
      runWithTurnFence(handleFor(draftGen, TURN_A), () => store.append(write(TURN_A, GRAPH_A))),
    ).rejects.toThrow(TurnFenceRejectedError);
    // The user stopped this draft. Nothing of it may reach the scenario.
    expect(backend.storedGraph()).toBeNull();
  });

  it('2.736 INTERLEAVING: a rival commit landing AFTER the fence re-evaluation is not clobbered', async () => {
    // The second half of the same window. The recovery proved "no graph"
    // and then wrote unconditionally; a rival graph committing in between was
    // overwritten by an older turn's draft.
    const backend = makeBackend();
    backend.v4Semantics = 'pre_exemption';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    backend.onBeforeCheckedAppend = () => backend.setStoredGraph(GRAPH_RIVAL);

    await expect(
      runWithTurnFence(handleFor(draftGen, TURN_A), () => store.append(write(TURN_A, GRAPH_A))),
    ).rejects.toThrow(TurnFenceRejectedError);
    expect(backend.storedGraph()).not.toEqual(GRAPH_A);
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

  it('arrival-8 replay: retrying a COMMITTED turn returns the SAME row id, never a 500 (read-only, and now unconditional)', async () => {
    const backend = makeBackend();
    // The turn commits normally (migrated semantics), then a retry arrives on
    // a database whose v4 raises OLTF2 unconditionally.
    backend.v4Semantics = 'exempt';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);

    const first = await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
      store.append(write(TURN_A, GRAPH_A)),
    );
    backend.v4Semantics = 'pre_exemption';
    const replay = await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
      store.append(write(TURN_A, GRAPH_A)),
    );
    expect(replay.id).toBe(first.id);
    expect(backend.storedGraph()).toEqual(GRAPH_A);
  });

  it('2.736: the replay answer is UNCONDITIONAL — a committed turn on a still-graph-less scenario also replays', async () => {
    // Previously the replay read was reachable only when the scenario already
    // held a graph (it sat behind `!firstWriteExemptionApplies`), so this
    // shape 500ed on a turn that was in fact persisted. It is a SELECT, so
    // running it first costs nothing and cannot race.
    const backend = makeBackend();
    backend.v4Semantics = 'exempt';
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);

    // Commit the turn WITHOUT a graph, then retry with one: the scenario is
    // still graph-less, and the turn row already exists.
    const first = await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
      store.append(write(TURN_A)),
    );
    expect(backend.storedGraph()).toBeNull();
    backend.v4Semantics = 'pre_exemption';
    const replay = await runWithTurnFence(handleFor(draftGen, TURN_A), () =>
      store.append(write(TURN_A, GRAPH_A)),
    );
    expect(replay.id).toBe(first.id);
  });

  it('CONTROL (unchanged): a Stop landing BEFORE the OLTF2 answer still refuses, and nothing commits', async () => {
    const backend = makeBackend();
    backend.v4Semantics = 'pre_exemption';
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
    // 2.735: a successful GRAPH commit now also issues the loss-RESOLUTION
    // update, so "no updates at all" is no longer the right pin. Assert the
    // thing that actually matters — no FAILURE mark was written — by naming
    // the columns rather than counting calls.
    const failureMarks = backend.updateCalls.filter((c) => 'graph_write_failed_at' in c.values);
    expect(failureMarks).toEqual([]);
  });

  // ═══ ROADMAP 2.735 — DISCLOSURE is a narrower claim than FAILURE ════════

  it('2.735: a fence refusal marks the loss DISCLOSABLE — the fence only ever refuses a graph-bearing write', async () => {
    const backend = makeBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const { draftGen } = phantomSetup(backend);
    backend.setStoredGraph(GRAPH_RIVAL);

    await expect(
      runWithTurnFence(handleFor(draftGen, TURN_A), () => store.append(write(TURN_A, GRAPH_A))),
    ).rejects.toThrow(TurnFenceRejectedError);

    const row = backend.rows.find((r) => r.turnId === TURN_A);
    expect(row?.graphLossDisclosableAt).toBeTruthy();
  });

  it('2.735: a turn_dead_only mark records the failure but NOT the disclosure', async () => {
    // The pre-preview draft failure, as the route now records it. The turn
    // must be dead (continuation detection stops counting it) while nothing
    // is disclosed to the user, because nothing was lost.
    const backend = makeBackend();
    const store = makeStore(backend.client);
    backend.claim(TURN_A);

    await store.markGraphWriteFailed(
      SCENARIO,
      TURN_A,
      'draft_graph_pipeline_threw_before_preview',
      'turn_dead_only',
    );

    const row = backend.rows.find((r) => r.turnId === TURN_A);
    expect(row?.graphWriteFailedAt).toBeTruthy();
    expect(row?.graphLossDisclosableAt).toBeNull();
  });

  it('2.735: scenarioDraftLossStands is FALSE for a turn_dead_only mark and TRUE for a draft_loss mark', async () => {
    // The discriminating pair. Same scenario, same graph-less state, same
    // read — the ONLY difference is the claim the mark records. A predicate
    // that ignored the claim (the shipped defect) would answer true twice.
    const deadOnly = makeBackend();
    const deadStore = makeStore(deadOnly.client);
    deadOnly.claim(TURN_A);
    await deadStore.markGraphWriteFailed(SCENARIO, TURN_A, 'pipeline_threw', 'turn_dead_only');
    await expect(deadStore.scenarioDraftLossStands(SCENARIO)).resolves.toBe(false);

    const realLoss = makeBackend();
    const lossStore = makeStore(realLoss.client);
    realLoss.claim(TURN_A);
    await lossStore.markGraphWriteFailed(SCENARIO, TURN_A, 'pipeline_threw', 'draft_loss');
    await expect(lossStore.scenarioDraftLossStands(SCENARIO)).resolves.toBe(true);
  });

  it('2.735: a later graph commit RESOLVES the loss, and the resolution survives the graph going away again', async () => {
    // The stale-marker path. Previously a later commit merely MASKED the mark
    // (the predicate read "mark present AND graph now null"), so clearing the
    // graph later re-fired a notice about a draft the user had replaced.
    const backend = makeBackend();
    const store = makeStore(backend.client);
    const draftGen = backend.claim(TURN_A);
    await store.markGraphWriteFailed(SCENARIO, TURN_A, 'superseded', 'draft_loss');
    expect(await store.scenarioDraftLossStands(SCENARIO)).toBe(true);

    // A later turn drafts successfully.
    const laterGen = backend.claim(TURN_B);
    await runWithTurnFence(handleFor(laterGen, TURN_B), () => store.append(write(TURN_B, GRAPH_A)));
    expect(await store.scenarioDraftLossStands(SCENARIO)).toBe(false);

    // …and now the graph goes away (a delete, a reset). The OLD predicate
    // would resurrect the notice here; the resolution stamp must not.
    backend.setStoredGraph(null);
    expect(await store.scenarioDraftLossStands(SCENARIO)).toBe(false);
    // Bind by identity: the resolution is recorded on the row that carried
    // the loss, not merely implied by graph presence.
    expect(backend.rows.find((r) => r.turnId === TURN_A)?.graphLossResolvedAt).toBeTruthy();
    void draftGen;
  });

  it('2.735 CONTROL: a graph-LESS commit resolves nothing (the user is still without a model)', async () => {
    const backend = makeBackend();
    const store = makeStore(backend.client);
    backend.claim(TURN_A);
    await store.markGraphWriteFailed(SCENARIO, TURN_A, 'superseded', 'draft_loss');

    const laterGen = backend.claim(TURN_B);
    await runWithTurnFence(handleFor(laterGen, TURN_B), () => store.append(write(TURN_B)));

    expect(await store.scenarioDraftLossStands(SCENARIO)).toBe(true);
    expect(backend.rows.find((r) => r.turnId === TURN_A)?.graphLossResolvedAt).toBeNull();
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

  it('ROADMAP 2.738(b): a STOPPED turn is not live — a stopped-before-commit draft must not make the scenario a continuation forever', async () => {
    // The audit's case. A turn the user Stopped before it could commit is
    // never failure-marked by the fence — nothing refused it, it simply never
    // wrote — so under the old predicate its fence row stayed "admitted and
    // live" for the life of the scenario. A graph-less scenario whose only
    // other turn was stopped then classified as a CONTINUATION on every later
    // turn, and the brief could never be redrafted.
    const backend = makeBackend();
    const store = makeStore(backend.client);
    backend.claim(TURN_A);
    backend.claim(TURN_B);

    // POSITIVE CONTROL (trap 13) FIRST: while TURN_A is live, this read must
    // see it — otherwise the `false` below proves nothing about stopping.
    await expect(store.hasOtherAdmittedLiveTurn(SCENARIO, TURN_B)).resolves.toBe(true);

    backend.stop(TURN_A);
    await expect(store.hasOtherAdmittedLiveTurn(SCENARIO, TURN_B)).resolves.toBe(false);
    // Bind by identity: it is the STOP that did this, not a failure mark —
    // the row carries no failure trace at all.
    expect(backend.rows.find((r) => r.turnId === TURN_A)?.graphWriteFailedAt).toBeNull();
  });

  it('ROADMAP 2.738(b): the STOP filter survives the pre-migration 42703 fallback', async () => {
    // `stopped_at` predates the pending migration; only the failure columns
    // are new. So on a database where the failure filter 42703s, the retry
    // must still exclude stopped rows — otherwise the fix is dark on exactly
    // the deployment state it was written for.
    const backend = makeBackend();
    backend.markColumnMissing = true;
    const store = makeStore(backend.client);
    backend.claim(TURN_A);
    backend.claim(TURN_B);
    await expect(store.hasOtherAdmittedLiveTurn(SCENARIO, TURN_B)).resolves.toBe(true);

    backend.stop(TURN_A);
    await expect(store.hasOtherAdmittedLiveTurn(SCENARIO, TURN_B)).resolves.toBe(false);
  });
});
