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
  // v5-maintenance: createClient call guarded by envReady. Previously
  // the call executed during describe-body evaluation even when the
  // suite was skipped, which threw 'supabaseUrl is required' and failed
  // the file before vitest's skip semantics could take effect.
  const client = envReady
    ? createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : (null as unknown as ReturnType<typeof createClient>);

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

// When env is missing, vitest's `describe.skip` path above handles it —
// the suite reports as skipped in the runner output. No redundant block.
