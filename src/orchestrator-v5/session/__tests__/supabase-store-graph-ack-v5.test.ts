import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import {
  GraphAppendReplayError,
  StateCommitFailedError,
  type SessionTurnWrite,
} from '../store.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GRAPH = { nodes: [], edges: [], options: [], goal_node_id: null, goal_constraints: [] };

const GRAPH_WRITE: SessionTurnWrite = {
  scenario_id: SCENARIO_ID,
  turn_id: 'turn-graph-ack',
  turn_class: 'direct_answer',
  handler_id: null,
  request_hash: 'sha256:graph-ack',
  response_emitted: true,
  llm_calls_used: 0,
  duration_ms: 1,
  handler_facts: [],
  graph: GRAPH,
};

function makeClient(result: {
  readonly data?: unknown;
  readonly error?: { readonly message: string; readonly code?: string } | null;
}) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let updateCalls = 0;
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: result.data ?? null, error: result.error ?? null };
    }),
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.update = () => {
        updateCalls += 1;
        return chain;
      };
      for (const name of ['eq', 'not', 'is']) chain[name] = () => chain;
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve);
      return chain as never;
    }),
  } as unknown as SupabaseClient;
  return { client, rpcCalls, getUpdateCalls: () => updateCalls };
}

function makeStore(client: SupabaseClient, cache?: SessionLRUCache) {
  return new SupabaseSessionStore(
    client,
    cache ?? new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
    { defaultReadLimit: 20 },
  );
}

describe('SupabaseSessionStore graph append v5 acknowledgement', () => {
  it('accepts only inserted, uses v5 once, and returns the canonical disposition', async () => {
    const { client, rpcCalls, getUpdateCalls } = makeClient({
      data: { id: ROW_ID, disposition: 'inserted' },
    });
    const result = await makeStore(client).append(GRAPH_WRITE);

    expect(result).toEqual({
      id: ROW_ID,
      graph_write_disposition: 'accepted_insert',
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v5');
    expect(rpcCalls[0]!.args).toMatchObject({
      p_graph: GRAPH,
      p_fence_generation: null,
      p_cas_enforce: false,
    });
    expect(getUpdateCalls()).toBe(1);
  });

  it.each([
    ['replayed_identical', 'byte_identical_replay'],
    ['replayed_divergent', 'divergent_replay'],
  ] as const)(
    '%s is a typed non-authoritative failure with no cache/loss side effect',
    async (rpcDisposition, graphDisposition) => {
      const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
      cache.populate(SCENARIO_ID, []);
      const { client, rpcCalls, getUpdateCalls } = makeClient({
        data: { id: ROW_ID, disposition: rpcDisposition },
      });

      let thrown: unknown;
      try {
        await makeStore(client, cache).append(GRAPH_WRITE);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphAppendReplayError);
      expect(thrown).toMatchObject({
        rpc_code: 'GRAPH_APPEND_REPLAY',
        graph_write_disposition: graphDisposition,
      });
      expect(cache.getScenario(SCENARIO_ID)).not.toBeNull();
      expect(getUpdateCalls()).toBe(0);
      expect(rpcCalls.map((call) => call.fn)).toEqual(['append_turn_atomic_v5']);
      expect(JSON.stringify(thrown)).not.toContain('nodes');
    },
  );

  it.each([
    ['missing', null],
    ['legacy UUID', ROW_ID],
    ['unknown disposition', { id: ROW_ID, disposition: 'ok' }],
    ['extra key', { id: ROW_ID, disposition: 'inserted', graph: GRAPH }],
    ['invalid id', { id: 'row-id', disposition: 'inserted' }],
  ])('fails closed on malformed %s acknowledgement', async (_label, data) => {
    const { client, rpcCalls } = makeClient({ data });
    await expect(makeStore(client).append(GRAPH_WRITE)).rejects.toMatchObject({
      rpc_code: 'GRAPH_APPEND_ACK_INVALID',
    });
    expect(rpcCalls.map((call) => call.fn)).toEqual(['append_turn_atomic_v5']);
  });

  it('fails closed with no legacy fallback when v5 is absent', async () => {
    const { client, rpcCalls } = makeClient({
      error: { code: 'PGRST202', message: 'function missing' },
    });
    await expect(makeStore(client).append(GRAPH_WRITE)).rejects.toBeInstanceOf(
      StateCommitFailedError,
    );
    expect(rpcCalls.map((call) => call.fn)).toEqual(['append_turn_atomic_v5']);
  });

  it('keeps graph-free writes byte-identical on v2', async () => {
    const { client, rpcCalls, getUpdateCalls } = makeClient({ data: ROW_ID });
    const result = await makeStore(client).append({ ...GRAPH_WRITE, graph: undefined });
    expect(result).toEqual({ id: ROW_ID });
    expect(rpcCalls.map((call) => call.fn)).toEqual(['append_turn_atomic_v2']);
    expect(getUpdateCalls()).toBe(0);
  });

  it('has one graph RPC and no SELECT-only replay recovery or legacy graph dispatch', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../supabase-store.ts', import.meta.url)),
      'utf8',
    );
    expect(source.match(/client\.rpc\('append_turn_atomic_v5'/g)).toHaveLength(1);
    expect(source).not.toMatch(/client\.rpc\('append_turn_atomic_v[34]'/);
    expect(source).not.toContain('tryFirstWriteExemptRecovery');
    expect(source).not.toMatch(/\.select\(['"]id['"]\)[\s\S]{0,300}turn_id/);
  });
});
