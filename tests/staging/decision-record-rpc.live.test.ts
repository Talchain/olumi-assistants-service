/**
 * Staging live poke: create_decision_record RPC (ROADMAP 3.1, CEE half).
 *
 * Proves, against the REAL staging Supabase, that the store adapter's
 * `create_decision_record` call round-trips the #406 RPC contract:
 * ok create → same-payload replay dedupes (deterministic p_record_id) →
 * DR001 guest refusal maps to the typed error. Cleans up the row it wrote.
 *
 * SKIPPED until migration 20260710113000_v5_decision_records.sql is
 * EXECUTED (merged in #406 but execution is Paul-gated; the RPC does not
 * exist on staging until then — see the migration header and ROADMAP 3.1).
 *
 * Gating once enabled (matches the other staging smokes):
 *   - RUN_STAGING_SMOKE=1                    (explicit opt-in)
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  (staging service role)
 *   - DR_LIVE_OWNED_SCENARIO_ID              (an EXISTING scenario row with a
 *                                             non-null user_id — DR001 refuses
 *                                             guests by design)
 *   - DR_LIVE_GUEST_SCENARIO_ID (optional)   (an existing user_id-NULL row to
 *                                             exercise the DR001 mapping)
 *
 * Run with: pnpm test:staging
 */

import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import {
  DecisionRecordSignInRequiredError,
  SupabaseDecisionRecordStore,
  type CreateDecisionRecordWrite,
} from '../../src/orchestrator-v5/decision-records/store-adapter.js';
import { deriveDecisionRecordId } from '../../src/orchestrator-v5/decision-records/capture.js';

const RUN_STAGING_SMOKE = process.env.RUN_STAGING_SMOKE === '1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNED_SCENARIO_ID = process.env.DR_LIVE_OWNED_SCENARIO_ID;
const GUEST_SCENARIO_ID = process.env.DR_LIVE_GUEST_SCENARIO_ID;

const SKIP_REASON = !RUN_STAGING_SMOKE
  ? 'Skipping staging smoke: RUN_STAGING_SMOKE not set'
  : !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY
    ? 'Skipping staging smoke: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured'
    : !OWNED_SCENARIO_ID
      ? 'Skipping staging smoke: DR_LIVE_OWNED_SCENARIO_ID not configured'
      : null;

// Skipped until the Paul-gated execution of migration
// 20260710113000_v5_decision_records.sql (the RPC does not exist before it).
// TODO: ISSUE-9028 — un-skip after the migration is executed on staging.
describe.skip('staging live poke — create_decision_record RPC (post-execution)', () => {
  const client =
    SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  const createdRecordIds: string[] = [];

  afterAll(async () => {
    // Cleanup: remove the poke's own rows (service_role has table grants).
    if (client && createdRecordIds.length > 0) {
      await client.from('decision_records').delete().in('record_id', createdRecordIds);
    }
  });

  function makeWrite(scenarioId: string): CreateDecisionRecordWrite {
    // Distinct per run via computed_at so the poke never collides with a
    // previous run's rows; deterministic WITHIN the run so the replay leg
    // exercises the RPC's dedupe branch.
    const computedAt = new Date().toISOString();
    const graphHash = 'aag_v1:sha256:0000000000000000';
    const recordId = deriveDecisionRecordId(scenarioId, graphHash, computedAt);
    return {
      scenario_id: scenarioId,
      decision: {
        chosen_option_id: 'opt_live_poke',
        chosen_option_label: 'Live poke option',
        graph_hash: graphHash,
      },
      prediction: { statement: 'Live poke prediction (test row, cleaned up).', confidence: 0.5 },
      review_date: new Date(Date.parse(computedAt) + 90 * 86400000).toISOString(),
      record_id: recordId,
      event_id: `decision_recorded_${recordId}`,
    };
  }

  it.skipIf(SKIP_REASON !== null)(
    'creates a record on an owned scenario, then dedupes the identical replay',
    async () => {
      const store = new SupabaseDecisionRecordStore(client!);
      const write = makeWrite(OWNED_SCENARIO_ID!);
      const first = await store.createRecord(write);
      createdRecordIds.push(first.record_id);
      expect(first.record_id).toBe(write.record_id);
      expect(first.deduped).toBe(false);
      expect(first.event_id).toBe(write.event_id);

      const replay = await store.createRecord(write);
      expect(replay.record_id).toBe(write.record_id);
      expect(replay.deduped).toBe(true);
      expect(replay.event_id).toBeNull();
    },
  );

  it.skipIf(SKIP_REASON !== null || !GUEST_SCENARIO_ID)(
    'refuses a guest (unowned) scenario with the typed DR001 error',
    async () => {
      const store = new SupabaseDecisionRecordStore(client!);
      await expect(store.createRecord(makeWrite(GUEST_SCENARIO_ID!))).rejects.toBeInstanceOf(
        DecisionRecordSignInRequiredError,
      );
    },
  );
});
