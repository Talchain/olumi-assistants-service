/**
 * Turn-fence and CAS checks carried by the singular graph-only v5 append.
 * The fake injects rivals at the top of the append transaction, closing the
 * old evaluate→legacy-append window deterministically.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { computeExpectedGraphCasHashes } from '../../context/graph-cas-conflict.js';
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
const GRAPH_B = {
  nodes: [{ id: 'n_b', kind: 'factor', label: 'Window Probe B' }],
  edges: [],
};

interface FenceRow {
  generation: number;
  turnId: string;
  stopped: boolean;
}

function makeBackend() {
  const rows: FenceRow[] = [];
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let graph: unknown = null;
  let graphIdentityHash: string | null = null;
  let sequence = 0;
  let onBeforeAppend: (() => void) | null = null;
  let v5Missing = false;

  const claim = (turnId: string): number => {
    const existing = rows.find((row) => row.turnId === turnId);
    if (existing !== undefined) return existing.generation;
    sequence += 1;
    rows.push({ generation: sequence, turnId, stopped: false });
    return sequence;
  };
  const stop = (turnId: string): void => {
    const existing = rows.find((row) => row.turnId === turnId);
    if (existing !== undefined) existing.stopped = true;
    else {
      sequence += 1;
      rows.push({ generation: sequence, turnId, stopped: true });
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
      calls.push({ fn, args });
      if (fn === 'append_turn_atomic_v5') {
        if (onBeforeAppend !== null) {
          const rival = onBeforeAppend;
          onBeforeAppend = null;
          rival();
        }
        if (v5Missing) {
          return { data: null, error: { code: 'PGRST202', message: 'v5 missing' } };
        }
        const generation = args.p_fence_generation as number | null;
        if (generation !== null) {
          const mine = rows.find((row) => row.generation === generation);
          const max = Math.max(...rows.map((row) => row.generation));
          if (mine === undefined) {
            return { data: null, error: { code: 'OLTF3', message: 'unclaimed', details: '{}' } };
          }
          if (mine.stopped) {
            return {
              data: null,
              error: {
                code: 'OLTF1',
                message: 'stopped',
                details: JSON.stringify({ generation, max_generation: max }),
              },
            };
          }
          // v5 preserves the locked first-write exemption: supersession only
          // refuses when there is a current graph to protect.
          if (generation < max && graph !== null) {
            return {
              data: null,
              error: {
                code: 'OLTF2',
                message: 'superseded',
                details: JSON.stringify({ generation, max_generation: max }),
              },
            };
          }
        }
        if (
          args.p_cas_enforce === true &&
          args.p_expected_graph_identity_hash != null &&
          graphIdentityHash !== null &&
          graphIdentityHash !== args.p_expected_graph_identity_hash &&
          (args.p_incoming_graph_identity_hash == null ||
            args.p_incoming_graph_identity_hash !== graphIdentityHash)
        ) {
          return { data: null, error: { code: 'OLGC1', message: 'stale' } };
        }
        graph = args.p_graph;
        graphIdentityHash = (args.p_incoming_graph_identity_hash as string | null) ?? null;
        return { data: { id: String(args.p_turn_id), disposition: 'inserted' }, error: null };
      }
      if (fn === 'append_turn_atomic_v2') {
        return { data: String(args.p_turn_id), error: null };
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
      graphIdentityHash =
        value == null
          ? null
          : computeExpectedGraphCasHashes(value).expectedGraphIdentityHash;
    },
    beforeAppend: (rival: () => void) => {
      onBeforeAppend = rival;
    },
    missingV5: () => {
      v5Missing = true;
    },
  };
}

function store(client: SupabaseClient, graphCasRpc: 'off' | 'enforce' = 'off') {
  return new SupabaseSessionStore(
    client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
    { defaultReadLimit: 20, graphCasRpc },
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
    ...(graph === undefined ? {} : { graph }),
  };
}

function handle(turnId: string, generation: number): TurnFenceHandle {
  return { scenarioId: SCENARIO, turnId, generation };
}

beforeEach(() => setTestSink(null));

describe('v5 in-transaction fence', () => {
  it('refuses a Stop that lands at append and writes no graph', async () => {
    const db = makeBackend();
    const generation = db.claim(TURN_A);
    db.beforeAppend(() => db.stop(TURN_A));
    const session = store(db.client);
    const mark = vi.spyOn(session, 'markGraphWriteFailed');
    const result = runWithTurnFence(handle(TURN_A, generation), () =>
      session.append(write(TURN_A, GRAPH_A)),
    );
    await expect(result).rejects.toMatchObject({
      name: TurnFenceRejectedError.name,
      verdict: 'stopped',
    });
    expect(db.graph()).toBeNull();
    expect(mark).toHaveBeenCalledWith(
      SCENARIO,
      TURN_A,
      'stopped',
      'draft_loss',
    );
  });

  it('allows a superseded first graph under the same scenario lock', async () => {
    const db = makeBackend();
    const generation = db.claim(TURN_A);
    db.beforeAppend(() => void db.claim(TURN_B));
    const session = store(db.client);
    const mark = vi.spyOn(session, 'markGraphWriteFailed');
    const result = await runWithTurnFence(handle(TURN_A, generation), () =>
      session.append(write(TURN_A, GRAPH_A)),
    );
    expect(result.graph_write_disposition).toBe('accepted_insert');
    expect(db.graph()).toBe(GRAPH_A);
    expect(mark).not.toHaveBeenCalled();
  });

  it('refuses a superseded graph when current authority exists', async () => {
    const db = makeBackend();
    db.setGraph(GRAPH_B);
    const generation = db.claim(TURN_A);
    db.beforeAppend(() => void db.claim(TURN_B));
    const session = store(db.client);
    const mark = vi.spyOn(session, 'markGraphWriteFailed');
    await expect(
      runWithTurnFence(handle(TURN_A, generation), () =>
        session.append(write(TURN_A, GRAPH_A)),
      ),
    ).rejects.toMatchObject({ verdict: 'superseded' });
    expect(db.graph()).toBe(GRAPH_B);
    expect(mark).toHaveBeenCalledWith(
      SCENARIO,
      TURN_A,
      'superseded',
      'draft_loss',
    );
  });

  it('passes the admitted generation and does no pre-RPC evaluation', async () => {
    const db = makeBackend();
    const generation = db.claim(TURN_A);
    await runWithTurnFence(handle(TURN_A, generation), () =>
      store(db.client).append(write(TURN_A, GRAPH_A)),
    );
    expect(db.calls.some((call) => call.fn === 'v5_evaluate_turn_fence')).toBe(false);
    expect(db.calls.find((call) => call.fn === 'append_turn_atomic_v5')?.args)
      .toMatchObject({ p_fence_generation: generation });
  });

  it('missing v5 fails closed with no graph fallback', async () => {
    const db = makeBackend();
    db.missingV5();
    const generation = db.claim(TURN_A);
    await expect(
      runWithTurnFence(handle(TURN_A, generation), () =>
        store(db.client).append(write(TURN_A, GRAPH_A)),
      ),
    ).rejects.toMatchObject({ rpc_code: 'PGRST202' });
    expect(
      db.calls.filter((call) => call.fn.startsWith('append_turn_atomic')).map((call) => call.fn),
    ).toEqual(['append_turn_atomic_v5']);
  });

  it('graph-free turns remain on v2 and do not touch the fence', async () => {
    const db = makeBackend();
    const result = await store(db.client).append(write(TURN_A));
    expect(result.id).toBe(TURN_A);
    expect(db.calls.map((call) => call.fn)).toEqual(['append_turn_atomic_v2']);
  });
});

describe('v5 in-transaction CAS coexists with the fence', () => {
  it('maps OLGC1 without weakening the admitted generation', async () => {
    const db = makeBackend();
    db.setGraph(GRAPH_A);
    const generation = db.claim(TURN_B);
    const result = runWithTurnFence(handle(TURN_B, generation), () =>
      store(db.client, 'enforce').append({
        ...write(TURN_B, GRAPH_B),
        expectedGraphIdentityHash: 'deadbeef'.repeat(8),
      }),
    );
    await expect(result).rejects.toBeInstanceOf(GraphStaleWriteError);
    expect(db.graph()).toBe(GRAPH_A);
  });
});
