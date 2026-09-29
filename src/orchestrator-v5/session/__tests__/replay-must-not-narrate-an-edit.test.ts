/**
 * THE STORE REPORTS A REPLAY AS A FACT, VERIFIED BY `request_hash`.
 *
 * ⛔ `(scenario_id, turn_id)` ANSWERS "WILL THE RPC NO-OP?", NOT "IS THIS THE
 *    SAME REQUEST REPLAYING?". `turn_id` is CLIENT-SUPPLIED, so without
 *    `request_hash` a client reusing a turn id for a DIFFERENT message would be
 *    reported as a replay — and the caller would tell them nothing was written
 *    when their new request genuinely was refused. That is strictly worse than
 *    today. `apply-operations.ts:694-700` already guards this exact class.
 *
 * ⚠ THE PREVIOUS VERSION OF THIS SUITE COULD NOT DETECT A WRONG FILTER. Its
 *   fake `eq` ignored its arguments, so a mutant dropping `.eq('scenario_id')`
 *   survived every test. The fake below RECORDS the filters and the suite
 *   asserts them, so the read is bound to the columns it claims to use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupabaseSessionStore } from '../supabase-store.js';
import type { SessionTurnWrite } from '../store.js';
import { setTestSink } from '../../../utils/telemetry.js';

afterEach(() => setTestSink(null));

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MUTATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HASH = 'a'.repeat(64);
const ANALYSIS_HASH = 'b'.repeat(64);
const REQUEST_HASH = 'sha256:the-same-request';

const rpc = vi.fn();
const cache = { invalidateAll: vi.fn() };

let priorRows: Array<Record<string, unknown>> = [];
/** Every `.eq(column, value)` the store issued against the turns table. */
let filters: Array<[string, unknown]> = [];
let selectedColumns: string[] = [];

const client = {
  rpc,
  from: vi.fn((table: string) => ({
    select: vi.fn((columns: string) => {
      if (table === 'v5_conversation_turns') selectedColumns.push(columns);
      const result =
        table === 'v5_conversation_turns' ? { data: priorRows, error: null } : { data: [], error: null };
      const builder: Record<string, unknown> = {
        eq: vi.fn((col: string, val: unknown) => {
          if (table === 'v5_conversation_turns') filters.push([col, val]);
          return builder;
        }),
        limit: vi.fn(() => Promise.resolve(result)),
        maybeSingle: vi.fn(() => Promise.resolve({ data: { graph_identity_hash: null }, error: null })),
        then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
      };
      return builder;
    }),
  })),
};

function write(overrides: Partial<SessionTurnWrite> = {}): SessionTurnWrite {
  return {
    scenario_id: SCENARIO,
    turn_id: TURN,
    turn_class: 'handler',
    handler_id: 'set_factor_value',
    request_hash: REQUEST_HASH,
    response_emitted: true,
    llm_calls_used: 0,
    duration_ms: 1,
    handler_facts: [],
    graph: { nodes: [], edges: [] },
    assistantMessage: 'Updated Sales Cycle Length from 17 months to 14 months.',
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
    ...overrides,
  } as SessionTurnWrite;
}

const store = () =>
  new SupabaseSessionStore(client as never, cache as never, { defaultReadLimit: 20 } as never);

beforeEach(() => {
  vi.clearAllMocks();
  priorRows = [];
  filters = [];
  selectedColumns = [];
  // The non-graph append path uses `append_turn_atomic_v2`, which returns a bare
  // string id; the graph-bearing v5 path returns the receipt object.
  rpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === 'append_turn_atomic_v5'
        ? { data: { turn_row_id: 'turn-row', model_version_receipt: null }, error: null }
        : { data: 'turn-row', error: null },
    ),
  );
});

describe('the store reports a replay, verified by request_hash', () => {
  it('a committed row for the SAME request is reported as a replay', async () => {
    priorRows = [{ request_hash: REQUEST_HASH }];
    expect((await store().append(write())).replayedPriorTurn).toBe(true);
  });

  it('⛔ a DIFFERENT request under the same turn_id is NOT a replay', async () => {
    priorRows = [{ request_hash: 'sha256:a-completely-different-question' }];
    expect(
      (await store().append(write())).replayedPriorTurn,
      'reporting this as a replay would tell the user their new instruction had ' +
        'already been recorded, when it was refused and never ran',
    ).toBeUndefined();
  });

  /**
   * ⭐ THE DETECTION HALF, AND WHY IT IS ASSERTED HERE RATHER THAN AT THE CALLER.
   *
   * The caller's suite injects a store outcome directly, so it proves what
   * commit.ts DOES with a verdict — never that this method PRODUCES one. A
   * mutant collapsing the mismatch arm back to 'replay' survived that suite
   * completely. These rows execute the classification itself.
   */
  it('⛔ a DIFFERENT request under the same turn_id IS reported as a conflict', async () => {
    priorRows = [{ request_hash: 'sha256:a-completely-different-question' }];
    expect(
      (await store().append(write())).priorTurnConflict,
      'measured on deployed a459d23: without this verdict the caller composes fresh ' +
        'text from the PROPOSED patch and tells the user an edit happened that did not',
    ).toBe(true);
  });

  it('CONTROL — the SAME request is a replay and NOT a conflict', async () => {
    priorRows = [{ request_hash: REQUEST_HASH }];
    const outcome = await store().append(write());
    expect(outcome.replayedPriorTurn).toBe(true);
    expect(
      outcome.priorTurnConflict,
      'collapsing the arms the other way would tell a genuine retry its change was refused',
    ).toBeUndefined();
  });

  it('CONTROL — an unreadable prior row is an UNKNOWN, never a conflict', async () => {
    priorRows = [{ request_hash: 12345 as unknown as string }];
    const outcome = await store().append(write());
    expect(outcome.priorTurnConflict, 'a non-string hash is no evidence of a different request').toBeUndefined();
    expect(outcome.replayedPriorTurn).toBeUndefined();
  });

  it('CONTROL — a FIRST commit is neither, so ordinary turns are untouched', async () => {
    priorRows = [];
    const outcome = await store().append(write());
    expect(outcome.replayedPriorTurn).toBeUndefined();
    expect(outcome.priorTurnConflict).toBeUndefined();
  });

  it('CONTROL — a non-graph write pays no read at all', async () => {
    priorRows = [{ request_hash: REQUEST_HASH }];
    // graph and modelVersion travel together — the store rejects one without
    // the other (`appendAtomicVersioned`), so a non-graph write drops both.
    const outcome = await store().append(write({ graph: undefined, modelVersion: undefined }));
    expect(outcome.replayedPriorTurn).toBeUndefined();
    expect(outcome.priorTurnConflict).toBeUndefined();
    // Other paths also read this table, so the precise claim is that MY read —
    // the one that selects `request_hash` — did not run.
    expect(
      selectedColumns.filter((c) => c.includes('request_hash')),
      'a turn that writes no graph must not pay the replay lookup',
    ).toHaveLength(0);
  });

  it('the read is BOUND to (scenario_id, turn_id) and to request_hash', async () => {
    priorRows = [{ request_hash: REQUEST_HASH }];
    await store().append(write());
    expect(filters).toEqual([
      ['scenario_id', SCENARIO],
      ['turn_id', TURN],
    ]);
    expect(selectedColumns.join(',')).toContain('request_hash');
  });

  it('the durable write is UNCHANGED — the RPC remains the idempotency authority', async () => {
    priorRows = [{ request_hash: REQUEST_HASH }];
    const outcome = await store().append(write());
    expect(rpc).toHaveBeenCalled();
    expect(outcome.id).toBe('turn-row');
  });
});
