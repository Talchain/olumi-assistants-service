/**
 * Context Architecture v2 — S4 rolling summary — store adapter contract.
 *
 * Proves the adapter (a) drives the MONOTONIC write RPC with the watermark as
 * an explicit argument (so the SQL WHERE guard has its ordering key), (b)
 * parses the applied/regressed outcome, (c) surfaces RPC errors as a typed
 * store error (never silent), and (d) tolerates an unparseable stored summary
 * on read (→ null, never a throw).
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  SupabaseRollingSummaryStore,
  RollingSummaryStoreError,
} from '../store-adapter.js';
import { SUMMARY_SCHEMA_VERSION } from '../summary-types.js';
import type { RollingSummary } from '../summary-types.js';

function summary(): RollingSummary {
  return {
    text: 'DECISION FRAME: x',
    slots: [{ slot: 'FRAME', entries: [{ text: 'x', source_turn_ids: [] }] }],
    updated_turn_id: 'turn-7',
    updated_turn_created_at: '2026-07-12T10:00:00.000Z',
    version: 3,
    generator: 'regen',
    schema_version: SUMMARY_SCHEMA_VERSION,
  };
}

function clientWith(rpc: (name: string, args: unknown) => { data: unknown; error: unknown }) {
  const spy = vi.fn(async (name: string, args: unknown) => rpc(name, args));
  return { client: { rpc: spy } as unknown as SupabaseClient, spy };
}

describe('SupabaseRollingSummaryStore.upsertSummary', () => {
  it('drives upsert_rolling_summary with the WATERMARK as an explicit argument', async () => {
    const { client, spy } = clientWith(() => ({
      data: { applied: true, regressed: false, current_watermark: '2026-07-12T10:00:00.000Z' },
      error: null,
    }));
    const outcome = await new SupabaseRollingSummaryStore(client).upsertSummary('sc-1', summary());
    expect(spy).toHaveBeenCalledWith('upsert_rolling_summary', {
      p_scenario_id: 'sc-1',
      p_summary: summary(),
      p_updated_turn_created_at: '2026-07-12T10:00:00.000Z', // the monotonic guard key
    });
    expect(outcome).toEqual({
      applied: true,
      regressed: false,
      current_watermark: '2026-07-12T10:00:00.000Z',
    });
  });

  it('reports a monotonic no-op (applied:false / regressed:true)', async () => {
    const { client } = clientWith(() => ({
      data: { applied: false, regressed: true, current_watermark: '2026-07-12T11:00:00.000Z' },
      error: null,
    }));
    const outcome = await new SupabaseRollingSummaryStore(client).upsertSummary('sc-1', summary());
    expect(outcome.applied).toBe(false);
    expect(outcome.regressed).toBe(true);
  });

  it('surfaces an RPC error as a typed RollingSummaryStoreError', async () => {
    const { client } = clientWith(() => ({
      data: null,
      error: { message: 'function not found', code: 'PGRST202' },
    }));
    await expect(
      new SupabaseRollingSummaryStore(client).upsertSummary('sc-1', summary()),
    ).rejects.toBeInstanceOf(RollingSummaryStoreError);
  });
});

describe('SupabaseRollingSummaryStore.loadSummary', () => {
  it('parses a valid stored summary', async () => {
    const { client, spy } = clientWith(() => ({ data: summary(), error: null }));
    const loaded = await new SupabaseRollingSummaryStore(client).loadSummary('sc-1');
    expect(spy).toHaveBeenCalledWith('get_rolling_summary', { p_scenario_id: 'sc-1' });
    expect(loaded?.updated_turn_id).toBe('turn-7');
  });

  it('returns null for an absent summary', async () => {
    const { client } = clientWith(() => ({ data: null, error: null }));
    expect(await new SupabaseRollingSummaryStore(client).loadSummary('sc-1')).toBeNull();
  });

  it('returns null (never throws) for an unparseable stored summary', async () => {
    const { client } = clientWith(() => ({ data: { garbage: true }, error: null }));
    expect(await new SupabaseRollingSummaryStore(client).loadSummary('sc-1')).toBeNull();
  });

  it('surfaces a read RPC error as a typed store error', async () => {
    const { client } = clientWith(() => ({ data: null, error: { message: 'boom' } }));
    await expect(
      new SupabaseRollingSummaryStore(client).loadSummary('sc-1'),
    ).rejects.toBeInstanceOf(RollingSummaryStoreError);
  });
});
