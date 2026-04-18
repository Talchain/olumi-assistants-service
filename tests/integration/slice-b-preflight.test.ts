/**
 * Slice B — D6 preflight.
 *
 * Runs FIRST among the Slice B integration tests. Verifies that the
 * staging Supabase migration is applied and the env is wired before the
 * heavier behavioural tests execute. Without this preflight, a 3am
 * reviewer who sees persistence tests failing can't distinguish
 * "migration not applied" from "my code is wrong."
 *
 * Closes pressure-test §5 recommendation.
 */

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_SCENARIO_ID = process.env.TEST_SCENARIO_ID;

const envReady = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && TEST_SCENARIO_ID);

const suite = envReady ? describe : describe.skip;

suite('Slice B preflight — staging Supabase state', () => {
  const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  it('v5_conversation_turns is reachable via PostgREST (migration applied)', async () => {
    const { error } = await client.from('v5_conversation_turns').select('id').limit(0);
    expect(error).toBeNull();
  });

  it('v5_handler_facts is reachable via PostgREST (migration applied)', async () => {
    const { error } = await client.from('v5_handler_facts').select('id').limit(0);
    expect(error).toBeNull();
  });

  it('append_turn_atomic RPC exists and service_role has EXECUTE', async () => {
    // Probe with a deliberately-invalid scenario_id so the RPC raises its
    // application error ("scenario not found") rather than permission-denied
    // or function-not-found.
    const { error } = await client.rpc('append_turn_atomic', {
      p_scenario_id: '00000000-0000-0000-0000-000000000000',
      p_turn_id: `preflight-${Date.now()}`,
      p_turn_class: 'direct_answer',
      p_handler_id: null,
      p_request_hash: 'sha256:preflight',
      p_response_emitted: true,
      p_llm_calls_used: 0,
      p_duration_ms: 0,
      p_handler_facts: [],
    });
    expect(error).not.toBeNull();
    const combined = `${error?.code ?? ''} ${error?.message ?? ''}`;
    expect(combined).not.toMatch(/permission denied|42501/i);
    expect(combined).not.toMatch(/function.*does not exist|42883/i);
    expect(combined).toMatch(/scenario.*not found|P0001/i);
  });

  it('TEST_SCENARIO_ID exists in public.scenarios', async () => {
    const { data, error } = await client
      .from('scenarios')
      .select('id')
      .eq('id', TEST_SCENARIO_ID!)
      .limit(1);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

// If env is missing, emit a human-readable note so developers know why this
// suite didn't run. Vitest's `.skip` is quiet by default.
if (!envReady) {
  describe('Slice B preflight (skipped — env not set)', () => {
    it.skip('missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_SCENARIO_ID', () => {
      // placeholder
    });
  });
}
