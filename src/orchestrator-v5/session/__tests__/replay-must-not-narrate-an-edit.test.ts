/**
 * A REPLAYED COMMIT MUST NOT LET THE CALLER NARRATE AN EDIT IT DID NOT MAKE.
 *
 * ── THE DEFECT, WITNESSED ON DEPLOYED STAGING (build c12a54d, 22 Sep 2026) ──
 * Scenario 6f59981e-541a-48ad-a774-cac6de21f810, signed-in, three real turns:
 *
 *   1. turn T1 sets Sales Cycle Length to 14   -> persisted raw_value 14
 *   2. turn T2 (a DIFFERENT turn) sets it to 17 -> persisted raw_value 17
 *   3. the T1 client never received its response and RETRIES T1:
 *
 *        SAID : "Updated Sales Cycle Length from 17 months to 14 months."
 *        STATE: dTurns=0  dVersions=0  persisted raw_value = 17  hash UNCHANGED
 *
 * The DURABLE behaviour is correct and must not change: the retry is idempotent,
 * writes nothing, and does NOT clobber the newer value. What is wrong is the
 * SENTENCE. The handler re-runs against CURRENT state and composes its
 * confirmation BEFORE the commit resolves as a replay, and nothing reconciles
 * the narration with the fact that no write occurred.
 *
 * A user who loses a response and retries is told their edit landed when the
 * model actually holds someone else's newer value.
 *
 * ── WHY THE STORE IS THE FIRST BOUNDARY THAT CAN KNOW ──────────────────────
 * `append_turn_atomic_v5` returns `{turn_row_id, model_version_receipt}` and
 * carries NO replay flag (read from the deployed function body, 22 Sep), so the
 * caller cannot tell a replay from a fresh commit by the return value. Adding
 * one is a migration on a database shared with production.
 *
 * The store CAN know without any migration: `v5_conversation_turns` is UNIQUE
 * on `(scenario_id, turn_id)` and rows are never deleted, so a row that already
 * exists under this write's key means this append CANNOT create a new one — it
 * will replay. The pre-read can only be wrong in the direction of a FALSE
 * NEGATIVE (a concurrent insert between the read and the RPC), which degrades
 * to exactly today's behaviour and is never worse.
 *
 * So the store surfaces the ORIGINAL stored prose and the caller prefers it.
 * That is what "idempotent replay" means for the response, not only the write.
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

/** What the FIRST attempt durably recorded. */
const ORIGINAL_PROSE = 'Updated Sales Cycle Length from 9 months to 14 months.';
/** What the handler freshly composes on the retry, against state that moved. */
const FRESHLY_COMPOSED = 'Updated Sales Cycle Length from 17 months to 14 months.';

const rpc = vi.fn();
const cache = { invalidateAll: vi.fn() };

/** Rows `v5_conversation_turns` holds for (scenario_id, turn_id) in this test. */
let priorTurnRows: Array<Record<string, unknown>> = [];
const turnSelectColumns: string[] = [];

const client = {
  rpc,
  from: vi.fn((table: string) => ({
    select: vi.fn((columns: string) => {
      if (table === 'v5_conversation_turns') turnSelectColumns.push(columns);
      const result =
        table === 'v5_conversation_turns'
          ? { data: priorTurnRows, error: null }
          : { data: [], error: null };
      // Support .eq().eq().limit() AND .eq().maybeSingle(), awaited either way.
      const builder: Record<string, unknown> = {
        eq: vi.fn(() => builder),
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
    request_hash: 'request-hash',
    response_emitted: true,
    llm_calls_used: 0,
    duration_ms: 1,
    handler_facts: [],
    graph: { nodes: [], edges: [] },
    assistantMessage: FRESHLY_COMPOSED,
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
  priorTurnRows = [];
  turnSelectColumns.length = 0;
  rpc.mockResolvedValue({ data: { turn_row_id: 'turn-row', model_version_receipt: null }, error: null });
});

describe('a replayed commit surfaces the prose it ACTUALLY recorded', () => {
  it('RED: when this (scenario, turn_id) already committed, append returns the ORIGINAL prose', async () => {
    priorTurnRows = [{ id: 'turn-row', assistant_message: ORIGINAL_PROSE }];

    const outcome = await store().append(write());

    expect(
      outcome.replayedAssistantMessage,
      'the store must hand back what was durably recorded, so the caller cannot ' +
        'narrate an edit that did not happen',
    ).toBe(ORIGINAL_PROSE);
  });

  it('CONTROL — a FIRST commit carries no replayed prose, so ordinary turns are untouched', async () => {
    priorTurnRows = []; // nothing committed under this key yet

    const outcome = await store().append(write());

    expect(outcome.replayedAssistantMessage).toBeUndefined();
  });

  it('CONTROL — a prior row with an EMPTY message is not treated as recoverable prose', async () => {
    priorTurnRows = [{ id: 'turn-row', assistant_message: '' }];

    const outcome = await store().append(write());

    expect(outcome.replayedAssistantMessage).toBeUndefined();
  });

  it('the durable write is UNCHANGED — the replay still calls the append RPC', async () => {
    priorTurnRows = [{ id: 'turn-row', assistant_message: ORIGINAL_PROSE }];

    const outcome = await store().append(write());

    expect(rpc, 'the RPC is the idempotency authority and must still run').toHaveBeenCalled();
    expect(outcome.id).toBe('turn-row');
  });
});
