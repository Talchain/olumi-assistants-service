/**
 * V5 TURN FENCE — the evaluate→append window, CLOSED (ROADMAP 2.174 fix c).
 *
 * THE SEAM (documented at turn-fence.ts arrival 10, proven RED here at
 * `a1fb06bd`): the fence evaluation is a SELECT and the append is a separate
 * round trip, so a Stop (or a newer claim) that lands INSIDE that ~10-40 ms
 * window is invisible to the evaluation the commit just passed — the fence is
 * a check, not a lock, and the stopped/superseded graph still lands.
 *
 * THE FIX: `append_turn_atomic_v4` — the fence check moves INSIDE the append
 * transaction, under a `FOR UPDATE` lock on the turn's own fence row, so a
 * concurrent `v5_mark_turn_stopped` serialises against the commit: either the
 * tombstone commits first (v4 sees it and REFUSES, SQLSTATE OLTF1) or it
 * waits for the commit (and then honestly reports `already_committed`).
 * Supersession is read under the same transaction (OLTF2). The code
 * FEATURE-DETECTS v4 (PGRST202 = not migrated) and falls back to today's
 * evaluate-then-append two-step — behaviour before the migration executes is
 * BYTE-EQUIVALENT to the pre-fix path, pinned below.
 *
 * The interleaving is DETERMINISTIC: the fake client exposes an
 * `onBeforeAppend` hook that runs a rival write (stop / newer claim) at the
 * exact point between the evaluation round trip and the append round trip —
 * the strongest form of the race, no timing required.
 *
 * The fake implements the MIGRATION'S semantics (claim/evaluate/stop exactly
 * as turn-fence-stop-vs-disconnect.test.ts, plus v4's in-transaction gate);
 * the rehearsal (PHASE0-EVIDENCE-2026-07-28/fence-hardening-build.md) proves
 * the real SQL matches this fake on the same call sequences.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import { GraphStaleWriteError, type SessionTurnWrite } from '../store.js';
import {
  runWithTurnFence,
  TurnFenceRejectedError,
  type TurnFenceHandle,
} from '../turn-fence.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO = 'd7000000-0000-4000-8000-000000000001';
const TURN_A = 'd7000000-0000-4000-8000-00000000000a';
const TURN_B = 'd7000000-0000-4000-8000-00000000000b';

const GRAPH_A = {
  nodes: [{ id: 'n_a', kind: 'factor', label: 'Window Probe A' }],
  edges: [],
};

// ── The fence-backed fake, extended with append_turn_atomic_v4 ──────────────

interface FenceRow {
  generation: number;
  scenarioId: string;
  turnId: string;
  stoppedAt: string | null;
}

interface AtomicFenceBackend {
  client: SupabaseClient;
  storedGraph: () => unknown;
  calls: Array<{ fn: string; args: Record<string, unknown> }>;
  rows: FenceRow[];
  /**
   * Runs synchronously at the top of the NEXT append_turn_atomic_* call —
   * i.e. deterministically INSIDE the evaluate→append window (after any
   * pre-RPC evaluation resolved, before the append's own logic runs). In the
   * real database this models the rival transaction COMMITTING first; v4's
   * FOR UPDATE serialisation makes that the only ordering in which the rival
   * wins, which is exactly the ordering the fake reproduces.
   */
  onBeforeAppend: (() => void) | null;
  /** When true, the fake pretends v4 was never migrated (PGRST202). */
  v4Missing: boolean;
  stop: (turnId: string) => void;
  claim: (turnId: string) => number;
}

function makeAtomicFenceBackend(): AtomicFenceBackend {
  const rows: FenceRow[] = [];
  const committedTurns = new Set<string>();
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let sequence = 0;
  let graph: unknown = null;
  let graphIdentityHash: string | null = null;

  const find = (scenarioId: string, turnId: string): FenceRow | undefined =>
    rows.find((r) => r.scenarioId === scenarioId && r.turnId === turnId);

  const backend: AtomicFenceBackend = {
    client: null as never,
    storedGraph: () => graph,
    calls,
    rows,
    onBeforeAppend: null,
    v4Missing: false,
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
        });
      }
    },
    claim: (turnId: string) => {
      const existing = find(SCENARIO, turnId);
      if (existing) return existing.generation;
      sequence += 1;
      rows.push({ generation: sequence, scenarioId: SCENARIO, turnId, stoppedAt: null });
      return sequence;
    },
  };

  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const scenarioId = String(args.p_scenario_id ?? '');
      const turnId = String(args.p_turn_id ?? '');

      if (fn === 'v5_claim_turn_fence') {
        return { data: backend.claim(turnId), error: null };
      }

      if (fn === 'v5_evaluate_turn_fence') {
        const mine = find(scenarioId, turnId);
        const scenarioRows = rows.filter((r) => r.scenarioId === scenarioId);
        const maxGeneration =
          scenarioRows.length === 0
            ? null
            : Math.max(...scenarioRows.map((r) => r.generation));
        return {
          data: {
            claimed: mine !== undefined,
            stopped: mine?.stoppedAt != null,
            generation: mine?.generation ?? null,
            max_generation: maxGeneration,
          },
          error: null,
        };
      }

      if (fn === 'v5_mark_turn_stopped') {
        backend.stop(turnId);
        return {
          data: {
            stopped: true,
            claimed: true,
            already_committed: committedTurns.has(`${scenarioId}:${turnId}`),
          },
          error: null,
        };
      }

      if (fn.startsWith('append_turn_atomic')) {
        // THE WINDOW: the rival lands here — after any pre-RPC evaluation,
        // before the append's own semantics run.
        if (backend.onBeforeAppend !== null) {
          const rival = backend.onBeforeAppend;
          backend.onBeforeAppend = null;
          rival();
        }

        if (fn === 'append_turn_atomic_v4') {
          if (backend.v4Missing) {
            return {
              data: null,
              error: {
                code: 'PGRST202',
                message:
                  'Could not find the function public.append_turn_atomic_v4 in the schema cache',
              },
            };
          }
          // ── The migration's in-transaction fence gate (fake) ─────────────
          const fenceGeneration = args.p_fence_generation as number | null;
          if (fenceGeneration != null && args.p_graph != null) {
            const mine = find(scenarioId, turnId);
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
                    max_generation: Math.max(
                      ...rows.filter((r) => r.scenarioId === scenarioId).map((r) => r.generation),
                    ),
                  }),
                },
              };
            }
            const maxGeneration = Math.max(
              ...rows.filter((r) => r.scenarioId === scenarioId).map((r) => r.generation),
            );
            if (fenceGeneration < maxGeneration) {
              return {
                data: null,
                error: {
                  code: 'OLTF2',
                  message: 'v4: superseded',
                  details: JSON.stringify({
                    generation: fenceGeneration,
                    max_generation: maxGeneration,
                  }),
                },
              };
            }
          }
          // ── v3-equivalent CAS gate ───────────────────────────────────────
          if (
            args.p_cas_enforce === true &&
            args.p_expected_graph_identity_hash != null &&
            graphIdentityHash !== null &&
            graphIdentityHash !== args.p_expected_graph_identity_hash &&
            (args.p_incoming_graph_identity_hash == null ||
              args.p_incoming_graph_identity_hash !== graphIdentityHash)
          ) {
            return { data: null, error: { code: 'OLGC1', message: 'v4: stale graph write' } };
          }
        }

        committedTurns.add(`${scenarioId}:${turnId}`);
        if (args.p_graph != null) {
          graph = args.p_graph;
          if (fn !== 'append_turn_atomic_v2') {
            graphIdentityHash =
              (args.p_incoming_graph_identity_hash as string | null) ?? null;
          }
        }
        return { data: `row-${turnId}`, error: null };
      }

      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    }),
    from: vi.fn((table: string) => {
      // ROADMAP 2.709 fidelity: the first-write exemption reads `scenarios`
      // graph-presence before honouring a superseded refusal; answer from
      // the SAME `graph` state the append writes (see the sibling comment in
      // turn-fence-stop-vs-disconnect.test.ts).
      const chain = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        order: () => chain,
        limit: () =>
          Promise.resolve({
            data: table === 'scenarios' && graph !== null ? [{ id: SCENARIO }] : [],
            error: null,
          }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        not: () => chain,
        is: () => chain,
        in: () => chain,
        update: () => chain,
        then: (
          resolve: (v: { data: unknown; error: null }) => unknown,
          reject?: (e: unknown) => unknown,
        ) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
      };
      return chain as never;
    }),
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

beforeEach(() => {
  setTestSink(null);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2.174 fix c — the evaluate→append window (deterministic interleaving)', () => {
  // ── THE PIN (proven RED at a1fb06bd: the graph landed despite the Stop) ──
  it('a Stop landing INSIDE the window refuses the graph write (was: the stopped graph landed)', async () => {
    const backend = makeAtomicFenceBackend();
    const store = makeStore(backend.client);
    const gen = backend.claim(TURN_A);

    // The rival: an explicit user Stop for THIS turn, committing at the
    // exact seam between the fence evaluation and the append round trip.
    backend.onBeforeAppend = () => backend.stop(TURN_A);

    const outcome = await runWithTurnFence(handleFor(gen, TURN_A), async () =>
      store.append(write(TURN_A, GRAPH_A)).then(
        () => null,
        (e: unknown) => e,
      ),
    );

    expect(outcome).toBeInstanceOf(TurnFenceRejectedError);
    expect((outcome as TurnFenceRejectedError).verdict).toBe('stopped');
    expect(backend.storedGraph()).toBeNull();
  });

  it('a NEWER CLAIM landing inside the window is SEEN (OLTF2) — and the refusal STANDS, with no unfenced re-append (ROADMAP 2.736)', async () => {
    // ⚠ THIS PIN HAS NOW FLIPPED TWICE, AND THE SECOND FLIP IS THE HONEST ONE.
    //
    // The window-detection property it exists for has never changed and is
    // asserted below: the in-transaction gate DOES see the rival claim (v4
    // answers OLTF2). 2.709 then re-priced that verdict for a graph-less
    // scenario and had the APP recover — re-proving "graph absent + not
    // stopped" and committing through the pre-v4 append. An external audit
    // (Codex, 2026-08-08) showed that recovery wrote through an RPC with no
    // fence check, after a re-read taken outside any lock: a Stop or a rival
    // commit landing in THAT window was invisible.
    //
    // 2.736 removes the unfenced write. The exemption now lives only in
    // migration 20260806120000's in-transaction gate, under the scenarios row
    // lock. Against a pre-migration database the refusal stands — a disclosed,
    // bounded reopening of the fresh-journey P0 until that migration runs.
    const backend = makeAtomicFenceBackend();
    const store = makeStore(backend.client);
    const genA = backend.claim(TURN_A);

    backend.onBeforeAppend = () => void backend.claim(TURN_B);

    await expect(
      runWithTurnFence(handleFor(genA, TURN_A), async () => store.append(write(TURN_A, GRAPH_A))),
    ).rejects.toThrow(TurnFenceRejectedError);

    // The gate saw the rival — and nothing was written by any path.
    expect(backend.storedGraph()).toBeNull();
    const appendFns = backend.calls
      .filter((c) => c.fn.startsWith('append_turn_atomic'))
      .map((c) => c.fn);
    expect(appendFns).toEqual(['append_turn_atomic_v4']);
  });

  // ── POSITIVE CONTROL (trap 13): the atomic fence can be PASSED ───────────
  it('an unmolested current turn commits through the atomic path', async () => {
    const backend = makeAtomicFenceBackend();
    const store = makeStore(backend.client);
    const gen = backend.claim(TURN_A);

    const result = await runWithTurnFence(handleFor(gen, TURN_A), async () =>
      store.append(write(TURN_A, GRAPH_A)),
    );

    expect(result.id).toBe(`row-${TURN_A}`);
    expect(backend.storedGraph()).toEqual(GRAPH_A);
    // The check rode INSIDE the append: no separate evaluation round trip.
    expect(backend.calls.filter((c) => c.fn === 'v5_evaluate_turn_fence')).toHaveLength(0);
    const appendCall = backend.calls.find((c) => c.fn === 'append_turn_atomic_v4');
    expect(appendCall).toBeDefined();
    expect(appendCall!.args.p_fence_generation).toBe(gen);
  });

  it('non-graph writes never touch the fence and never use v4 (claim-type discipline)', async () => {
    const backend = makeAtomicFenceBackend();
    const store = makeStore(backend.client);

    const result = await store.append(write(TURN_A)); // no graph, no fence context

    expect(result.id).toBe(`row-${TURN_A}`);
    expect(backend.calls.map((c) => c.fn)).toEqual(['append_turn_atomic_v2']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2.174 fix c — BEFORE the migration executes (feature-detect, pinned)', () => {
  // The stated posture: FEATURE-DETECT, not fail-closed. PGRST202 on v4 falls
  // back to the pre-fix two-step (evaluate → append), so the code deploys
  // safely ahead of the migration and the fence keeps exactly its pre-v4
  // protection (the ~one-RPC window included, honestly).
  it('v4 missing → falls back to evaluate-then-append and COMMITS a current turn', async () => {
    const backend = makeAtomicFenceBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const gen = backend.claim(TURN_A);

    const result = await runWithTurnFence(handleFor(gen, TURN_A), async () =>
      store.append(write(TURN_A, GRAPH_A)),
    );

    expect(result.id).toBe(`row-${TURN_A}`);
    expect(backend.storedGraph()).toEqual(GRAPH_A);
    // The fallback IS the pre-fix path: one evaluation round trip, then the
    // pre-v4 append RPC.
    expect(backend.calls.filter((c) => c.fn === 'v5_evaluate_turn_fence')).toHaveLength(1);
    expect(backend.calls.filter((c) => c.fn === 'append_turn_atomic_v2')).toHaveLength(1);
  });

  it('v4 missing → a PRE-EXISTING tombstone still refuses (the pre-v4 protection, intact)', async () => {
    const backend = makeAtomicFenceBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const gen = backend.claim(TURN_A);
    backend.stop(TURN_A); // BEFORE the append — visible to the evaluation

    const outcome = await runWithTurnFence(handleFor(gen, TURN_A), async () =>
      store.append(write(TURN_A, GRAPH_A)).then(
        () => null,
        (e: unknown) => e,
      ),
    );

    expect(outcome).toBeInstanceOf(TurnFenceRejectedError);
    expect((outcome as TurnFenceRejectedError).verdict).toBe('stopped');
    expect(backend.storedGraph()).toBeNull();
  });

  it('the v4-missing discovery is CACHED: the second graph write skips v4 entirely', async () => {
    const backend = makeAtomicFenceBackend();
    backend.v4Missing = true;
    const store = makeStore(backend.client);
    const genA = backend.claim(TURN_A);
    await runWithTurnFence(handleFor(genA, TURN_A), async () =>
      store.append(write(TURN_A, GRAPH_A)),
    );
    const genB = backend.claim(TURN_B);
    await runWithTurnFence(handleFor(genB, TURN_B), async () =>
      store.append(write(TURN_B, GRAPH_A)),
    );

    expect(backend.calls.filter((c) => c.fn === 'append_turn_atomic_v4')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2.174 fix c — CAS still enforced inside v4', () => {
  it('a stale base under enforce mode maps to GraphStaleWriteError (OLGC1), not a fence refusal', async () => {
    const backend = makeAtomicFenceBackend();
    const store = new SupabaseSessionStore(
      backend.client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20, graphCasRpc: 'enforce' },
    );
    // Seed a recorded identity hash by committing turn A's graph first.
    const genA = backend.claim(TURN_A);
    await runWithTurnFence(handleFor(genA, TURN_A), async () =>
      store.append({
        ...write(TURN_A, GRAPH_A),
        expectedGraphIdentityHash: undefined,
      } as SessionTurnWrite),
    );

    // Turn B arrives with a WRONG expected base.
    const genB = backend.claim(TURN_B);
    const outcome = await runWithTurnFence(handleFor(genB, TURN_B), async () =>
      store
        .append({
          ...write(TURN_B, { nodes: [], edges: [] }),
          expectedGraphIdentityHash: 'deadbeef'.repeat(8),
        } as SessionTurnWrite)
        .then(
          () => null,
          (e: unknown) => e,
        ),
    );

    expect(outcome).toBeInstanceOf(GraphStaleWriteError);
    expect(backend.storedGraph()).toEqual(GRAPH_A); // B's write rolled back
  });
});
