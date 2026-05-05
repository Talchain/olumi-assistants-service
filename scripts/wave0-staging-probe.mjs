#!/usr/bin/env node
/**
 * Wave 0 staging probe — read-only.
 *
 * What it does:
 *   1. Loads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from
 *      .env.staging.local.
 *   2. Confirms staging is reachable (HEAD on the REST root).
 *   3. Probes append_turn_atomic arity by attempting a 12-arg call
 *      with a deliberately invalid scenario id. The error PostgREST
 *      returns tells us whether the function exists with that arity.
 *   4. Probes the column existence by selecting `pending_actions`
 *      from `v5_conversation_turns LIMIT 0` (column-not-found vs
 *      column-found is the signal; no rows are read).
 *
 * What it does NOT do:
 *   - Insert, update, or delete any row.
 *   - Apply any DDL.
 *   - Read any user data.
 *
 * Exit code 0 means probes ran (regardless of which branch — see
 * stdout for the verdicts). Exit code 1 means an unexpected error
 * (network, auth, etc.).
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(path) {
  const raw = readFileSync(path, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv('/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local');
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('FATAL: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

console.log(`URL: ${url}`);
console.log(`project ref (from URL): ${new URL(url).hostname.split('.')[0]}`);
console.log('---');

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 1. Reachability — list one row of public.scenarios with `head: true` so
//    no rows transfer. A 200/206 with `count` confirms PostgREST is up
//    and service-role auth works.
{
  const { error, count } = await client
    .from('scenarios')
    .select('*', { count: 'exact', head: true });
  if (error) {
    console.log('PROBE-1 reachability: FAIL');
    console.log('  error:', JSON.stringify(error));
    process.exit(1);
  }
  console.log(`PROBE-1 reachability: OK (scenarios row count = ${count})`);
}

// 2. Probe `pending_actions` column existence on v5_conversation_turns.
//    SELECT pending_actions LIMIT 0. If column missing, PostgREST
//    returns code 42703 (undefined column) or PGRST204.
{
  const { error } = await client
    .from('v5_conversation_turns')
    .select('pending_actions')
    .limit(0);
  if (error) {
    console.log('PROBE-2 pending_actions column: ABSENT');
    console.log('  code :', error.code);
    console.log('  msg  :', error.message);
  } else {
    console.log('PROBE-2 pending_actions column: PRESENT');
  }
}

// 3. Probe append_turn_atomic arity. We call with a deliberately
//    invalid (non-UUID) scenario id and a 12th `p_pending_actions`
//    arg. Expected outcomes:
//      - function-not-found / wrong-arity → 12-arg version not yet applied.
//      - other error (e.g. `scenario … not found`, invalid uuid) → 12-arg
//        version is live; the call reached the body and failed there.
//    Either branch is informative; neither writes data.
{
  const sentinel = '00000000-0000-4000-8000-000000000000';
  const { error } = await client.rpc('append_turn_atomic', {
    p_scenario_id: sentinel,
    p_turn_id: 'wave0-probe-DOES-NOT-APPLY',
    p_turn_class: 'direct_answer',
    p_handler_id: null,
    p_request_hash: 'sha256:probe',
    p_response_emitted: false,
    p_llm_calls_used: 0,
    p_duration_ms: 0,
    p_handler_facts: [],
    p_graph: null,
    p_brief_text: null,
    p_pending_actions: [],
  });
  if (!error) {
    // Should never happen — sentinel scenario id should not exist.
    console.log('PROBE-3 RPC arity: UNEXPECTED SUCCESS (probe wrote a row?)');
    console.log('  STOP: investigate immediately.');
    process.exit(1);
  }
  const msg = error.message || '';
  const code = error.code || '';
  // PostgREST codes:
  //   PGRST202: function not found / wrong signature
  //   PGRST204: column not found
  //   42883:    function does not exist (postgres native)
  // Body-side errors (function exists, body raised):
  //   P0001 with text 'scenario … not found' → 12-arg version live.
  if (code === 'PGRST202' || code === '42883' || /not.*function/i.test(msg)) {
    console.log('PROBE-3 RPC arity: 12-arg NOT live');
    console.log('  → migration has not been applied yet.');
    console.log('  code :', code);
    console.log('  msg  :', msg);
  } else if (/scenario .* not found/i.test(msg) || code === 'P0001') {
    console.log('PROBE-3 RPC arity: 12-arg IS live');
    console.log('  → migration appears to be applied.');
    console.log('  msg  :', msg);
  } else {
    console.log('PROBE-3 RPC arity: AMBIGUOUS');
    console.log('  code :', code);
    console.log('  msg  :', msg);
    console.log('  details:', JSON.stringify(error));
  }
}

console.log('---');
console.log('Probe complete. No rows were written.');
