/**
 * Decision Records (ROADMAP 3.1, CEE half) — Supabase store adapter tests.
 *
 * Mirrors the model-management store-adapter idiom: hand-rolled client mock
 * (no live network), exact named RPC arguments, typed error mapping on the
 * migration's distinct SQLSTATEs (DR001), content-level outcome parsing.
 *
 * The `create_decision_record` RPC contract under test is
 * supabase/migrations/20260710113000_v5_decision_records.sql (#406, merged;
 * execution Paul-gated — integration here is mocked at the client boundary;
 * the post-execution live poke lives in
 * tests/staging/decision-record-rpc.live.test.ts).
 */

import { describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import * as telemetry from '../../../utils/telemetry.js';

import {
  DecisionRecordSignInRequiredError,
  DecisionRecordStoreError,
  DECISION_RECORDS_HARD_CAP,
  SupabaseDecisionRecordStore,
  type CreateDecisionRecordWrite,
} from '../store-adapter.js';

const WRITE: CreateDecisionRecordWrite = {
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  decision: {
    chosen_option_id: 'opt_a',
    chosen_option_label: 'Option A',
    graph_hash: 'aag_v1:sha256:abcdef0123456789',
  },
  prediction: { statement: 'Option A currently leads.', confidence: 0.62 },
  review_date: '2026-10-08T12:00:00.000Z',
  record_id: '11111111-1111-5111-8111-111111111111',
  event_id: 'decision_recorded_11111111-1111-5111-8111-111111111111',
};

const OK_ENVELOPE = {
  record: {
    record_id: WRITE.record_id,
    scenario_id: WRITE.scenario_id,
    created_at: '2026-07-10T12:00:01+00:00',
    decision: WRITE.decision,
    prediction: WRITE.prediction,
    review_date: WRITE.review_date,
  },
  deduped: false,
  event_id: WRITE.event_id,
};

function makeClient(result: { data?: unknown; error?: unknown }): {
  client: SupabaseClient;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { client: { rpc } as Partial<SupabaseClient> as SupabaseClient, rpc };
}

describe('SupabaseDecisionRecordStore.createRecord', () => {
  it('calls create_decision_record with ALL named args (PostgREST overload discipline)', async () => {
    const { client, rpc } = makeClient({ data: OK_ENVELOPE });
    const store = new SupabaseDecisionRecordStore(client);
    await store.createRecord(WRITE);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('create_decision_record', {
      p_scenario_id: WRITE.scenario_id,
      p_decision: WRITE.decision,
      p_prediction: WRITE.prediction,
      p_review_date: WRITE.review_date,
      p_record_id: WRITE.record_id,
      p_event_id: WRITE.event_id,
    });
  });

  it('parses the RPC envelope into a typed outcome', async () => {
    const { client } = makeClient({ data: OK_ENVELOPE });
    const store = new SupabaseDecisionRecordStore(client);
    const outcome = await store.createRecord(WRITE);
    expect(outcome).toEqual({
      record_id: WRITE.record_id,
      deduped: false,
      event_id: WRITE.event_id,
    });
  });

  it('same-scenario replay (deduped: true, event_id null) parses as deduped', async () => {
    const { client } = makeClient({
      data: { ...OK_ENVELOPE, deduped: true, event_id: null },
    });
    const store = new SupabaseDecisionRecordStore(client);
    const outcome = await store.createRecord(WRITE);
    expect(outcome.deduped).toBe(true);
    expect(outcome.event_id).toBeNull();
  });

  it('DR001 (guest refusal) maps to DecisionRecordSignInRequiredError', async () => {
    const { client } = makeClient({
      error: { code: 'DR001', message: 'decision records require sign-in' },
    });
    const store = new SupabaseDecisionRecordStore(client);
    await expect(store.createRecord(WRITE)).rejects.toBeInstanceOf(
      DecisionRecordSignInRequiredError,
    );
  });

  it('any other RPC error maps to DecisionRecordStoreError', async () => {
    const { client } = makeClient({
      error: { code: '22023', message: 'p_decision carries keys outside the whitelist' },
    });
    const store = new SupabaseDecisionRecordStore(client);
    await expect(store.createRecord(WRITE)).rejects.toBeInstanceOf(DecisionRecordStoreError);
  });

  it('malformed outcome (no record.record_id) throws a typed store error, never returns silently-degraded data', async () => {
    const { client } = makeClient({ data: { deduped: false, event_id: null } });
    const store = new SupabaseDecisionRecordStore(client);
    await expect(store.createRecord(WRITE)).rejects.toBeInstanceOf(DecisionRecordStoreError);
  });
});

// ---------------------------------------------------------------------------
// retrieveRecords (P6, ROADMAP 1.199) — the scenario-scoped read
// ---------------------------------------------------------------------------

interface ReadCapture {
  from?: string;
  select?: string;
  selectOpts?: unknown;
  eq?: [string, unknown];
  order?: [string, unknown];
  limit?: number;
}

/**
 * Models PostgREST's answer to a limited SELECT carrying `Prefer: count=exact`:
 * `data` is the LIMITed page, `count` is the total AFTER the filters and
 * BEFORE the limit. Verified against the live staging PostgREST on a 9-record
 * scenario before this was written: `…&order=created_at.desc&limit=8` +
 * `Prefer: count=exact` → `HTTP/2 206`, `content-range: 0-7/9`.
 *
 * `count` is a REQUIRED field of the fake's result, deliberately: a mock that
 * silently omitted it would encode exactly the defect this read now closes.
 */
function makeReadClient(result: { data?: unknown; error?: unknown; count?: number | null }): {
  client: SupabaseClient;
  capture: ReadCapture;
} {
  const capture: ReadCapture = {};
  const rows = Array.isArray(result.data) ? result.data : null;
  const builder = {
    select(cols: string, opts?: unknown) { capture.select = cols; capture.selectOpts = opts; return builder; },
    eq(col: string, val: unknown) { capture.eq = [col, val]; return builder; },
    order(col: string, opts: unknown) { capture.order = [col, opts]; return builder; },
    limit(n: number) {
      capture.limit = n;
      return Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
        count: result.count !== undefined ? result.count : (rows?.length ?? null),
      });
    },
  };
  const client = {
    from(table: string) { capture.from = table; return builder; },
  } as unknown as SupabaseClient;
  return { client, capture };
}

const READ_ROW = {
  record_id: '11111111-1111-5111-8111-111111111111',
  scenario_id: 'scen-target',
  owner_user_id: 'should-not-be-selected',
  created_at: '2026-07-24T10:00:00+00:00',
  decision: { chosen_option_label: 'Hire locally', chosen_option_id: 'opt', graph_hash: 'aag_v1:sha256:x' },
  prediction: { statement: 'Local hiring leads.', confidence_source: 'model_derived' },
};

describe('SupabaseDecisionRecordStore.retrieveRecords (scenario-scoped read)', () => {
  it('scopes the query to the scenario at the bytes (.eq scenario_id), newest-first, hard-capped', async () => {
    const { client, capture } = makeReadClient({ data: [READ_ROW] });
    const store = new SupabaseDecisionRecordStore(client);
    const page = await store.retrieveRecords('scen-target');
    expect(capture.from).toBe('decision_records');
    // The ONLY thing preventing a cross-scenario/cross-user read under the
    // service-role client that bypasses RLS:
    expect(capture.eq).toEqual(['scenario_id', 'scen-target']);
    expect(capture.order).toEqual(['created_at', { ascending: false }]);
    expect(capture.limit).toBe(DECISION_RECORDS_HARD_CAP);
    // owner_user_id is never selected (not projected).
    expect(capture.select).not.toContain('owner_user_id');
    // The pre-cap total must be REQUESTED, or the caller cannot know what the
    // LIMIT hid from it (the 2026-07-25 silent-drop defect).
    expect(capture.selectOpts).toEqual({ count: 'exact' });
    expect(page.records).toHaveLength(1);
    expect(page.records[0].record_id).toBe(READ_ROW.record_id);
    expect(page.records[0].decision.chosen_option_label).toBe('Hire locally');
  });

  it('reports the PRE-CAP total from the exact count, not the number of rows returned', async () => {
    // What the live wire does with 9 stored and a LIMIT of 8: eight rows back,
    // `content-range: 0-7/9`.
    const eightRows = Array.from({ length: 8 }, (_, i) => ({ ...READ_ROW, record_id: `r${i}` }));
    const { client } = makeReadClient({ data: eightRows, count: 9 });
    const store = new SupabaseDecisionRecordStore(client);
    const page = await store.retrieveRecords('scen-target');
    expect(page.records).toHaveLength(8);
    expect(page.totalCount).toBe(9); // NOT 8 — the truth behind the LIMIT
  });

  it('a MISSING exact count degrades to the row count but WARNS (never a silent assume-good)', async () => {
    const warn = vi.spyOn(telemetry.log, 'warn').mockImplementation(() => undefined);
    const { client } = makeReadClient({ data: [READ_ROW], count: null });
    const store = new SupabaseDecisionRecordStore(client);
    const page = await store.retrieveRecords('scen-target');
    expect(page.totalCount).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0][0] as Record<string, unknown>).event).toBe(
      'v5.decision_records.exact_count_absent',
    );
    warn.mockRestore();
  });

  it('an exact count SMALLER than the rows returned is rejected as unusable (and warns)', async () => {
    const warn = vi.spyOn(telemetry.log, 'warn').mockImplementation(() => undefined);
    const { client } = makeReadClient({ data: [READ_ROW, { ...READ_ROW, record_id: 'r2' }], count: 1 });
    const store = new SupabaseDecisionRecordStore(client);
    const page = await store.retrieveRecords('scen-target');
    expect(page.totalCount).toBe(2); // never below what we actually hold
    expect((warn.mock.calls[0][0] as Record<string, unknown>).event).toBe(
      'v5.decision_records.exact_count_unusable',
    );
    warn.mockRestore();
  });

  it('an explicit limit is honoured but still hard-capped', async () => {
    const { client, capture } = makeReadClient({ data: [] });
    const store = new SupabaseDecisionRecordStore(client);
    await store.retrieveRecords('scen-x', { limit: 3 });
    expect(capture.limit).toBe(3);
    await store.retrieveRecords('scen-x', { limit: 9_999 });
    expect(capture.limit).toBe(DECISION_RECORDS_HARD_CAP); // never above the cap
  });

  it('DEFENCE-IN-DEPTH — drops any row whose scenario_id does not match the query filter', async () => {
    const { client } = makeReadClient({ data: [READ_ROW, { ...READ_ROW, record_id: 'x', scenario_id: 'OTHER-scenario' }] });
    const store = new SupabaseDecisionRecordStore(client);
    const page = await store.retrieveRecords('scen-target');
    expect(page.records).toHaveLength(1);
    expect(page.records.every((r) => r.scenario_id === 'scen-target')).toBe(true);
  });

  it('drops malformed rows (missing decision/prediction) without throwing', async () => {
    const { client } = makeReadClient({ data: [READ_ROW, { record_id: 'y', scenario_id: 'scen-target' }] });
    const store = new SupabaseDecisionRecordStore(client);
    const page = await store.retrieveRecords('scen-target');
    expect(page.records).toHaveLength(1);
  });

  it('a query error throws a typed store error (never silent empty)', async () => {
    const { client } = makeReadClient({ error: { message: 'relation blew up' } });
    const store = new SupabaseDecisionRecordStore(client);
    await expect(store.retrieveRecords('scen-target')).rejects.toBeInstanceOf(DecisionRecordStoreError);
  });
});
