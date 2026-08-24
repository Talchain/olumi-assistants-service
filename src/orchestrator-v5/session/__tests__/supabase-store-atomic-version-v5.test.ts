import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupabaseSessionStore } from '../supabase-store.js';
import type { SessionTurnWrite } from '../store.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MUTATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VERSION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const HASH = 'a'.repeat(64);
const ANALYSIS_HASH = 'b'.repeat(64);

const receipt = {
  mutation_id: MUTATION,
  version_id: VERSION,
  version_number: 1,
  graph_identity_hash: HASH,
  analysis_affecting_hash: ANALYSIS_HASH,
  hash_algorithm: 'sha256',
  identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1',
  graph_schema_version: 'graph_v3',
  actor_kind: 'unknown',
  authored_by: null,
  creation_kind: 'initial',
  source_version_id: null,
  source_turn_id: TURN,
  parent_version_id: null,
  root_version_id: VERSION,
  undo_version_id: null,
  graph: { nodes: [], edges: [], custom_persisted_field: true },
  event_id: `model_version_created_mutation_${MUTATION}`,
};

const rpc = vi.fn();
const maybeSingle = vi.fn();
const cache = { invalidateAll: vi.fn() };
const client = {
  rpc,
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle })),
    })),
  })),
};

function write(): SessionTurnWrite {
  return {
    scenario_id: SCENARIO,
    turn_id: TURN,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: 'request-hash',
    response_emitted: true,
    llm_calls_used: 0,
    duration_ms: 1,
    handler_facts: [],
    graph: receipt.graph,
    modelVersion: {
      mutation_id: MUTATION,
      graph_identity_hash: HASH,
      analysis_affecting_hash: ANALYSIS_HASH,
      hash_algorithm: 'sha256',
      identity_projection_version: 'identity.v1',
      identity_normaliser_version: '1',
      graph_schema_version: 'graph_v3',
      actor_kind: 'unknown',
      authored_by: null,
      creation_kind: 'committed_mutation',
      source_turn_id: TURN,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: { graph_identity_hash: null }, error: null });
  rpc.mockResolvedValue({
    data: { turn_row_id: 'turn-row', model_version_receipt: receipt },
    error: null,
  });
});

describe('SupabaseSessionStore append_turn_atomic_v5', () => {
  it('uses the trusted null base and returns the canonical internal receipt', async () => {
    const store = new SupabaseSessionStore(client as never, cache as never, {
      defaultReadLimit: 20,
    });

    const outcome = await store.append(write());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe('append_turn_atomic_v5');
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_expected_graph_identity_hash: null,
      p_incoming_graph_identity_hash: HASH,
      p_cas_enforce: true,
      p_version_mutation_id: MUTATION,
      p_version_actor_kind: 'unknown',
    });
    expect(outcome).toEqual({ id: 'turn-row', modelVersionReceipt: receipt });
  });

  it('accepts an honest guest/no-op replay with no version receipt', async () => {
    rpc.mockResolvedValue({
      data: { turn_row_id: 'turn-row', model_version_receipt: null },
      error: null,
    });
    const store = new SupabaseSessionStore(client as never, cache as never, {
      defaultReadLimit: 20,
    });

    await expect(store.append(write())).resolves.toEqual({ id: 'turn-row' });
    expect(cache.invalidateAll).toHaveBeenCalledWith(SCENARIO);
  });
});
