/**
 * Slice B — D8 service-role grant validation.
 *
 * Closes the obligation declared in
 *   Docs/v5/slice-phase-0-supabase-audit.md §4.4
 * ("post-migration RPC-grant validation test added to Tranche 2 mandatory
 * deliverables") and carried forward in
 *   Docs/v5/slice-phase-0-evidence-pack.md §4 item 1
 * as the single Phase-0 runtime assumption still unconfirmed at Phase-0
 * completion.
 *
 * What this test proves:
 *
 *   The CEE service_role key has EXECUTE on append_turn_atomic(UUID, TEXT,
 *   TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB). Without this
 *   grant, every Slice B commit would fail with `permission denied` (SQL
 *   state 42501) regardless of how well the application code is wired.
 *
 * How it proves it:
 *
 *   Invoke the RPC with a deliberately-invalid scenario_id. We EXPECT an
 *   error; the question is which error. Grant present → the function body
 *   runs and raises "scenario not found" (P0001). Grant absent → PostgREST
 *   rejects the call before the body runs with "permission denied for
 *   function" (42501). The assertion is the inverse: the error code must
 *   NOT be 42501 or "permission denied".
 *
 * Runs only when staging Supabase env is set. Rotate the staging
 * service_role key AFTER this test has passed, per the plan's operational
 * follow-up.
 */

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const envReady = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
const suite = envReady ? describe : describe.skip;

suite('Slice B RPC grant validation (audit §4.4)', () => {
  it('service_role can EXECUTE append_turn_atomic (no permission-denied on invocation)', async () => {
    const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await client.rpc('append_turn_atomic', {
      p_scenario_id: '00000000-0000-0000-0000-000000000000',
      p_turn_id: `rpc-grant-${Date.now()}`,
      p_turn_class: 'direct_answer',
      p_handler_id: null,
      p_request_hash: 'sha256:rpc-grant-test',
      p_response_emitted: true,
      p_llm_calls_used: 0,
      p_duration_ms: 0,
      p_handler_facts: [],
    });

    // We expect an error — the scenario_id doesn't exist — but NOT a
    // permission-denied one. A permission-denied error would mean the
    // GRANT EXECUTE ... TO service_role migration step didn't apply.
    expect(error).not.toBeNull();
    const code = error?.code ?? '';
    const message = error?.message ?? '';

    expect(code).not.toBe('42501');
    expect(message.toLowerCase()).not.toMatch(/permission denied/);

    // Positive check: the function body actually ran. If it did, we see
    // the "scenario not found" application error (SQL state P0001).
    expect(`${code} ${message}`).toMatch(/scenario.*not found|P0001/i);
  });
});

if (!envReady) {
  describe('Slice B RPC grant validation (skipped — env not set)', () => {
    it.skip('missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY', () => undefined);
  });
}
