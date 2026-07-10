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

import {
  DecisionRecordSignInRequiredError,
  DecisionRecordStoreError,
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
