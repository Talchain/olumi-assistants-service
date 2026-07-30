/**
 * V5 TURN FENCE — the two semantics, pinned SEPARATELY, plus a replay of the
 * live-reproduced corruption.
 *
 * ⚠ WHY TWO SEMANTICS AND NOT ONE TEST. The brief's binding constraint is that
 *   an INCIDENTAL DISCONNECT keeps the existing finish-atomically behaviour
 *   (`streamed-turn-sse.ts:71-78`, the #751 arc) and only an EXPLICIT user Stop
 *   differs. A single test asserting "Stop refuses the write" would pass just as
 *   happily if the fence had started refusing disconnected turns too — the
 *   regression it is supposed to prevent would be invisible. So "Stop REFUSES"
 *   and "disconnect COMMITS" are separate, independently-failing tests, and the
 *   disconnect case is written as the POSITIVE control it is: it proves the
 *   fence can be passed, which is what makes every refusal below meaningful
 *   rather than a fence that refuses everything (CLAUDE.md trap 13).
 *
 * The client fake implements the MIGRATION'S semantics rather than returning
 * canned verdicts:
 *   · `v5_claim_turn_fence`  — bigserial generation, idempotent on
 *     (scenario, turn), and MUST NOT clear an existing tombstone;
 *   · `v5_evaluate_turn_fence` — {claimed, stopped, generation, max_generation};
 *   · `v5_mark_turn_stopped` — upsert, first-Stop-wins, `already_committed`
 *     derived from the committed-turn set.
 * A canned-verdict fake would let a mutation to the classifier or to the
 * generation comparison pass unnoticed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import { StateCommitFailedError, type SessionTurnWrite } from '../store.js';
import {
  runWithTurnFence,
  TurnFenceRejectedError,
  unclaimedTurnFenceHandle,
  type TurnFenceHandle,
} from '../turn-fence.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO = 'a6ccf5cf-aab0-4f01-b889-e0d6c072067c'; // the reproduced scenario
const TURN_A = 'dcfc3b50-03b0-4b74-bc56-6dd0ce1531d7'; // the STOPPED draft
const TURN_B = '6ccf8314-bca9-47dd-9ecf-85172bd210a4'; // the turn the user wanted

const GRAPH_A = { nodes: [{ id: 'n_oncall', kind: 'factor', label: 'On-Call Rotation' }], edges: [] };
const GRAPH_B = { nodes: [{ id: 'n_clickup', kind: 'factor', label: 'ClickUp Adoption' }], edges: [] };

// ── A fence-backed fake client: the migration's semantics, in memory ────────

interface FenceRow {
  generation: number;
  scenarioId: string;
  turnId: string;
  stoppedAt: string | null;
}

interface FenceBackend {
  client: SupabaseClient;
  /** What `scenarios.graph` would hold — written by the append RPC. */
  storedGraph: () => unknown;
  /** Every RPC call, in order, for arrival-ordering assertions. */
  calls: Array<{ fn: string; args: Record<string, unknown> }>;
  rows: FenceRow[];
}

function makeFenceBackedClient(opts: { appendFails?: boolean } = {}): FenceBackend {
  const rows: FenceRow[] = [];
  const committedTurns = new Set<string>();
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let sequence = 0;
  let graph: unknown = null;

  const find = (scenarioId: string, turnId: string): FenceRow | undefined =>
    rows.find((r) => r.scenarioId === scenarioId && r.turnId === turnId);

  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const scenarioId = String(args.p_scenario_id ?? '');
      const turnId = String(args.p_turn_id ?? '');

      if (fn === 'v5_claim_turn_fence') {
        sequence += 1;
        const existing = find(scenarioId, turnId);
        if (existing) {
          // ON CONFLICT DO UPDATE is a deliberate NO-OP: it returns the
          // existing generation and NEVER clears stopped_at.
          return { data: existing.generation, error: null };
        }
        const row: FenceRow = { generation: sequence, scenarioId, turnId, stoppedAt: null };
        rows.push(row);
        return { data: row.generation, error: null };
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
        const existing = find(scenarioId, turnId);
        if (existing) {
          existing.stoppedAt = existing.stoppedAt ?? new Date().toISOString();
        } else {
          sequence += 1;
          rows.push({
            generation: sequence,
            scenarioId,
            turnId,
            stoppedAt: new Date().toISOString(),
          });
        }
        return {
          data: {
            stopped: true,
            claimed: existing !== undefined,
            already_committed: committedTurns.has(`${scenarioId}:${turnId}`),
          },
          error: null,
        };
      }

      if (fn.startsWith('append_turn_atomic')) {
        if (opts.appendFails) return { data: null, error: { message: 'append blew up' } };
        committedTurns.add(`${scenarioId}:${turnId}`);
        if (args.p_graph != null) graph = args.p_graph;
        return { data: `row-${turnId}`, error: null };
      }

      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    }),
    from: vi.fn(() => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        not: () => chain,
        in: () => chain,
      };
      return chain as never;
    }),
  } as unknown as SupabaseClient;

  return { client, storedGraph: () => graph, calls, rows };
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

beforeEach(() => {
  setTestSink(null);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('V5 turn fence — the reproduced corruption (staging 2026-07-29)', () => {
  it('REFUSES the stopped turn’s graph write, so the later turn’s canvas survives', async () => {
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);

    // Exactly the live sequence: A starts first, B starts second, B commits
    // first, A commits 163 ms later.
    const handleA = await store.claimTurnFence(SCENARIO, TURN_A);
    const handleB = await store.claimTurnFence(SCENARIO, TURN_B);
    expect(handleA?.generation).toBe(1);
    expect(handleB?.generation).toBe(2);

    // The user presses Stop on A.
    const stop = await store.markTurnStopped(SCENARIO, TURN_A);
    expect(stop.stopped).toBe(true);
    expect(stop.claimed).toBe(true);
    expect(stop.alreadyCommitted).toBe(false);

    // B commits its graph — unaffected.
    await runWithTurnFence(handleB as TurnFenceHandle, async () => {
      await store.append(write(TURN_B, GRAPH_B));
    });
    expect(backend.storedGraph()).toEqual(GRAPH_B);

    // A finishes 52.7s after it was stopped and tries to commit.
    const refusal = await runWithTurnFence(handleA as TurnFenceHandle, async () =>
      await store.append(write(TURN_A, GRAPH_A)).then(
        () => null,
        (e: unknown) => e,
      ),
    );

    expect(refusal).toBeInstanceOf(TurnFenceRejectedError);
    // The refusal rides the EXISTING typed commit-failure envelope.
    expect(refusal).toBeInstanceOf(StateCommitFailedError);
    // `stopped` wins over `superseded` — it is the reason the user would
    // recognise, and A is in fact both.
    expect((refusal as TurnFenceRejectedError).verdict).toBe('stopped');

    // THE POINT: the canvas is still the one the user asked for.
    expect(backend.storedGraph()).toEqual(GRAPH_B);
    // And no append RPC ran for A at all — the refusal is PRE-write.
    const appendArgs = backend.calls
      .filter((c) => c.fn.startsWith('append_turn_atomic'))
      .map((c) => c.args.p_turn_id);
    expect(appendArgs).toEqual([TURN_B]);
  });

  it('REFUSES a superseded graph write even with NO stop at all (the pure ordering fence)', async () => {
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);

    const handleA = await store.claimTurnFence(SCENARIO, TURN_A);
    await store.claimTurnFence(SCENARIO, TURN_B); // a later turn claims

    const refusal = await runWithTurnFence(handleA as TurnFenceHandle, async () =>
      await store.append(write(TURN_A, GRAPH_A)).then(
        () => null,
        (e: unknown) => e,
      ),
    );

    expect(refusal).toBeInstanceOf(TurnFenceRejectedError);
    expect((refusal as TurnFenceRejectedError).verdict).toBe('superseded');
    expect((refusal as TurnFenceRejectedError).generation).toBe(1);
    expect((refusal as TurnFenceRejectedError).maxGeneration).toBe(2);
    expect(backend.storedGraph()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('V5 turn fence — INCIDENTAL DISCONNECT KEEPS finish-atomically', () => {
  it('a turn whose client hung up (no stop request) still COMMITS its graph', async () => {
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);

    // A disconnect is the ABSENCE of a stop request. Nothing else about the
    // turn changes — it claimed, it ran, it finished.
    const handle = await store.claimTurnFence(SCENARIO, TURN_A);
    const result = await runWithTurnFence(handle as TurnFenceHandle, async () =>
      await store.append(write(TURN_A, GRAPH_A)),
    );

    expect(result.id).toBe(`row-${TURN_A}`);
    expect(backend.storedGraph()).toEqual(GRAPH_A);
    // No tombstone was ever written for this turn.
    expect(backend.calls.some((c) => c.fn === 'v5_mark_turn_stopped')).toBe(false);
    expect(backend.rows[0]?.stoppedAt).toBeNull();
  });

  it('the tombstone path does NOT fire for a DIFFERENT turn’s stop', async () => {
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);

    const handleA = await store.claimTurnFence(SCENARIO, TURN_A);
    // A stop arrives for some other turn on the same scenario. Note it claims a
    // generation of its own, so this ALSO proves the assertion below is about
    // the tombstone and not accidentally about ordering: turn A is still the
    // newest CLAIMED generation only if the stop's synthetic row is older.
    await store.markTurnStopped(SCENARIO, 'a-completely-different-turn');

    const refusal = await runWithTurnFence(handleA as TurnFenceHandle, async () =>
      await store.append(write(TURN_A, GRAPH_A)).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    // The unrelated stop created a LATER fence row, so A is legitimately
    // superseded — but it must NOT read as `stopped`. That distinction is the
    // assertion: a stop for another turn never tombstones this one.
    expect((refusal as TurnFenceRejectedError).verdict).toBe('superseded');
    expect(backend.rows.find((r) => r.turnId === TURN_A)?.stoppedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
describe('V5 turn fence — A FAILED CLAIM FAILS CLOSED (#759 review, finding A1)', () => {
  it('reproduces the CLOBBER the unreachable branch allowed, and refuses it', async () => {
    // The review's proof, as a permanent pin. Before the fix a failed claim bound
    // NO handle, so the commit hit `no_ingress_fence` and was ALLOWED — and the
    // consequence was not merely "unfenced" but an active clobber needing no
    // timing inversion:
    //
    //   B's claim blips  → B commits UNFENCED (graph = B)
    //   A (generation 1) → max_generation is 1, because B never claimed
    //                    → verdict `current` → A OVERWRITES B
    //
    // With a healthy claim A is refused as `superseded` (the control below).
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);

    // A claims normally. B's claim fails, exactly as a missing migration
    // (PGRST202) or a DB blip would present.
    const handleA = await store.claimTurnFence(SCENARIO, TURN_A);
    expect(handleA?.generation).toBe(1);
    const handleB = unclaimedTurnFenceHandle(SCENARIO, TURN_B);

    // B tries to commit its graph.
    const bRefusal = await runWithTurnFence(handleB, async () =>
      await store.append(write(TURN_B, GRAPH_B)).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(bRefusal).toBeInstanceOf(TurnFenceRejectedError);
    expect((bRefusal as TurnFenceRejectedError).verdict).toBe('unclaimed');
    // Nothing landed, so there is no B graph for A to clobber.
    expect(backend.storedGraph()).toBeNull();

    // No RPC was asked: an unorderable write needs no round trip to be refused.
    expect(backend.calls.filter((c) => c.fn === 'v5_evaluate_turn_fence')).toHaveLength(0);
    expect(backend.calls.filter((c) => c.fn.startsWith('append_turn_atomic'))).toHaveLength(0);
  });

  it('CONTROL — with a healthy claim for B, A is refused as superseded (not unclaimed)', async () => {
    // The control the review used, kept so the test above cannot pass by the
    // fence refusing everything (trap 13). Same two turns, same order; the ONLY
    // difference is that B's claim lands.
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);
    const handleA = await store.claimTurnFence(SCENARIO, TURN_A);
    const handleB = await store.claimTurnFence(SCENARIO, TURN_B);

    await runWithTurnFence(handleB as TurnFenceHandle, async () => {
      await store.append(write(TURN_B, GRAPH_B));
    });
    expect(backend.storedGraph()).toEqual(GRAPH_B);

    const aRefusal = await runWithTurnFence(handleA as TurnFenceHandle, async () =>
      await store.append(write(TURN_A, GRAPH_A)).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect((aRefusal as TurnFenceRejectedError).verdict).toBe('superseded');
    expect(backend.storedGraph()).toEqual(GRAPH_B);
  });

  it('a NON-GRAPH write from an unclaimed turn still commits', async () => {
    // Fail-closed is scoped to graph writes here too. A fence outage must not
    // stop answers, analysis receipts or graph-free system events.
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);
    const result = await runWithTurnFence(
      unclaimedTurnFenceHandle(SCENARIO, TURN_A),
      async () => await store.append(write(TURN_A)),
    );
    expect(result.id).toBe(`row-${TURN_A}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('V5 turn fence — scope and fail-closed posture', () => {
  it('does NOT fence a NON-GRAPH write, even when stopped and superseded', async () => {
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);

    const handleA = await store.claimTurnFence(SCENARIO, TURN_A);
    await store.claimTurnFence(SCENARIO, TURN_B);
    await store.markTurnStopped(SCENARIO, TURN_A);

    const result = await runWithTurnFence(handleA as TurnFenceHandle, async () =>
      await store.append(write(TURN_A)), // no graph
    );

    expect(result.id).toBe(`row-${TURN_A}`);
    // Zero fence RPCs for a graph-free write: no evaluate call after the claim.
    expect(backend.calls.filter((c) => c.fn === 'v5_evaluate_turn_fence')).toHaveLength(0);
  });

  it('REFUSES a graph write when the fence RPC errors (fail closed, not fail open)', async () => {
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);
    const handle = await store.claimTurnFence(SCENARIO, TURN_A);

    // Typed through the RPC shape the fake actually has, not
    // `ReturnType<typeof vi.fn>` — that resolves to a zero-arg Mock and calling
    // `original(fn, args)` is a type error the local `pnpm typecheck` cannot see
    // (tsconfig.build.json excludes tests) but the Typecheck Drift ratchet can.
    type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
    const rpc = backend.client.rpc as unknown as {
      getMockImplementation: () => RpcFn | undefined;
      mockImplementation: (impl: RpcFn) => void;
    };
    const original = rpc.getMockImplementation();
    if (original === undefined) throw new Error('the fake client must have an rpc impl');
    rpc.mockImplementation(async (fn, args) => {
      if (fn === 'v5_evaluate_turn_fence') {
        return { data: null, error: { message: 'function v5_evaluate_turn_fence does not exist' } };
      }
      return await original(fn, args);
    });

    const refusal = await runWithTurnFence(handle as TurnFenceHandle, async () =>
      await store.append(write(TURN_A, GRAPH_A)).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(refusal).toBeInstanceOf(TurnFenceRejectedError);
    expect((refusal as TurnFenceRejectedError).verdict).toBe('unavailable');
    expect(backend.storedGraph()).toBeNull();
  });

  it('an idempotent replay of the SAME turn keeps its generation and still commits', async () => {
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);

    const first = await store.claimTurnFence(SCENARIO, TURN_A);
    const replay = await store.claimTurnFence(SCENARIO, TURN_A);
    expect(replay?.generation).toBe(first?.generation);

    await runWithTurnFence(replay as TurnFenceHandle, async () => {
      await store.append(write(TURN_A, GRAPH_A));
    });
    expect(backend.storedGraph()).toEqual(GRAPH_A);
  });

  it('a STOP that arrives BEFORE the claim still fences the turn (arrival 5)', async () => {
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);

    // The stop upserts a tombstoned row; the claim then hits ON CONFLICT.
    await store.markTurnStopped(SCENARIO, TURN_A);
    const handle = await store.claimTurnFence(SCENARIO, TURN_A);
    expect(handle).not.toBeNull();
    // The claim MUST NOT have cleared the tombstone.
    expect(backend.rows.find((r) => r.turnId === TURN_A)?.stoppedAt).not.toBeNull();

    const refusal = await runWithTurnFence(handle as TurnFenceHandle, async () =>
      await store.append(write(TURN_A, GRAPH_A)).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect((refusal as TurnFenceRejectedError).verdict).toBe('stopped');
    expect(backend.storedGraph()).toBeNull();
  });

  it('a graph write with NO ingress fence context proceeds, and says so', async () => {
    // The one non-refusing gap, asserted rather than left to a comment: a
    // commit that never passed through the fenced ingress has no handle to
    // evaluate. It must not silently look fenced.
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    setTestSink((event, payload) => events.push({ event, payload }));

    const result = await store.append(write(TURN_A, GRAPH_A)); // no runWithTurnFence

    expect(result.id).toBe(`row-${TURN_A}`);
    expect(backend.calls.filter((c) => c.fn === 'v5_evaluate_turn_fence')).toHaveLength(0);
    const fenceEvent = events.find((e) => e.event === 'v5.turn_fence.evaluated');
    expect(fenceEvent?.payload.verdict).toBe('unfenced');
    expect(fenceEvent?.payload.reason).toBe('no_ingress_fence');
    setTestSink(null);
  });

  it('emits the refusal event with a closed verdict and no graph content', async () => {
    const backend = makeFenceBackedClient();
    const store = makeStore(backend.client);
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    setTestSink((event, payload) => events.push({ event, payload }));

    const handleA = await store.claimTurnFence(SCENARIO, TURN_A);
    await store.claimTurnFence(SCENARIO, TURN_B);
    await runWithTurnFence(handleA as TurnFenceHandle, async () =>
      await store.append(write(TURN_A, GRAPH_A)).then(
        () => null,
        () => null,
      ),
    );

    const refused = events.find((e) => e.event === 'v5.turn_fence.graph_write_refused');
    expect(refused).toBeDefined();
    expect(refused?.payload.verdict).toBe('superseded');
    expect(refused?.payload.generation).toBe(1);
    expect(refused?.payload.max_generation).toBe(2);
    expect(JSON.stringify(refused?.payload)).not.toContain('On-Call');
    setTestSink(null);
  });
});
