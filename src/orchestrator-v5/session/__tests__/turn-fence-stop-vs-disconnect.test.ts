/**
 * Explicit Stop and incidental disconnect remain different after graph writes
 * move to append_turn_atomic_v5. The v5 fake also pins that a replay is a
 * non-authoritative failure, not a second success receipt.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import {
  GraphAppendReplayError,
  type SessionTurnWrite,
} from '../store.js';
import {
  runWithTurnFence,
  TurnFenceRejectedError,
  type TurnFenceHandle,
} from '../turn-fence.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO = 'dcfc3b50-03b0-4b74-bc56-6dd0ce1531d7';
const TURN_A = 'dcfc3b50-03b0-4b74-bc56-6dd0ce1531a1';
const TURN_B = 'dcfc3b50-03b0-4b74-bc56-6dd0ce1531b2';

const GRAPH_A = {
  nodes: [{ id: 'n_a', kind: 'factor', label: 'Draft A' }],
  edges: [],
};
const GRAPH_B = {
  nodes: [{ id: 'n_b', kind: 'factor', label: 'Draft B' }],
  edges: [],
};

function makeBackend() {
  const rows = new Map<string, { generation: number; stopped: boolean }>();
  const snapshots = new Map<string, unknown>();
  const calls: string[] = [];
  let generation = 0;
  let graph: unknown = null;
  let claimFails = false;

  const claim = (turnId: string): number | null => {
    if (claimFails) return null;
    const existing = rows.get(turnId);
    if (existing !== undefined) return existing.generation;
    generation += 1;
    rows.set(turnId, { generation, stopped: false });
    return generation;
  };
  const stop = (turnId: string): void => {
    const existing = rows.get(turnId);
    if (existing !== undefined) existing.stopped = true;
    else {
      generation += 1;
      rows.set(turnId, { generation, stopped: true });
    }
  };

  const query: Record<string, unknown> = {};
  for (const method of ['select', 'update', 'eq', 'neq', 'is', 'not', 'order', 'in']) {
    query[method] = () => query;
  }
  query.limit = () => Promise.resolve({ data: [], error: null });
  query.maybeSingle = () => Promise.resolve({ data: null, error: null });
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve);

  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push(fn);
      const turnId = String(args.p_turn_id ?? '');
      if (fn === 'v5_claim_turn_fence') {
        const admitted = claim(turnId);
        return admitted === null
          ? { data: null, error: { code: 'DB_DOWN', message: 'claim failed' } }
          : { data: admitted, error: null };
      }
      if (fn === 'v5_mark_turn_stopped') {
        stop(turnId);
        return {
          data: {
            stopped: true,
            claimed: true,
            already_committed: snapshots.has(turnId),
          },
          error: null,
        };
      }
      if (fn === 'append_turn_atomic_v5') {
        const prior = snapshots.get(turnId);
        if (prior !== undefined) {
          return {
            data: {
              id: turnId,
              disposition:
                JSON.stringify(prior) === JSON.stringify(args.p_graph)
                  ? 'replayed_identical'
                  : 'replayed_divergent',
            },
            error: null,
          };
        }
        const admitted = [...rows.entries()].find(
          ([, row]) => row.generation === args.p_fence_generation,
        );
        if (args.p_fence_generation !== null) {
          if (admitted === undefined) {
            return { data: null, error: { code: 'OLTF3', message: 'unclaimed', details: '{}' } };
          }
          if (admitted[1].stopped) {
            return {
              data: null,
              error: {
                code: 'OLTF1',
                message: 'stopped',
                details: JSON.stringify({
                  generation: admitted[1].generation,
                  max_generation: generation,
                }),
              },
            };
          }
          if (admitted[1].generation < generation && graph !== null) {
            return {
              data: null,
              error: {
                code: 'OLTF2',
                message: 'superseded',
                details: JSON.stringify({
                  generation: admitted[1].generation,
                  max_generation: generation,
                }),
              },
            };
          }
        }
        graph = args.p_graph;
        snapshots.set(turnId, args.p_graph);
        return { data: { id: turnId, disposition: 'inserted' }, error: null };
      }
      if (fn === 'append_turn_atomic_v2') {
        return { data: turnId, error: null };
      }
      return { data: null, error: { code: 'UNEXPECTED', message: fn } };
    }),
    from: vi.fn(() => query as never),
  } as unknown as SupabaseClient;

  return {
    client,
    calls,
    claim,
    stop,
    graph: () => graph,
    setGraph: (value: unknown) => {
      graph = value;
    },
    failClaims: () => {
      claimFails = true;
    },
  };
}

function store(client: SupabaseClient) {
  return new SupabaseSessionStore(
    client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
    { defaultReadLimit: 20 },
  );
}

function write(turnId: string, graph = GRAPH_A): SessionTurnWrite {
  return {
    scenario_id: SCENARIO,
    turn_id: turnId,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: 'sha256:fixture',
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 42,
    handler_facts: [],
    graph,
  };
}

function handle(turnId: string, admitted: number | null): TurnFenceHandle {
  return { scenarioId: SCENARIO, turnId, generation: admitted };
}

afterEach(() => setTestSink(null));

describe('explicit Stop', () => {
  it('refuses the stopped turn and preserves the later current graph', async () => {
    const db = makeBackend();
    db.setGraph(GRAPH_B);
    const admitted = db.claim(TURN_A)!;
    db.claim(TURN_B);
    db.stop(TURN_A);

    await expect(
      runWithTurnFence(handle(TURN_A, admitted), () =>
        store(db.client).append(write(TURN_A)),
      ),
    ).rejects.toMatchObject({
      name: TurnFenceRejectedError.name,
      verdict: 'stopped',
    });
    expect(db.graph()).toBe(GRAPH_B);
  });

  it('a Stop recorded before admission still refuses', async () => {
    const db = makeBackend();
    db.stop(TURN_A);
    const admitted = db.claim(TURN_A)!;
    await expect(
      runWithTurnFence(handle(TURN_A, admitted), () =>
        store(db.client).append(write(TURN_A)),
      ),
    ).rejects.toMatchObject({ verdict: 'stopped' });
  });

  it("stopping another turn does not stop this one", async () => {
    const db = makeBackend();
    const admitted = db.claim(TURN_A)!;
    db.stop(TURN_B);
    const result = await runWithTurnFence(handle(TURN_A, admitted), () =>
      store(db.client).append(write(TURN_A)),
    );
    expect(result.graph_write_disposition).toBe('accepted_insert');
  });
});

describe('incidental disconnect', () => {
  it('sends no Stop tombstone and the admitted graph still commits', async () => {
    const db = makeBackend();
    const admitted = db.claim(TURN_A)!;
    const result = await runWithTurnFence(handle(TURN_A, admitted), () =>
      store(db.client).append(write(TURN_A)),
    );
    expect(result.graph_write_disposition).toBe('accepted_insert');
    expect(db.graph()).toBe(GRAPH_A);
    expect(db.calls).not.toContain('v5_mark_turn_stopped');
  });
});

describe('fence availability and replay', () => {
  it('a failed ingress claim refuses before append', async () => {
    const db = makeBackend();
    db.failClaims();
    const session = store(db.client);
    const mark = vi.spyOn(session, 'markGraphWriteFailed');
    await expect(
      runWithTurnFence(handle(TURN_A, null), () =>
        session.append(write(TURN_A)),
      ),
    ).rejects.toMatchObject({ verdict: 'unclaimed' });
    expect(db.calls).not.toContain('append_turn_atomic_v5');
    expect(mark).toHaveBeenCalledWith(
      SCENARIO,
      TURN_A,
      'unclaimed',
      'draft_loss',
    );
  });

  it('a non-ingress graph writer uses v5 unfenced, never a legacy graph RPC', async () => {
    const db = makeBackend();
    const result = await store(db.client).append(write(TURN_A));
    expect(result.graph_write_disposition).toBe('accepted_insert');
    expect(db.calls.filter((name) => name.startsWith('append_turn_atomic')))
      .toEqual(['append_turn_atomic_v5']);
  });

  it('an identical same-turn replay is explicit non-authoritative failure', async () => {
    const db = makeBackend();
    const admitted = db.claim(TURN_A)!;
    const session = store(db.client);
    await runWithTurnFence(handle(TURN_A, admitted), () =>
      session.append(write(TURN_A)),
    );
    await expect(
      runWithTurnFence(handle(TURN_A, admitted), () =>
        session.append(write(TURN_A)),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: GraphAppendReplayError.name,
        graph_write_disposition: 'byte_identical_replay',
      }),
    );
  });

  it('a divergent same-turn replay is explicit non-authoritative failure', async () => {
    const db = makeBackend();
    const admitted = db.claim(TURN_A)!;
    const session = store(db.client);
    await runWithTurnFence(handle(TURN_A, admitted), () =>
      session.append(write(TURN_A)),
    );
    await expect(
      runWithTurnFence(handle(TURN_A, admitted), () =>
        session.append(write(TURN_A, GRAPH_B)),
      ),
    ).rejects.toMatchObject({ graph_write_disposition: 'divergent_replay' });
    expect(db.graph()).toBe(GRAPH_A);
  });
});
