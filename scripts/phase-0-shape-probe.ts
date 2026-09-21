#!/usr/bin/env tsx
/**
 * Phase 0 — existing `public.conversation_turns` shape probe.
 *
 * Triggered by the collision surfaced at [scripts/phase-0-introspect.ts](./phase-0-introspect.ts)
 * (exit code 3). Characterises the existing table without touching data:
 * column presence (are all audit-§4.1 columns there?) and row count (is the
 * table populated or dormant?).
 *
 * Usage
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm exec tsx scripts/phase-0-shape-probe.ts
 *
 * Decision matrix (per Paul, 2026-04-17):
 *   compatible shape + zero rows    → option 1 (reuse)
 *   compatible shape + rows present → option 1 (reuse, preserve data)
 *   incompatible + zero rows        → option 3 (scoped drop, Paul confirms)
 *   incompatible + rows present     → option 2 (rename to v5_conversation_turns)
 *
 * Read-only. Never mutates Supabase state.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('[phase-0-shape-probe] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

// Expected column set per audit §4.1 `conversation_turns` DDL.
const EXPECTED_COLUMNS = [
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

(async () => {
  const client = createClient(URL, KEY, { auth: { persistSession: false } });

  console.log('# Phase 0 — public.conversation_turns shape probe');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('');

  // 1. Exact row count via HEAD request.
  const { count, error: countError } = await client
    .from('conversation_turns')
    .select('*', { count: 'exact', head: true });
  console.log('## Row count');
  if (countError) {
    console.log(`- ERROR fetching count: ${countError.message} (code=${(countError as unknown as { code?: string }).code ?? 'n/a'})`);
  } else {
    console.log(`- rows: ${count ?? 'unknown'}`);
  }
  console.log('');

  // 2. Full-column select — succeeds only if every expected column exists.
  const fullList = EXPECTED_COLUMNS.join(', ');
  console.log('## Full expected-column select');
  console.log(`- columns tried: ${fullList}`);
  const { error: fullError } = await client
    .from('conversation_turns')
    .select(fullList)
    .limit(0);
  if (fullError) {
    const code = (fullError as unknown as { code?: string }).code ?? 'n/a';
    console.log(`- status: FAILED`);
    console.log(`- error: ${fullError.message}`);
    console.log(`- code: ${code}`);
  } else {
    console.log('- status: SUCCESS — every expected column exists');
  }
  console.log('');

  // 3. Per-column existence probe for a fine-grained report regardless of (2).
  console.log('## Per-column existence probe');
  const present: string[] = [];
  const missing: Array<{ column: string; error: string }> = [];
  for (const col of EXPECTED_COLUMNS) {
    const { error } = await client.from('conversation_turns').select(col).limit(0);
    if (error) {
      missing.push({ column: col, error: error.message });
      console.log(`- ${col}: MISSING — ${error.message}`);
    } else {
      present.push(col);
      console.log(`- ${col}: present`);
    }
  }
  console.log('');

  // 4. Summary for decision matrix.
  console.log('## Summary');
  console.log(`- expected-column coverage: ${present.length} / ${EXPECTED_COLUMNS.length}`);
  console.log(`- missing columns: ${missing.length === 0 ? '(none)' : missing.map((m) => m.column).join(', ')}`);
  console.log(`- shape verdict: ${missing.length === 0 ? 'COMPATIBLE' : 'INCOMPATIBLE'}`);
  console.log(`- data verdict: ${count === 0 ? 'EMPTY' : count === null ? 'UNKNOWN' : 'POPULATED'}`);
  console.log('');

  // 5. Scope note — the probe does NOT detect extra columns beyond the
  // expected set. If the existing table has unexpected columns, those will
  // not surface here; a dashboard inspection complements this probe if that
  // question matters to the chosen path.
  console.log('## Scope limit');
  console.log('- This probe confirms expected columns are present. It does not detect EXTRA columns beyond the expected set (PostgREST does not expose column metadata via supabase-js without a row-returning SELECT).');
  console.log('- If the resolution path is "reuse", a Tranche 2 compatibility test MUST assert no unexpected columns / types via a direct SQL `SELECT column_name, data_type FROM information_schema.columns WHERE table_name=\'conversation_turns\'` executed by the operator.');
})();
