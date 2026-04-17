#!/usr/bin/env tsx
/**
 * Phase 0 — post-migration validation.
 *
 * Runs AFTER the operator applies
 * `supabase/migrations/20260417160000_v5_session_store.sql` via the Supabase
 * dashboard SQL editor (Path A). Proves positive existence of every Phase-0
 * artefact described in audit §4 against the real, post-apply staging DB.
 *
 * Checks (all use supabase-js; no pg driver):
 *   1. v5_conversation_turns — all 11 expected columns present.
 *   2. v5_handler_facts — all 10 expected columns present.
 *   3. append_turn_atomic RPC — callable with service_role, returns the
 *      expected "scenario not found" RAISE EXCEPTION when given a nonexistent
 *      scenario_id. Proves RPC exists AND service_role has EXECUTE AND the
 *      function body runs.
 *   4. Idempotency + CHECK constraints — run only when optional
 *      TEST_SCENARIO_ID is provided (skipped otherwise with clear note).
 *   5. RLS enabled — run only when optional SUPABASE_ANON_KEY is provided
 *      (anon client attempts a read; expect empty result or permission
 *      error, not 200-with-rows). Skipped otherwise.
 *
 * Out of scope for supabase-js:
 *   - Exact column TYPES (requires information_schema).
 *   - Index presence (requires pg_indexes).
 *   - Explicit pg_proc.proacl grant inspection.
 *   - Named constraint inspection (requires pg_constraint).
 *   Inference: if the migration applied without error and the Tier-1 checks
 *   pass, these artefacts are in place. Re-apply idempotently if in doubt.
 *
 * Usage
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm exec tsx scripts/phase-0-post-apply-validate.ts
 *
 *   # Optional Tier-2 probes:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   TEST_SCENARIO_ID=<uuid-of-throwaway-scenarios-row> \
 *   SUPABASE_ANON_KEY=... \
 *     pnpm exec tsx scripts/phase-0-post-apply-validate.ts
 *
 * Exit codes
 *   0  all required checks passed (Tier-2 checks skipped are reported but OK)
 *   2  required env vars missing
 *   3  at least one required check failed (detail printed)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TEST_SCENARIO_ID = process.env.TEST_SCENARIO_ID;

if (!URL || !SERVICE_KEY) {
  console.error('[post-apply-validate] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const V5_CONVERSATION_TURNS_COLUMNS = [
  'id',
  'scenario_id',
  'user_id',
  'turn_id',
  'turn_class',
  'handler_id',
  'request_hash',
  'response_emitted',
  'llm_calls_used',
  'duration_ms',
  'created_at',
] as const;

const V5_HANDLER_FACTS_COLUMNS = [
  'id',
  'v5_conversation_turn_id',
  'scenario_id',
  'user_id',
  'handler_id',
  'action_type',
  'fact_version',
  'noop',
  'payload',
  'created_at',
] as const;

type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';
type CheckResult = { name: string; status: CheckStatus; detail: string };

const results: CheckResult[] = [];

function record(name: string, status: CheckStatus, detail: string): void {
  results.push({ name, status, detail });
  const badge = status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : status === 'FAIL' ? '\x1b[31mFAIL\x1b[0m' : '\x1b[33mSKIP\x1b[0m';
  console.log(`${badge}  ${name}`);
  if (detail) {
    console.log(`       ${detail}`);
  }
}

async function checkColumns(
  client: SupabaseClient,
  table: string,
  expected: readonly string[],
): Promise<void> {
  const missing: string[] = [];
  for (const col of expected) {
    const { error } = await client.from(table).select(col).limit(0);
    if (error) {
      missing.push(`${col} (${error.message})`);
    }
  }
  if (missing.length === 0) {
    record(`${table} columns (${expected.length}/${expected.length})`, 'PASS', `all expected columns present: ${expected.join(', ')}`);
  } else {
    record(`${table} columns`, 'FAIL', `missing: ${missing.join('; ')}`);
  }
}

async function checkRpc(client: SupabaseClient): Promise<void> {
  const probeScenarioId = '00000000-0000-0000-0000-000000000000';
  const { data, error } = await client.rpc('append_turn_atomic', {
    p_scenario_id: probeScenarioId,
    p_turn_id: `post-apply-validator-${Date.now()}`,
    p_turn_class: 'direct_answer',
    p_handler_id: null,
    p_request_hash: 'sha256:post-apply-validator',
    p_response_emitted: true,
    p_llm_calls_used: 0,
    p_duration_ms: 0,
    p_handler_facts: [],
  });

  if (!error) {
    record('append_turn_atomic callable', 'FAIL', `expected "scenario not found" error, got success with data=${JSON.stringify(data)}. Did a scenario with id=${probeScenarioId} actually exist?`);
    return;
  }

  const msg = error.message ?? '';
  const code = (error as unknown as { code?: string }).code ?? '';

  if (/permission denied|42501/i.test(msg + code)) {
    record('append_turn_atomic callable (service_role grant)', 'FAIL', `permission-denied error — explicit GRANT EXECUTE ... TO service_role is missing or role mismatch. Error: code=${code}, msg="${msg}"`);
    return;
  }

  if (/scenario.*not found/i.test(msg) || /P0001/i.test(code)) {
    record('append_turn_atomic callable (service_role grant)', 'PASS', `RPC exists, service_role has EXECUTE, function body ran. Raised expected "scenario not found" for probe UUID.`);
    return;
  }

  if (/function.*does not exist|42883/i.test(msg + code)) {
    record('append_turn_atomic callable', 'FAIL', `RPC not found — migration not applied? Error: code=${code}, msg="${msg}"`);
    return;
  }

  record('append_turn_atomic callable', 'FAIL', `unexpected error shape. code=${code}, msg="${msg}". Investigate before Tranche 2.`);
}

async function checkConstraintsWithScenario(client: SupabaseClient, scenarioId: string): Promise<void> {
  // Attempt a biconditional violation: turn_class='direct_answer' with handler_id set.
  const { error: bicondErr } = await client.rpc('append_turn_atomic', {
    p_scenario_id: scenarioId,
    p_turn_id: `validator-biconditional-violation-${Date.now()}`,
    p_turn_class: 'direct_answer',
    p_handler_id: 'run_analysis', // biconditional violation
    p_request_hash: 'sha256:validator',
    p_response_emitted: true,
    p_llm_calls_used: 0,
    p_duration_ms: 0,
    p_handler_facts: [],
  });
  if (bicondErr && /biconditional|check constraint|23514/i.test((bicondErr.message ?? '') + ((bicondErr as unknown as { code?: string }).code ?? ''))) {
    record('handler_id biconditional CHECK', 'PASS', `CHECK violation raised as expected. Error: ${bicondErr.message}`);
  } else if (bicondErr) {
    record('handler_id biconditional CHECK', 'FAIL', `wrong error shape (expected CHECK violation). code=${(bicondErr as unknown as { code?: string }).code}, msg="${bicondErr.message}"`);
  } else {
    record('handler_id biconditional CHECK', 'FAIL', `biconditional violation was accepted. Constraint missing or wrong.`);
  }

  // Attempt invalid turn_class.
  const { error: classErr } = await client.rpc('append_turn_atomic', {
    p_scenario_id: scenarioId,
    p_turn_id: `validator-turn-class-violation-${Date.now()}`,
    p_turn_class: 'not_a_real_turn_class',
    p_handler_id: null,
    p_request_hash: 'sha256:validator',
    p_response_emitted: true,
    p_llm_calls_used: 0,
    p_duration_ms: 0,
    p_handler_facts: [],
  });
  if (classErr && /turn_class_valid|check constraint|23514/i.test((classErr.message ?? '') + ((classErr as unknown as { code?: string }).code ?? ''))) {
    record('turn_class CHECK', 'PASS', `CHECK violation raised as expected. Error: ${classErr.message}`);
  } else if (classErr) {
    record('turn_class CHECK', 'FAIL', `wrong error shape. code=${(classErr as unknown as { code?: string }).code}, msg="${classErr.message}"`);
  } else {
    record('turn_class CHECK', 'FAIL', `invalid turn_class was accepted. Constraint missing.`);
  }
}

async function checkRls(anonClient: SupabaseClient): Promise<void> {
  // Anon client, RLS should filter to zero rows (since auth.uid() is null).
  const { data, error } = await anonClient.from('v5_conversation_turns').select('id').limit(1);
  if (error) {
    // Many RLS configurations surface as an error rather than empty result; both are acceptable.
    record('RLS on v5_conversation_turns (anon read)', 'PASS', `anon read rejected or restricted: ${error.message}`);
    return;
  }
  if ((data ?? []).length === 0) {
    record('RLS on v5_conversation_turns (anon read)', 'PASS', `anon read returned 0 rows — RLS active (auth.uid() is null for unauthenticated requests)`);
    return;
  }
  record('RLS on v5_conversation_turns (anon read)', 'FAIL', `anon read returned ${data?.length} rows — RLS may be disabled`);
}

(async () => {
  console.log('# Phase 0 post-apply validation');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('');

  const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

  console.log('## Tier 1 (required)');
  await checkColumns(service, 'v5_conversation_turns', V5_CONVERSATION_TURNS_COLUMNS);
  await checkColumns(service, 'v5_handler_facts', V5_HANDLER_FACTS_COLUMNS);
  await checkRpc(service);

  console.log('');
  console.log('## Tier 2 (optional)');
  if (TEST_SCENARIO_ID) {
    await checkConstraintsWithScenario(service, TEST_SCENARIO_ID);
  } else {
    record('CHECK constraints via TEST_SCENARIO_ID', 'SKIP', `set TEST_SCENARIO_ID=<uuid> to probe biconditional + turn_class CHECK constraints via the RPC`);
  }
  if (ANON_KEY) {
    const anon = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
    await checkRls(anon);
  } else {
    record('RLS active on v5_conversation_turns', 'SKIP', `set SUPABASE_ANON_KEY to attempt an anon read (expect 0 rows or permission rejection)`);
  }

  console.log('');
  console.log('## Summary');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log(`- passed:  ${passed}`);
  console.log(`- failed:  ${failed}`);
  console.log(`- skipped: ${skipped}`);

  if (failed > 0) {
    console.error('');
    console.error('[post-apply-validate] at least one required check failed. Do NOT proceed to Tranche 2.');
    process.exit(3);
  }

  if (skipped > 0) {
    console.log('');
    console.log('Note: Tier-2 checks were skipped (optional env vars not provided). Tier-1 is the gate for Phase 0 sign-off.');
  }
})();
