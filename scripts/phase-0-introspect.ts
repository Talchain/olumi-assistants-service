#!/usr/bin/env tsx
/**
 * Phase 0 — live Supabase introspection (P0-1).
 *
 * Read-only probe for V5 session-store migration preconditions. Results
 * feed into Docs/v5/slice-phase-0-supabase-audit.md §2.7.
 *
 * Usage
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm exec tsx scripts/phase-0-introspect.ts
 *
 * The service-role key is not in local `.env`; source it from the staging
 * Supabase project dashboard (Project Settings → API → service_role key)
 * for this one-shot read-only check. Never commit credentials.
 *
 * Exit codes
 *   0  all checks completed (caller inspects output)
 *   2  required env vars missing
 *   3  unexpected surprise surfaced (table collision, or hard error)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load .env so CEE's standard local config picks up SUPABASE_* if present.
// Existing prompt store also reads these via env; keeping the loader path
// uniform avoids "works-in-server-fails-in-script" surprises.
dotenv.config();

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('[phase-0-introspect] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('[phase-0-introspect] run with:');
  console.error('  SUPABASE_URL=https://<ref>.supabase.co \\');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=<service-role-JWT> \\');
  console.error('    pnpm exec tsx scripts/phase-0-introspect.ts');
  process.exit(2);
}

type ProbeResult = {
  name: string;
  verdict: 'absent-OK' | 'present-collision' | 'error';
  reason: string;
};

async function probeTable(client: SupabaseClient, name: string): Promise<ProbeResult> {
  const { data, error } = await client.from(name).select('*').limit(0);
  if (error) {
    const code = (error as unknown as { code?: string }).code ?? '';
    const msg = error.message ?? '';
    const absent =
      code === 'PGRST205' ||
      code === '42P01' ||
      /does not exist/i.test(msg) ||
      /could not find the table/i.test(msg);
    if (absent) {
      return { name, verdict: 'absent-OK', reason: `absent — code=${code || 'n/a'}, msg="${msg}"` };
    }
    return { name, verdict: 'error', reason: `unexpected error — code=${code || 'n/a'}, msg="${msg}"` };
  }
  return {
    name,
    verdict: 'present-collision',
    reason: `returned ${data?.length ?? 0} rows on limit(0) probe — schema registered`,
  };
}

(async () => {
  const client = createClient(URL, KEY, { auth: { persistSession: false } });

  console.log('# Phase 0 Supabase introspection');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('');

  console.log('## Table collision check (V5 migration preconditions)');
  // V5 tables use the `v5_` prefix after the 2026-04-17 rename decision
  // (see audit §2.7). The historical `public.conversation_turns` sketch at
  // 4/11 columns is left untouched; it is not V5's concern and is not probed
  // by this script. Run `scripts/phase-0-shape-probe.ts` if you need to
  // revisit that legacy table.
  let surprise = false;
  for (const name of ['v5_conversation_turns', 'v5_handler_facts']) {
    const result = await probeTable(client, name);
    console.log(`- ${result.name}: **${result.verdict}** — ${result.reason}`);
    if (result.verdict !== 'absent-OK') {
      surprise = true;
    }
  }

  console.log('');
  console.log('## Known-good preconditions (verified via committed source, not live query)');
  console.log('- `pgcrypto.gen_random_bytes()` — used by `create_shared_brief` in the committed hardening migration.');
  console.log('- `auth.uid()` — used by every existing SECURITY DEFINER RPC per `supabase/README.md` §RPCs.');
  console.log('- Both are Supabase-default extensions/functions; a project lacking them would fail existing RPCs, not just new ones.');

  console.log('');
  console.log('## Notes on scope');
  console.log('- Supabase PostgREST exposes only the configured schemas (default `public` + `graphql_public`). `pg_catalog` and `information_schema` are not accessible via supabase-js without a project-settings change, so `pg_extension`/`pg_proc` are not queried here. The source-code evidence above is authoritative for a standard Supabase project.');
  console.log('- If a future audit needs deeper introspection, either add a read-only SQL RPC to the migration set or use a direct Postgres driver with the project connection string (kept outside `.env`).');

  if (surprise) {
    console.error('');
    console.error('[phase-0-introspect] SURPRISE — halt Phase 0 and review.');
    process.exit(3);
  }
})();
