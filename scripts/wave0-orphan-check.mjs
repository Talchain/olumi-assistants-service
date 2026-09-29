/**
 * Wave 0 final orphan sweep — confirms the integration test cleanup
 * left zero rows behind. Read-only.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
const ENV_PATH = process.env.STAGING_ENV_FILE ?? '.env.staging.local';
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 1. Scenarios with the wave0 marker prefix.
const { count: scenariosByMarker } = await client
  .from('scenarios')
  .select('*', { count: 'exact', head: true })
  .like('brief_text', 'WAVE0 PENDING ACTIONS RPC TEST%');
console.log('scenarios marked WAVE0…  :', scenariosByMarker);

// 2. Turns whose turn_id starts with the wave0 prefix.
const { count: turnsByPrefix } = await client
  .from('v5_conversation_turns')
  .select('*', { count: 'exact', head: true })
  .like('turn_id', 'wave0-pending-actions-%');
console.log('turns wave0-pending-actions-%:', turnsByPrefix);

// 3. Sanity: total scenarios count (should be unchanged from the
//    pre-test 149).
const { count: scenariosTotal } = await client
  .from('scenarios')
  .select('*', { count: 'exact', head: true });
console.log('total scenarios (was 149) :', scenariosTotal);
