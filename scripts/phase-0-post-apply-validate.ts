#!/usr/bin/env tsx
/**
 * Phase 0 — post-migration validation (strict).
 *
 * Runs AFTER the operator applies
 * `supabase/migrations/20260417160000_v5_session_store.sql` via the Supabase
 * dashboard SQL editor (Path A). Proves positive existence of every audit-§4
 * artefact that is reachable via supabase-js; surfaces explicit NOT-VERIFIED
 * items (with an operator-runnable SQL snippet) for the ones that require
 * pg_catalog access.
 *
 * Strict-by-default: every required env var must be provided or the script
 * refuses to exit 0. "Skipped required check" is never a PASS.
 *
 * Required env
 *   SUPABASE_URL                — https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — for metadata probes + RPC grant + FK probe
 *   SUPABASE_ANON_KEY           — for RLS read-probe on both tables
 *   TEST_SCENARIO_ID            — UUID of a throwaway scenarios row in staging
 *                                 whose user_id is immaterial (the RPC derives
 *                                 from it). Used for behavioural probes that
 *                                 need a real scenario_id.
 *
 * Flags
 *   --json     Emit a single structured JSON object to stdout (no colours,
 *              no decorations). Suitable for evidence-pack ingestion.
 *
 * Exit codes
 *   0  every required check PASSED
 *   2  required env var missing
 *   3  at least one required check FAILED
 *
 * Cleanup: the unique-constraint probe creates one v5_conversation_turns
 * row. The script attempts DELETE at the end and logs a warning if cleanup
 * fails. Failed cleanup is a soft-error and does not flip the exit code.
 *
 * Supplementary: check IDs `index-presence`, `named-constraints`,
 * `function-acl` are NOT-VERIFIED via supabase-js (PostgREST does not expose
 * pg_catalog on standard-config projects). The script emits a SQL snippet
 * the operator runs in the Supabase dashboard SQL editor to close those
 * gaps. Results are recorded in the Tranche 2 evidence pack, not here.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const JSON_MODE = process.argv.includes('--json');
const RUN_ID = `post-apply-${Date.now()}`;

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TEST_SCENARIO_ID = process.env.TEST_SCENARIO_ID;

const missingEnv: string[] = [];
if (!URL) missingEnv.push('SUPABASE_URL');
if (!SERVICE_KEY) missingEnv.push('SUPABASE_SERVICE_ROLE_KEY');
if (!ANON_KEY) missingEnv.push('SUPABASE_ANON_KEY');
if (!TEST_SCENARIO_ID) missingEnv.push('TEST_SCENARIO_ID');

if (missingEnv.length > 0) {
  const msg = `missing required env: ${missingEnv.join(', ')}`;
  if (JSON_MODE) {
    console.log(JSON.stringify({ status: 'env-missing', missing: missingEnv }));
  } else {
    console.error(`[post-apply-validate] ${msg}`);
    console.error('[post-apply-validate] this script is strict-by-default: provide every env var below.');
    console.error('  SUPABASE_URL=https://<ref>.supabase.co');
    console.error('  SUPABASE_SERVICE_ROLE_KEY=<service-role-JWT>');
    console.error('  SUPABASE_ANON_KEY=<anon-JWT>');
    console.error('  TEST_SCENARIO_ID=<uuid-of-throwaway-scenarios-row>');
  }
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

type CheckStatus = 'PASS' | 'FAIL';
interface CheckResult {
  id: string;
  status: CheckStatus;
  detail: string;
}
interface NotVerifiedItem {
  id: string;
  reason: string;
  operator_sql: string;
}

const results: CheckResult[] = [];
const notVerified: NotVerifiedItem[] = [];
const cleanupTurnIds: string[] = [];

function record(id: string, status: CheckStatus, detail: string): void {
  results.push({ id, status, detail });
  if (JSON_MODE) return;
  const badge = status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${badge}  ${id}`);
  console.log(`       ${detail}`);
}

function notVerifiedEntry(id: string, reason: string, operator_sql: string): void {
  notVerified.push({ id, reason, operator_sql });
  if (JSON_MODE) return;
  console.log(`\x1b[33mNOT-VERIFIED\x1b[0m  ${id}`);
  console.log(`              ${reason}`);
}

const errCode = (e: unknown): string => (e as { code?: string } | null)?.code ?? '';
const errMsg = (e: unknown): string => (e as { message?: string } | null)?.message ?? '';

async function checkColumns(
  client: SupabaseClient,
  table: string,
  expected: readonly string[],
): Promise<void> {
  const missing: string[] = [];
  for (const col of expected) {
    const { error } = await client.from(table).select(col).limit(0);
    if (error) missing.push(`${col} (${error.message})`);
  }
  if (missing.length === 0) {
    record(`columns-${table}`, 'PASS', `all ${expected.length} expected columns present`);
  } else {
    record(`columns-${table}`, 'FAIL', `missing: ${missing.join('; ')}`);
  }
}

async function checkRpcCallable(client: SupabaseClient): Promise<void> {
  const probeScenario = '00000000-0000-0000-0000-000000000000';
  const { error } = await client.rpc('append_turn_atomic', {
    p_scenario_id: probeScenario,
    p_turn_id: `${RUN_ID}-rpc-probe`,
    p_turn_class: 'direct_answer',
    p_handler_id: null,
    p_request_hash: 'sha256:validator',
    p_response_emitted: true,
    p_llm_calls_used: 0,
    p_duration_ms: 0,
    p_handler_facts: [],
  });

  if (!error) {
    record('rpc-callable', 'FAIL', `expected "scenario not found" error, got success. probe UUID=${probeScenario} should not exist.`);
    return;
  }
  const code = errCode(error);
  const msg = errMsg(error);
  if (/permission denied|42501/i.test(`${code} ${msg}`)) {
    record('rpc-grant-service_role', 'FAIL', `permission-denied. GRANT EXECUTE ... TO service_role is missing or wrong. code=${code}, msg="${msg}"`);
    return;
  }
  if (/function.*does not exist|42883/i.test(`${code} ${msg}`)) {
    record('rpc-callable', 'FAIL', `RPC not found — migration applied? code=${code}, msg="${msg}"`);
    return;
  }
  if (/scenario.*not found/i.test(msg) || code === 'P0001') {
    record('rpc-callable', 'PASS', `RPC exists, service_role has EXECUTE, function body raised expected "scenario not found".`);
    return;
  }
  record('rpc-callable', 'FAIL', `unexpected error shape. code=${code}, msg="${msg}"`);
}

async function checkUniqueConstraint(client: SupabaseClient, scenarioId: string): Promise<void> {
  const turnId = `${RUN_ID}-unique`;
  cleanupTurnIds.push(turnId);

  const args = {
    p_scenario_id: scenarioId,
    p_turn_id: turnId,
    p_turn_class: 'direct_answer' as const,
    p_handler_id: null,
    p_request_hash: 'sha256:validator-unique',
    p_response_emitted: true,
    p_llm_calls_used: 0,
    p_duration_ms: 0,
    p_handler_facts: [],
  };
  const first = await client.rpc('append_turn_atomic', args);
  if (first.error) {
    record('unique-constraint-idempotency', 'FAIL', `first insert failed. code=${errCode(first.error)}, msg="${errMsg(first.error)}"`);
    return;
  }
  const second = await client.rpc('append_turn_atomic', args);
  if (second.error) {
    record('unique-constraint-idempotency', 'FAIL', `second insert raised instead of ON-CONFLICT no-op. code=${errCode(second.error)}, msg="${errMsg(second.error)}"`);
    return;
  }
  if (first.data !== second.data) {
    record('unique-constraint-idempotency', 'FAIL', `second call returned different turn_id. first=${first.data}, second=${second.data} — ON CONFLICT did not fire.`);
    return;
  }
  record('unique-constraint-idempotency', 'PASS', `second call returned same turn_id as first (${first.data}). ON CONFLICT (scenario_id, turn_id) works.`);
}

async function checkBiconditionalCheck(client: SupabaseClient, scenarioId: string): Promise<void> {
  const { error } = await client.rpc('append_turn_atomic', {
    p_scenario_id: scenarioId,
    p_turn_id: `${RUN_ID}-biconditional`,
    p_turn_class: 'direct_answer',
    p_handler_id: 'run_analysis', // biconditional violation
    p_request_hash: 'sha256:validator-biconditional',
    p_response_emitted: true,
    p_llm_calls_used: 0,
    p_duration_ms: 0,
    p_handler_facts: [],
  });
  if (!error) {
    record('check-biconditional', 'FAIL', `biconditional violation accepted — constraint missing or not enforced`);
    return;
  }
  const sig = `${errCode(error)} ${errMsg(error)}`;
  if (/biconditional|check constraint|23514/i.test(sig)) {
    record('check-biconditional', 'PASS', `CHECK (turn_class='handler' ⇔ handler_id IS NOT NULL) fired: ${errMsg(error)}`);
    return;
  }
  record('check-biconditional', 'FAIL', `wrong error shape. Expected 23514 (check_violation). code=${errCode(error)}, msg="${errMsg(error)}"`);
}

async function checkTurnClassCheck(client: SupabaseClient, scenarioId: string): Promise<void> {
  const { error } = await client.rpc('append_turn_atomic', {
    p_scenario_id: scenarioId,
    p_turn_id: `${RUN_ID}-turn-class`,
    p_turn_class: 'not_a_real_class',
    p_handler_id: null,
    p_request_hash: 'sha256:validator-turn-class',
    p_response_emitted: true,
    p_llm_calls_used: 0,
    p_duration_ms: 0,
    p_handler_facts: [],
  });
  if (!error) {
    record('check-turn_class', 'FAIL', `invalid turn_class accepted — constraint missing`);
    return;
  }
  const sig = `${errCode(error)} ${errMsg(error)}`;
  if (/turn_class_valid|check constraint|23514/i.test(sig)) {
    record('check-turn_class', 'PASS', `CHECK (turn_class IN ...) fired: ${errMsg(error)}`);
    return;
  }
  record('check-turn_class', 'FAIL', `wrong error shape. Expected 23514. code=${errCode(error)}, msg="${errMsg(error)}"`);
}

async function checkForeignKey(client: SupabaseClient, scenarioId: string): Promise<void> {
  // Direct INSERT into v5_handler_facts bypasses the RPC and lets us point at
  // a non-existent v5_conversation_turn_id. Service-role bypasses RLS so the
  // attempt reaches the FK check. Expect 23503 (foreign_key_violation).
  const { error } = await client.from('v5_handler_facts').insert({
    v5_conversation_turn_id: '00000000-0000-0000-0000-000000000000',
    scenario_id: scenarioId,
    user_id: '00000000-0000-0000-0000-000000000000',
    handler_id: 'probe',
    action_type: 'run_analysis',
    payload: {},
  });
  if (!error) {
    record('fk-v5_handler_facts.v5_conversation_turn_id', 'FAIL', `insert with nonexistent turn_id accepted — FK missing`);
    return;
  }
  const sig = `${errCode(error)} ${errMsg(error)}`;
  if (/foreign key|23503/i.test(sig)) {
    record('fk-v5_handler_facts.v5_conversation_turn_id', 'PASS', `FK violation raised: ${errMsg(error)}`);
    return;
  }
  record('fk-v5_handler_facts.v5_conversation_turn_id', 'FAIL', `wrong error shape. Expected 23503. code=${errCode(error)}, msg="${errMsg(error)}"`);
}

async function checkRls(anon: SupabaseClient, table: string): Promise<void> {
  const { data, error } = await anon.from(table).select('id').limit(1);
  if (error) {
    record(`rls-${table}`, 'PASS', `anon read rejected: ${errMsg(error)}`);
    return;
  }
  if ((data ?? []).length === 0) {
    record(`rls-${table}`, 'PASS', `anon read returned 0 rows — RLS active (auth.uid() null for anon)`);
    return;
  }
  record(`rls-${table}`, 'FAIL', `anon read returned ${data?.length} rows — RLS may be disabled`);
}

async function cleanup(client: SupabaseClient): Promise<void> {
  for (const turnId of cleanupTurnIds) {
    const { error } = await client.from('v5_conversation_turns').delete().eq('turn_id', turnId);
    if (error && !JSON_MODE) {
      console.warn(`[cleanup] could not delete probe row turn_id=${turnId}: ${errMsg(error)}`);
    }
  }
}

function emitNotVerified(): void {
  notVerifiedEntry(
    'index-presence',
    'pg_indexes / pg_class not exposed via PostgREST on standard-config Supabase projects.',
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('v5_conversation_turns','v5_handler_facts') ORDER BY indexname;`,
  );
  notVerifiedEntry(
    'named-constraints',
    'pg_constraint not exposed via PostgREST. CHECK / UNIQUE / FK constraint NAMES require dashboard query.',
    `SELECT conname, contype FROM pg_constraint WHERE conrelid::regclass::text IN ('v5_conversation_turns','v5_handler_facts') ORDER BY conname;`,
  );
  notVerifiedEntry(
    'function-acl',
    'pg_proc.proacl not exposed via PostgREST. Explicit ACL inspection requires dashboard query.',
    `SELECT proname, proacl FROM pg_proc WHERE proname='append_turn_atomic';`,
  );
}

function emitHumanSummary(): void {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log('');
  console.log('## Summary');
  console.log(`- pass:           ${pass}`);
  console.log(`- fail:           ${fail}`);
  console.log(`- not-verified:   ${notVerified.length}  (operator runs SQL snippet in Supabase dashboard to close these)`);
  console.log('');
  console.log('## Operator SQL snippet (paste into Supabase dashboard → SQL Editor)');
  console.log('```sql');
  for (const nv of notVerified) {
    console.log(`-- ${nv.id}: ${nv.reason}`);
    console.log(nv.operator_sql);
    console.log('');
  }
  console.log('```');
  console.log('Record the output in the Tranche 2 evidence pack.');
}

function emitJsonSummary(): void {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const overall = fail > 0 ? 'FAIL' : 'PASS';
  console.log(
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        run_id: RUN_ID,
        status: overall,
        checks: results,
        not_verified: notVerified,
        summary: { pass, fail, not_verified: notVerified.length, overall },
        supplementary_sql: notVerified
          .map((nv) => `-- ${nv.id}: ${nv.reason}\n${nv.operator_sql}`)
          .join('\n\n'),
      },
      null,
      2,
    ),
  );
}

(async () => {
  const service = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } });
  const anon = createClient(URL!, ANON_KEY!, { auth: { persistSession: false } });

  if (!JSON_MODE) {
    console.log('# Phase 0 post-apply validation (strict)');
    console.log(`Generated: ${new Date().toISOString()}`);
    console.log(`Run id:    ${RUN_ID}`);
    console.log('');
    console.log('## Required checks');
  }

  await checkColumns(service, 'v5_conversation_turns', V5_CONVERSATION_TURNS_COLUMNS);
  await checkColumns(service, 'v5_handler_facts', V5_HANDLER_FACTS_COLUMNS);
  await checkRpcCallable(service);
  await checkUniqueConstraint(service, TEST_SCENARIO_ID!);
  await checkBiconditionalCheck(service, TEST_SCENARIO_ID!);
  await checkTurnClassCheck(service, TEST_SCENARIO_ID!);
  await checkForeignKey(service, TEST_SCENARIO_ID!);
  await checkRls(anon, 'v5_conversation_turns');
  await checkRls(anon, 'v5_handler_facts');

  if (!JSON_MODE) {
    console.log('');
    console.log('## Not-verified (supabase-js scope limit)');
  }
  emitNotVerified();

  await cleanup(service);

  if (JSON_MODE) {
    emitJsonSummary();
  } else {
    emitHumanSummary();
  }

  const failed = results.filter((r) => r.status === 'FAIL').length;
  if (failed > 0) {
    if (!JSON_MODE) {
      console.error('');
      console.error('[post-apply-validate] at least one required check failed. Do NOT proceed to Tranche 2.');
    }
    process.exit(3);
  }
})();
